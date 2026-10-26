// Pins the harness itself (fake services, fixtures, app wiring) — the `api` project, no
// browser. A red here means every other spec would fail for the wrong reason.
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { APP_URL, CLIENT_ID, CLIENT_SECRET, FAKES_URL, KEYCLOAK_ISSUER, ROOT_DIR } from '../support/env.js'
import { PASSWORD, PERSONAS } from '../support/personas.js'
import { closeDb, resetDb } from '../support/db.js'
import { decodeJwt } from '../fakes/keycloak.mjs'

const TOKEN_URL = `${KEYCLOAK_ISSUER}/protocol/openid-connect/token`
const USERINFO_URL = `${KEYCLOAK_ISSUER}/protocol/openid-connect/userinfo`
const REDIRECT_URI = `${APP_URL}/auth/callback`

function tokenRequest(request, form) {
  return request.post(TOKEN_URL, { form: { client_id: CLIENT_ID, ...form } })
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

async function authorize(request, challenge, user = 'alice') {
  const params = new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'code', scope: 'openid profile', redirect_uri: REDIRECT_URI,
    state: 's1', code_challenge: challenge, code_challenge_method: 'S256', user,
  })
  const res = await request.get(`${KEYCLOAK_ISSUER}/protocol/openid-connect/auth?${params}`, { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  return new URL(res.headers().location)
}

test.beforeEach(async ({ request }) => {
  await request.post(`${FAKES_URL}/__control/reset`)
})

test.describe('fake Keycloak', () => {
  test('health answers', async ({ request }) => {
    const res = await request.get(`${FAKES_URL}/__control/health`)
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  test('password grant mints a Keycloak-shaped JWT', async ({ request }) => {
    const res = await tokenRequest(request, { grant_type: 'password', username: 'bob', password: PASSWORD })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.access_token.split('.')).toHaveLength(3)
    expect(body.expires_in).toBe(300)
    const payload = decodeJwt(body.access_token)
    expect(payload.sub).toBe(PERSONAS.bob.sub)
    expect(payload.iss).toBe(KEYCLOAK_ISSUER)
    expect(Array.isArray(payload.realm_access.roles)).toBe(true)
  })

  test('userinfo returns the persona, 401 when revoked', async ({ request }) => {
    const { access_token } = await (await tokenRequest(request, { grant_type: 'password', username: 'alice', password: PASSWORD })).json()
    const headers = { Authorization: `Bearer ${access_token}` }
    const ok = await request.get(USERINFO_URL, { headers })
    expect(ok.status()).toBe(200)
    expect(await ok.json()).toMatchObject({ sub: PERSONAS.alice.sub, preferred_username: 'alice', pseudo: 'alice' })
    await request.post(`${FAKES_URL}/__control/revoke`, { data: { user: 'alice' } })
    expect((await request.get(USERINFO_URL, { headers })).status()).toBe(401)
  })

  test('authorization code with PKCE: good verifier exchanges, bad verifier is refused', async ({ request }) => {
    const good = pkce()
    const location = await authorize(request, good.challenge)
    expect(location.searchParams.get('state')).toBe('s1')
    const code = location.searchParams.get('code')
    expect(code).toBeTruthy()
    const exchanged = await tokenRequest(request, {
      grant_type: 'authorization_code', client_secret: CLIENT_SECRET, code, code_verifier: good.verifier, redirect_uri: REDIRECT_URI,
    })
    expect(exchanged.status()).toBe(200)
    expect((await exchanged.json()).refresh_token).toBeTruthy()

    const other = pkce()
    const second = (await authorize(request, other.challenge)).searchParams.get('code')
    const refused = await tokenRequest(request, {
      grant_type: 'authorization_code', client_secret: CLIENT_SECRET, code: second, code_verifier: 'wrong', redirect_uri: REDIRECT_URI,
    })
    expect(refused.status()).toBe(400)
    expect((await refused.json()).error).toBe('invalid_grant')
  })

  test('refresh rotates, the old token stays valid, both die with the session', async ({ request }) => {
    const { refresh_token: first } = await (await request.post(`${FAKES_URL}/__control/session`, { data: { user: 'carol' } })).json()
    const rotated = await tokenRequest(request, { grant_type: 'refresh_token', client_secret: CLIENT_SECRET, refresh_token: first })
    expect(rotated.status()).toBe(200)
    const second = (await rotated.json()).refresh_token
    expect(second).not.toBe(first)
    // revokeRefreshToken = false in the real realm: a reused refresh token still works.
    expect((await tokenRequest(request, { grant_type: 'refresh_token', client_secret: CLIENT_SECRET, refresh_token: first })).status()).toBe(200)
    await request.post(`${FAKES_URL}/__control/revoke`, { data: { user: 'carol' } })
    for (const token of [first, second]) {
      expect((await tokenRequest(request, { grant_type: 'refresh_token', client_secret: CLIENT_SECRET, refresh_token: token })).status()).toBe(400)
    }
  })

  test('refresh after revoke → 400 through the app, both cookies cleared', async ({ request }) => {
    const { refresh_token } = await (await request.post(`${FAKES_URL}/__control/session`, { data: { user: 'alice' } })).json()
    await request.post(`${FAKES_URL}/__control/revoke`, { data: { user: 'alice' } })
    const res = await request.post(`${APP_URL}/api/token`, {
      data: { grant: 'refresh_token' },
      headers: { Cookie: `reunion_rt=${encodeURIComponent(refresh_token)}; reunion_auth=1` },
    })
    expect(res.status()).toBe(400)
    const cookies = res.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value)
    expect(cookies.some(c => /^reunion_rt=;.*Max-Age=0/.test(c))).toBe(true)
    expect(cookies.some(c => /^reunion_auth=;.*Max-Age=0/.test(c))).toBe(true)
  })

  test('unknown path is a loud 404', async ({ request }) => {
    const res = await request.get(`${FAKES_URL}/nope`)
    expect(res.status()).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })
})

async function accessToken(request, username) {
  const res = await tokenRequest(request, { grant_type: 'password', username, password: PASSWORD })
  return (await res.json()).access_token
}

test.describe('fake decks-api, cards API, CDN, placeholders', () => {
  test('decks: create, list owner-filtered, get, merge-patch, delete', async ({ request }) => {
    const alice = { Authorization: `Bearer ${await accessToken(request, 'alice')}` }
    const bob = { Authorization: `Bearer ${await accessToken(request, 'bob')}` }
    const DECKS = `${FAKES_URL}/decks/api/decks`
    const created = await request.post(DECKS, {
      headers: alice,
      data: { name: 'Alpha', format: 'sealed', isDraft: true, isPublic: false, deckCards: [{ cardReference: 'ALT_CYCLONE_B_AX_01_C', quantity: 3 }] },
    })
    expect(created.status()).toBe(201)
    const { id } = await created.json()
    expect(id).toBeTruthy()
    expect((await (await request.get(DECKS, { headers: alice })).json())['hydra:totalItems']).toBe(1)
    expect((await (await request.get(DECKS, { headers: bob })).json())['hydra:totalItems']).toBe(0)
    expect((await (await request.get(`${DECKS}?name=lph`, { headers: alice })).json())['hydra:member']).toHaveLength(1)
    expect((await request.get(`${DECKS}/${id}`, { headers: bob })).status()).toBe(404)
    expect((await request.get(DECKS)).status()).toBe(401)

    const asJson = await request.patch(`${DECKS}/${id}`, { headers: { ...alice, 'Content-Type': 'application/json' }, data: JSON.stringify({ isDraft: false }) })
    expect(asJson.status()).toBe(415)
    const patched = await request.patch(`${DECKS}/${id}`, {
      headers: { ...alice, 'Content-Type': 'application/merge-patch+json' }, data: JSON.stringify({ isDraft: false }),
    })
    expect(patched.status()).toBe(200)
    expect(await patched.json()).toMatchObject({ isDraft: false, name: 'Alpha' })
    expect((await request.delete(`${DECKS}/${id}`, { headers: alice })).status()).toBe(204)
    expect((await request.get(`${DECKS}/${id}`, { headers: alice })).status()).toBe(404)
  })

  test('cards: a unique resolves to its real faction from the range data', async ({ request }) => {
    const ranges = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'src/lib/data/factionRanges/CYCLONE.json'), 'utf8'))
    const [family, windows] = Object.entries(ranges)[0]
    const [faction, [[serial]]] = Object.entries(windows)[0]
    const CARDS = `${FAKES_URL}/cards/api/cards`
    const hit = await (await request.get(`${CARDS}?reference=ALT_CYCLONE_B_${family}_U_${serial}`)).json()
    expect(hit.member[0].faction.code).toBe(faction)
    expect(hit.member[0].rarity.reference).toBe('UNIQUE')
    const miss = await (await request.get(`${CARDS}?reference=ALT_CYCLONE_B_${family}_U_99999999`)).json()
    expect(miss.member).toEqual([])
    const random = await (await request.get(`${CARDS}?rarity=UNIQUE&set.reference=CYCLONE&random=1`)).json()
    expect(random.member).toEqual([])
  })

  test('cdn answers any path with a png', async ({ request }) => {
    const res = await request.get(`${FAKES_URL}/cdn/marketing/anything.webp`)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('image/png')
    expect((await res.body()).length).toBeLessThan(200)
  })

  test('placeholders answer 200', async ({ request }) => {
    expect((await request.get(`${FAKES_URL}/deckbuilder/decks/x`)).status()).toBe(200)
    expect((await request.get(`${FAKES_URL}/reunion/x`)).status()).toBe(200)
  })

  test('control: decks and requests', async ({ request }) => {
    const alice = { Authorization: `Bearer ${await accessToken(request, 'alice')}` }
    await request.post(`${FAKES_URL}/decks/api/decks`, { headers: alice, data: { name: 'Beta', format: 'sealed', isDraft: true, deckCards: [] } })
    const decks = await (await request.get(`${FAKES_URL}/__control/decks?user=alice`)).json()
    expect(decks).toHaveLength(1)
    const log = await (await request.get(`${FAKES_URL}/__control/requests`)).json()
    expect(log).toContainEqual(expect.objectContaining({ method: 'POST', path: '/api/decks', sub: PERSONAS.alice.sub }))
    await request.post(`${FAKES_URL}/__control/reset`)
    expect(await (await request.get(`${FAKES_URL}/__control/decks?user=alice`)).json()).toEqual([])
  })
})

test.describe('card fixtures and the app wiring', () => {
  test.beforeAll(async () => {
    await resetDb()
  })

  test.afterAll(async () => {
    await closeDb()
  })

  test('carddb serves the three fixtures and 404s the rest', async ({ request }) => {
    for (const set of ['CYCLONE', 'EOLE', 'FUGUE']) {
      const res = await request.get(`${FAKES_URL}/carddb/${set}/${set}_EN.json`)
      expect(res.status(), set).toBe(200)
      const cards = await res.json()
      expect(cards.length, set).toBeGreaterThan(100)
      expect(cards.every(c => c.reference.includes('_B_')), set).toBe(true)
    }
    expect((await request.get(`${FAKES_URL}/carddb/ALIZE/ALIZE_EN.json`)).status()).toBe(404)
  })

  test('api config only points at localhost', async ({ request }) => {
    const config = await (await request.get(`${APP_URL}/api/config`)).json()
    const urls = Object.entries(config).filter(([key]) => key !== 'keycloakClientId')
    expect(urls.length).toBeGreaterThan(0)
    for (const [key, value] of urls) expect(value, key).toMatch(/^http:\/\/localhost:8091\//)
  })

  test('the app generates a normal pool from the fixtures', async ({ request }) => {
    const headers = { Authorization: `Bearer ${await accessToken(request, 'alice')}` }
    const res = await request.get(`${APP_URL}/api/tournament-normal-pool`, { headers })
    expect(res.status()).toBe(200)
    const pool = await res.json()
    expect(pool.boosters).toHaveLength(7)
    // The seeded format (EOLE, heroes_in_pool = false) is the free-hero mode: no hero slot,
    // so 12-card boosters.
    for (const booster of pool.boosters) {
      expect(booster).toHaveLength(12)
      for (const ref of booster) expect(ref).toMatch(/^ALT_EOLE_B_/)
    }
    expect(pool.boosters.flat().filter(r => r.includes('_U_'))).toHaveLength(1)
    expect(Object.keys(pool.cards).filter(r => r.includes('_U_'))).toHaveLength(2)
  })
})
