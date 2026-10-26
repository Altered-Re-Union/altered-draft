// Pins the harness itself (fake services, fixtures, app wiring) — the `api` project, no
// browser. A red here means every other spec would fail for the wrong reason.
import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { APP_URL, CLIENT_ID, CLIENT_SECRET, FAKES_URL, KEYCLOAK_ISSUER } from '../support/env.js'
import { PASSWORD, PERSONAS } from '../support/personas.js'
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

  test('refresh rotates and dies with the session', async ({ request }) => {
    const { refresh_token: first } = await (await request.post(`${FAKES_URL}/__control/session`, { data: { user: 'carol' } })).json()
    const rotated = await tokenRequest(request, { grant_type: 'refresh_token', client_secret: CLIENT_SECRET, refresh_token: first })
    expect(rotated.status()).toBe(200)
    const second = (await rotated.json()).refresh_token
    expect(second).not.toBe(first)
    expect((await tokenRequest(request, { grant_type: 'refresh_token', client_secret: CLIENT_SECRET, refresh_token: first })).status()).toBe(400)
    await request.post(`${FAKES_URL}/__control/revoke`, { data: { user: 'carol' } })
    expect((await tokenRequest(request, { grant_type: 'refresh_token', client_secret: CLIENT_SECRET, refresh_token: second })).status()).toBe(400)
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
