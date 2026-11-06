// Integration tests for the cube checks on POST / PATCH /api/tournaments (spec §15.2) against
// the REAL Postgres of docker-compose.test.yml. The cards API is mocked (no network).
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { query, getPool } from '../../src/lib/db.js'
import { getOrCreateTournamentPool } from '../../src/lib/poolStore.js'
import { getTournament } from '../../src/lib/tournamentStore.js'

// Cube pools are dealt by a later task: the lock test only needs a pool row to exist.
vi.mock('../../src/lib/poolBuilder.js', async importOriginal => {
  const mod = await importOriginal()
  return { ...mod, buildPool: vi.fn(async () => ({ cards: { ALT_CYCLONE_B_AX_01_C: 1 }, boosters: [['ALT_CYCLONE_B_AX_01_C']] })) }
})

vi.mock('../../src/lib/cardData.js', async importOriginal => {
  const mod = await importOriginal()
  const F = ['AX', 'BR', 'LY', 'MU', 'OR', 'YZ']
  const card = (reference, faction, cardType = 'CHARACTER') => ({ reference, name: reference, faction, cardType, rarity: 'C' })
  const cyclone = [
    ...F.flatMap((f, i) => [card(`ALT_CYCLONE_B_${f}_0${i + 1}_C`, f), card(`ALT_CYCLONE_B_${f}_1${i}_C`, f, 'HERO')]),
  ]
  return {
    ...mod,
    fetchSet: vi.fn(async setCode => (setCode === 'CYCLONE' ? cyclone : [])),
    // Promo-only ref (no B twin): answered by reference.
    fetchUniques: vi.fn(async refs => refs.filter(r => r === 'ALT_CYCLONE_P_BR_64_C').map(r => card(r, 'BR'))),
  }
})

vi.mock('../../api/_lib/auth.js', async importOriginal => {
  const mod = await importOriginal()
  return { ...mod, verifyUser: vi.fn(async () => null), verifySub: vi.fn(async () => null) }
})
import { verifyUser } from '../../api/_lib/auth.js'
import tournamentsIndex from '../../api/tournaments/index.js'
import tournamentsItem from '../../api/tournaments/[id].js'

function mockRes() {
  const res = {
    statusCode: null, body: undefined, headers: {},
    status(code) { res.statusCode = code; return res },
    json(payload) { res.body = payload; return res },
    end() { return res },
    setHeader(name, value) { res.headers[name] = value; return res },
  }
  return res
}
async function call(handler, { method = 'GET', body, query: q = {} } = {}) {
  const req = { method, body, query: q, url: '/api/x', headers: { authorization: 'Bearer t' } }
  const res = mockRes()
  await handler(req, res)
  return res
}

const ALICE = { sub: 'alice', name: 'Alice', roles: [], isModerator: false }
const inDays = n => new Date(Date.now() + n * 86400000)
let seq = 0
const bga = () => String(777000 + ++seq)

const F = ['AX', 'BR', 'LY', 'MU', 'OR', 'YZ']
// 6 commons (one per faction), 5 boosters of 12 = 60 cards per player; 99 copies each = 594 cards -> 9 players.
const CUBE_INPUT = {
  v: 1, format: 'sealed',
  source: {
    type: 'cube', name: 'Commons', origin: 'paste',
    cards: Object.fromEntries(F.map((f, i) => [`ALT_CYCLONE_B_${f}_0${i + 1}_C`, 30])),
    heroPool: F.map((f, i) => `ALT_CYCLONE_B_${f}_1${i}_C`),
    boosters: 5, cardsPerBooster: 12, perFaction: 0,
  },
  heroes: 'packs',
  uniques: { inBoosters: 2, guaranteed: 1, evenFactions: true },
}
const withSource = over => ({ ...CUBE_INPUT, source: { ...CUBE_INPUT.source, ...over } })
const cubeBody = over => {
  const id = bga()
  return { name: 'Commons', bgaUrl: `https://boardgamearena.com/tournament?id=${id}`, startsAt: inDays(2).toISOString(), maxPlayers: 3, config: CUBE_INPUT, ...over }
}

beforeEach(async () => {
  verifyUser.mockImplementation(async req => (req.headers.authorization ? ALICE : null))
  await query('TRUNCATE sealed_pool_games, sealed_pools, tournament_cube_slots, hidden_tournaments, tournaments')
})
afterAll(async () => { await getPool().end() })

const post = body => call(tournamentsIndex, { method: 'POST', body })
const patch = (id, body) => call(tournamentsItem, { method: 'PATCH', body, query: { id } })

describe('POST a cube tournament', () => {
  it('stores a cube tournament with its cap and the forced uniques', async () => {
    const res = await post(cubeBody())
    expect(res.statusCode).toBe(201)
    expect(res.body.config.source.type).toBe('cube')
    expect(res.body.config.uniques).toMatchObject({ inBoosters: 0, guaranteed: 0, evenFactions: false })
    expect(res.body.maxPlayers).toBe(3)
  })

  it('stores an alt-art ref as its B twin and keeps a promo-only ref as given', async () => {
    const cards = { ALT_CYCLONE_A_AX_01_C: 20, ALT_CYCLONE_B_AX_01_C: 10, ALT_CYCLONE_P_BR_64_C: 5, ALT_CYCLONE_B_BR_02_C: 25 }
    for (const f of F.slice(2)) cards[`ALT_CYCLONE_B_${f}_0${F.indexOf(f) + 1}_C`] = 30
    const res = await post(cubeBody({ config: withSource({ cards }) }))
    expect(res.statusCode).toBe(201)
    const stored = res.body.config.source.cards
    expect(stored.ALT_CYCLONE_B_AX_01_C).toBe(30)
    expect(stored.ALT_CYCLONE_A_AX_01_C).toBeUndefined()
    expect(stored.ALT_CYCLONE_P_BR_64_C).toBe(5)
  })

  it('refuses an unresolved ref with the list', async () => {
    const cards = { ...CUBE_INPUT.source.cards, ALT_CYCLONE_B_AX_99_C: 1 }
    const res = await post(cubeBody({ config: withSource({ cards }) }))
    expect(res.statusCode).toBe(400)
    expect(res.body.config).toEqual(['source.cards.unresolved'])
    expect(res.body.unresolved).toEqual(['ALT_CYCLONE_B_AX_99_C'])
  })

  it('refuses a hero among the cards and a non-hero in the hero pool', async () => {
    const hero = 'ALT_CYCLONE_B_AX_10_C'
    let res = await post(cubeBody({ config: withSource({ cards: { ...CUBE_INPUT.source.cards, [hero]: 1 } }) }))
    expect(res.statusCode).toBe(400)
    expect(res.body.config).toEqual(['source.cards'])
    res = await post(cubeBody({ config: withSource({ heroPool: ['ALT_CYCLONE_B_AX_01_C'] }) }))
    expect(res.statusCode).toBe(400)
    expect(res.body.config).toEqual(['source.heroPool'])
  })

  it('refuses a cube without a cap, above the capacity, and a cube below 2 players', async () => {
    let res = await post(cubeBody({ maxPlayers: undefined }))
    expect(res.statusCode).toBe(400)
    expect(res.body.fields.maxPlayers).toBe('required_for_cube')

    res = await post(cubeBody({ maxPlayers: 10 }))
    expect(res.statusCode).toBe(400)
    expect(res.body.fields.maxPlayers).toBe('above_capacity')
    expect(res.body.capacity.players).toBe(3) // 180 cards / 60

    const small = Object.fromEntries(F.map((f, i) => [`ALT_CYCLONE_B_${f}_0${i + 1}_C`, 5]))
    res = await post(cubeBody({ config: withSource({ cards: small }), maxPlayers: 2 }))
    expect(res.statusCode).toBe(400)
    expect(res.body.config).toEqual(['source.capacity'])
  })
})

describe('PATCH a cube tournament', () => {
  it('PATCH a cube cap while unlocked, 409 tournament_locked once a pool exists', async () => {
    const t = (await post(cubeBody())).body
    let res = await patch(t.id, { maxPlayers: 2 })
    expect(res.statusCode).toBe(200)
    expect(res.body.maxPlayers).toBe(2)
    res = await patch(t.id, { maxPlayers: 99 })
    expect(res.statusCode).toBe(400)
    expect(res.body.fields.maxPlayers).toBe('above_capacity')
    res = await patch(t.id, { maxPlayers: null })
    expect(res.statusCode).toBe(400)
    expect(res.body.fields.maxPlayers).toBe('required_for_cube')

    await getOrCreateTournamentPool('bob', await getTournament(t.id))
    res = await patch(t.id, { maxPlayers: 3 })
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('tournament_locked')
  })

  it('PATCH switching a set tournament to a cube runs the cube checks against the sent or stored cap', async () => {
    const setConfig = { v: 1, format: 'sealed', source: { type: 'set', setCode: 'CYCLONE' }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0 } }
    const t = (await post(cubeBody({ config: setConfig, maxPlayers: 8 }))).body
    expect(t.config.source.type).toBe('set')
    // Sent cap above the capacity (3 players).
    let res = await patch(t.id, { config: CUBE_INPUT, maxPlayers: 9 })
    expect(res.statusCode).toBe(400)
    expect(res.body.fields.maxPlayers).toBe('above_capacity')
    // Stored cap (8) above the capacity too.
    res = await patch(t.id, { config: CUBE_INPUT })
    expect(res.statusCode).toBe(400)
    expect(res.body.fields.maxPlayers).toBe('above_capacity')
    res = await patch(t.id, { config: CUBE_INPUT, maxPlayers: 3 })
    expect(res.statusCode).toBe(200)
    expect(res.body.config.source.type).toBe('cube')
  })
})
