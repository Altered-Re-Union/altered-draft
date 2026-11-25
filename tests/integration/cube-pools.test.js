// Integration tests of V5 pool creation under the player cap (spec §15.2 "Full", §15.3):
// the one-time cube deal into tournament_cube_slots, the slot claim, 409 tournament_full.
// Same mocks as tournaments.test.js; the card data of CYCLONE is a fake cube set (6 heroes,
// 20 non-hero cards per faction), so the deal runs on real refs without the network.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { query, getPool } from '../../src/lib/db.js'
import { getOrCreateTournamentPool, bindTournamentId } from '../../src/lib/poolStore.js'
import { createTournament, getTournament, updateTournament } from '../../src/lib/tournamentStore.js'
import { validateTournamentConfig } from '../../src/lib/tournamentConfig.js'
import { FACTIONS } from '../../src/lib/cardData.js'

const CONFIG = {
  v: 1, format: 'sealed',
  source: { type: 'set', setCode: 'CYCLONE', boosters: 7 },
  heroes: 'packs',
  uniques: { inBoosters: 1, guaranteed: 0, evenFactions: false },
  excludeBanlist: false,
}
const inDays = n => new Date(Date.now() + n * 86400000)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const pad = n => String(n).padStart(2, '0')
const HEROES = FACTIONS.map(f => `ALT_CYCLONE_B_${f}_01_C`)
// 20 copies per faction: refs 02–19 once, ref 20 twice (a multiset, two copies of one card).
const CUBE_CARDS = Object.fromEntries(FACTIONS.flatMap(f => [
  ...Array.from({ length: 18 }, (_, i) => [`ALT_CYCLONE_B_${f}_${pad(i + 2)}_C`, 1]),
  [`ALT_CYCLONE_B_${f}_20_C`, 2],
]))
// A realistic stored config: 6 boosters of 10 per player, cap 2 = exactly the 120 cards.
const cubeConfig = over => {
  const { ok, errors, config } = validateTournamentConfig({
    format: 'sealed',
    source: { type: 'cube', name: 'Test cube', origin: 'paste', cards: CUBE_CARDS, heroPool: HEROES, boosters: 6, cardsPerBooster: 10, perFaction: 1, ...over?.source },
    heroes: over?.heroes ?? 'packs',
  })
  if (!ok) throw new Error(`bad test config: ${errors.join(', ')}`)
  return config
}
const CUBE_CONFIG = cubeConfig()

async function mkTournament(over = {}) {
  const bgaId = over.bgaTournamentId ?? String(Math.floor(Math.random() * 1e9))
  return createTournament({
    name: 'Winter Cup', description: 'desc', bgaUrl: `https://boardgamearena.com/tournament?id=${bgaId}`,
    bgaTournamentId: bgaId, startsAt: inDays(2), endsAt: null, organizerSub: 'org', organizerName: 'Org', config: CONFIG,
    ...over,
  })
}
const mkCube = over => mkTournament({ config: CUBE_CONFIG, maxPlayers: 2, ...over })

vi.mock('../../src/lib/poolBuilder.js', async importOriginal => {
  const mod = await importOriginal()
  return {
    ...mod,
    buildPool: vi.fn(async (sub, { config, nonce }) => {
      const sets = config.source.type === 'set' ? [config.source.setCode] : Object.keys(config.source.sets)
      const refs = sets.map(s => `ALT_${s}_B_AX_01_C`)
      return {
        cards: { ...Object.fromEntries(refs.map(r => [r, 2])), [`ALT_${sets[0]}_B_BR_02_R1`]: 1, [`NONCE_${nonce}`]: 1 },
        boosters: [[...refs, ...refs, `ALT_${sets[0]}_B_BR_02_R1`, `NONCE_${nonce}`]],
      }
    }),
  }
})

vi.mock('../../src/lib/cardData.js', async importOriginal => {
  const mod = await importOriginal()
  const card = (reference, faction, cardType = 'CHARACTER') => ({ reference, name: reference, faction, cardType, rarity: 'C' })
  const pad2 = n => String(n).padStart(2, '0')
  return {
    ...mod,
    fetchSet: vi.fn(async setCode => mod.FACTIONS.flatMap(f => [
      card(`ALT_${setCode}_B_${f}_01_C`, f, 'HERO'),
      ...Array.from({ length: 20 }, (_, i) => card(`ALT_${setCode}_B_${f}_${pad2(i + 2)}_C`, f)),
    ])),
    fetchUniques: vi.fn(async () => []),
    // The real resolver (real fetchUnique, real cache) for the cards-API outage test.
    realFetchUniques: mod.fetchUniques,
  }
})

// Pass-through by default; a test may inject a delay into the resolver (config-edit race).
vi.mock('../../src/lib/cubeSource.js', async importOriginal => {
  const mod = await importOriginal()
  return { ...mod, resolveCubeSource: vi.fn(mod.resolveCubeSource) }
})

vi.mock('../../api/_lib/auth.js', async importOriginal => {
  const mod = await importOriginal()
  return { ...mod, verifyUser: vi.fn(async () => null), verifySub: vi.fn(async () => null) }
})
import { verifyUser, verifySub } from '../../api/_lib/auth.js'
import { fetchSet, fetchUniques, realFetchUniques } from '../../src/lib/cardData.js'
import { resolveCubeSource } from '../../src/lib/cubeSource.js'
import bgaDecklist from '../../api/tournament-bga-decklist.js'
import poolCounts from '../../api/tournament-pool-counts.js'
import tournamentPoolFor from '../../api/tournaments/[id]/pool.js'

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

async function call(handler, { method = 'GET', body, query: q = {}, auth = true } = {}) {
  const req = { method, body, query: q, url: '/api/x', headers: auth ? { authorization: 'Bearer t' } : {} }
  const res = mockRes()
  await handler(req, res)
  return res
}

const ALICE = { sub: 'alice', name: 'Alice', roles: [], isModerator: false }
const asUser = user => verifyUser.mockImplementation(async req => (req.headers.authorization ? user : null))

const countRefs = refs => {
  const out = {}
  for (const r of refs) out[r] = (out[r] ?? 0) + 1
  return out
}
const slotsOf = async id => (await query('SELECT slot, boosters FROM tournament_cube_slots WHERE tournament_ref = $1 ORDER BY slot', [id])).rows
const bodiesOf = boosters => boosters.flatMap(b => b.slice(1)) // slot 0 of a booster is its hero ('packs')

beforeEach(async () => {
  await query('TRUNCATE sealed_pool_games, sealed_pools, tournament_cube_slots, hidden_tournaments, tournaments')
})

afterAll(async () => {
  await getPool().end()
})

describe('cube deal and slot claim', () => {
  it('the first pool deals max_players lots, every copy once across the lots, and takes slot 0', async () => {
    const t = await mkCube()
    const row = await getOrCreateTournamentPool('alice', t)
    expect(row.cube_slot).toBe(0)
    const slots = await slotsOf(t.id)
    expect(slots.map(s => s.slot)).toEqual([0, 1])
    for (const { boosters } of slots) {
      expect(boosters).toHaveLength(6)
      for (const b of boosters) {
        expect(b).toHaveLength(11)
        expect(HEROES).toContain(b[0])
      }
    }
    const used = countRefs(slots.flatMap(s => bodiesOf(s.boosters)))
    for (const [ref, n] of Object.entries(used)) expect(n).toBeLessThanOrEqual(CUBE_CONFIG.source.cards[ref] ?? 0)
    // 2 lots × 6 boosters × 10 = the whole cube, every copy exactly once.
    expect(used).toEqual(CUBE_CONFIG.source.cards)
    expect(row.boosters).toEqual(slots[0].boosters)
    expect(row.cards).toEqual(countRefs(slots[0].boosters.flat()))
    expect(row.set_code).toBeNull()
    expect(row.config).toEqual(CUBE_CONFIG)
  })

  it('later pools take the next free slots and nobody re-deals', async () => {
    const t = await mkCube()
    const a = await getOrCreateTournamentPool('alice', t)
    const first = await slotsOf(t.id)
    const b = await getOrCreateTournamentPool('bob', t)
    expect([a.cube_slot, b.cube_slot]).toEqual([0, 1])
    expect(await slotsOf(t.id)).toEqual(first)
    expect(b.boosters).toEqual(first[1].boosters)
    const used = countRefs([a, b].flatMap(p => bodiesOf(p.boosters)))
    for (const [ref, n] of Object.entries(used)) expect(n).toBeLessThanOrEqual(CUBE_CONFIG.source.cards[ref])
  })

  it('free heroes: every hero of the pool in cards, none in the boosters', async () => {
    const t = await mkCube({ config: cubeConfig({ heroes: 'free' }) })
    const row = await getOrCreateTournamentPool('alice', t)
    for (const b of row.boosters) {
      expect(b).toHaveLength(10)
      for (const r of b) expect(HEROES).not.toContain(r)
    }
    for (const h of HEROES) expect(row.cards[h]).toBe(1)
    expect(row.cards).toEqual({ ...countRefs(row.boosters.flat()), ...Object.fromEntries(HEROES.map(h => [h, 1])) })
  })

  it('the (max + 1)-th pool is refused with tournament_full, an existing pool is still returned', async () => {
    const t = await mkCube()
    const alice = await getOrCreateTournamentPool('alice', t)
    await getOrCreateTournamentPool('bob', t)
    await expect(getOrCreateTournamentPool('carol', t)).rejects.toMatchObject({ code: 'tournament_full' })
    expect((await getOrCreateTournamentPool('alice', t)).id).toBe(alice.id)
  })

  it('three creators racing for a cap of 2 end with two pools and one tournament_full', async () => {
    const t = await mkCube()
    const results = await Promise.allSettled(['a', 'b', 'c'].map(s => getOrCreateTournamentPool(s, t)))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2)
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('tournament_full')
    expect((await query('SELECT count(*)::int AS n FROM sealed_pools WHERE tournament_ref = $1', [t.id])).rows[0].n).toBe(2)
    expect((await slotsOf(t.id)).map(s => s.slot)).toEqual([0, 1])
  })

  it('the same player racing herself on the last place gets her pool, never tournament_full', async () => {
    const t = await mkCube()
    await getOrCreateTournamentPool('bob', t)
    const results = await Promise.all([1, 2, 3].map(() => getOrCreateTournamentPool('alice', t)))
    expect(new Set(results.map(r => r.id)).size).toBe(1)
  })

  it('a set tournament with a cap: insertCappedPool enforces it; without a cap insertPool is untouched', async () => {
    const capped = await mkTournament({ maxPlayers: 2 })
    const p = await getOrCreateTournamentPool('alice', capped)
    expect(p.cube_slot).toBeNull()
    expect(p.cards['ALT_CYCLONE_B_AX_01_C']).toBe(2)
    await getOrCreateTournamentPool('bob', capped)
    await expect(getOrCreateTournamentPool('carol', capped)).rejects.toMatchObject({ code: 'tournament_full' })

    const open = await mkTournament()
    for (const sub of ['alice', 'bob', 'carol']) expect((await getOrCreateTournamentPool(sub, open)).cube_slot).toBeNull()
    expect((await query('SELECT count(*)::int AS n FROM sealed_pools WHERE tournament_ref = $1', [open.id])).rows[0].n).toBe(3)
  })

  it('a cap added while a request is in flight: the stale uncapped row still goes through the capped path', async () => {
    const t = await mkTournament()
    await getOrCreateTournamentPool('alice', t)
    await getOrCreateTournamentPool('bob', t)
    const stale = await getTournament(t.id)
    expect(stale.max_players).toBeNull()
    await query('UPDATE tournaments SET max_players = 2 WHERE id = $1', [t.id])
    await expect(getOrCreateTournamentPool('carol', stale)).rejects.toMatchObject({ code: 'tournament_full' })
    expect((await query('SELECT count(*)::int AS n FROM sealed_pools WHERE tournament_ref = $1', [t.id])).rows[0].n).toBe(2)
  })

  it('once the cube is dealt, a later pool comes from a stored slot without resolving the cube again', async () => {
    const t = await mkCube()
    await getOrCreateTournamentPool('alice', t)
    const first = await slotsOf(t.id)
    vi.mocked(resolveCubeSource).mockClear()
    const setImpl = vi.mocked(fetchSet).getMockImplementation()
    const uniquesImpl = vi.mocked(fetchUniques).getMockImplementation()
    const down = async () => { throw new Error('cards API down') }
    vi.mocked(fetchSet).mockImplementation(down)
    vi.mocked(fetchUniques).mockImplementation(down)
    try {
      const bob = await getOrCreateTournamentPool('bob', t)
      expect(bob.cube_slot).toBe(1)
      expect(bob.boosters).toEqual(first[1].boosters)
      expect(resolveCubeSource).not.toHaveBeenCalled()
    } finally {
      vi.mocked(fetchSet).mockImplementation(setImpl)
      vi.mocked(fetchUniques).mockImplementation(uniquesImpl)
    }
  })

  it('an adopted legacy pool is never refused by the cap and counts towards it', async () => {
    // Counts: a legacy pool adopted at declaration takes one of the two places.
    const early = await bindTournamentId('alice', '818181', 'Early bird')
    const t = await mkTournament({ bgaTournamentId: '818181', maxPlayers: 2 })
    expect((await getOrCreateTournamentPool('alice', t)).id).toBe(early.id)
    await getOrCreateTournamentPool('bob', t)
    await expect(getOrCreateTournamentPool('carol', t)).rejects.toMatchObject({ code: 'tournament_full' })

    // Never refused: a full tournament still adopts a pool bound to its BGA id meanwhile.
    const t2 = await mkTournament({ bgaTournamentId: '919191', maxPlayers: 2 })
    await getOrCreateTournamentPool('erin', t2)
    await getOrCreateTournamentPool('fred', t2)
    const { rows: [legacy] } = await query(
      `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce, tournament_id, bound_at)
       VALUES ('alice', 'tournament', 'CYCLONE', 0, false, true, 0, 'n', '919191', now()) RETURNING id`)
    asUser(ALICE)
    const res = await call(tournamentPoolFor, { query: { id: t2.id } })
    expect(res.statusCode).toBe(200)
    expect(res.body.id).toBe(legacy.id)
    const adopted = (await query('SELECT tournament_ref, cube_slot, adopted_at FROM sealed_pools WHERE id = $1', [legacy.id])).rows[0]
    expect(adopted.tournament_ref).toBe(t2.id)
    expect(adopted.cube_slot).toBeNull()
    expect(adopted.adopted_at).toBeInstanceOf(Date)
    expect((await query('SELECT count(*)::int AS n FROM sealed_pools WHERE tournament_ref = $1', [t2.id])).rows[0].n).toBe(3)
    await expect(getOrCreateTournamentPool('dave', t2)).rejects.toMatchObject({ code: 'tournament_full' })
  })

  it('a synthetic unique at deal time refuses the first pool with cube_unresolved, nothing is dealt', async () => {
    const unique = 'ALT_CYCLONE_B_AX_05_U_4242'
    const t = await mkCube({ config: cubeConfig({ source: { cards: { ...CUBE_CARDS, [unique]: 1 } } }) })
    vi.mocked(fetchUniques).mockImplementation(async refs => refs.map(reference => ({ reference, name: reference, faction: 'AX', cardType: 'CHARACTER', rarity: 'U', synthetic: true })))
    try {
      await expect(getOrCreateTournamentPool('alice', t)).rejects.toMatchObject({ code: 'cube_unresolved' })
      expect(await slotsOf(t.id)).toEqual([])
      expect((await query('SELECT count(*)::int AS n FROM sealed_pools')).rows[0].n).toBe(0)
      asUser(ALICE)
      const res = await call(tournamentPoolFor, { query: { id: t.id } })
      expect(res.statusCode).toBe(409)
      expect(res.body).toEqual({ error: 'pool_unavailable' })
    } finally {
      vi.mocked(fetchUniques).mockImplementation(async () => [])
    }
  })

  it('a config edit racing the first pool: the pool is built from the committed config or refused', async () => {
    const base = vi.mocked(resolveCubeSource).getMockImplementation()
    for (let i = 0; i < 4; i++) {
      const t = await mkCube()
      vi.mocked(resolveCubeSource).mockImplementationOnce(async (...a) => { await sleep(150); return base(...a) })
      const edited = { ...CUBE_CONFIG, source: { ...CUBE_CONFIG.source, name: 'Edited cube' } }
      const [pool, patched] = await Promise.all([
        getOrCreateTournamentPool(`p${i}`, t),
        sleep(30).then(() => updateTournament(t.id, { config: edited }, { requireUnlocked: true })),
      ])
      const final = await getTournament(t.id)
      expect(pool.config).toEqual(final.config)
      expect(patched === null || patched.config.source.name === 'Edited cube').toBe(true)
      const slots = await slotsOf(t.id)
      expect(slots).toHaveLength(2)
    }
  })
})

describe('handlers', () => {
  it('GET /api/tournaments/:id/pool answers 409 tournament_full with maxPlayers; the BGA endpoints 409 tournament_full', async () => {
    const t = await mkCube()
    await getOrCreateTournamentPool('p1', t)
    await getOrCreateTournamentPool('p2', t)
    asUser(ALICE)
    const full = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(full.statusCode).toBe(409)
    expect(full.body).toEqual({ error: 'tournament_full', maxPlayers: 2 })

    vi.mocked(verifySub).mockResolvedValue('zoe')
    try {
      const deck = await call(bgaDecklist, { query: { tournamentId: t.bga_tournament_id, tournamentName: 'x', gameId: 'g1' } })
      expect(deck.statusCode).toBe(409)
      expect(deck.body).toEqual({ error: 'tournament_full' })
      const counts = await call(poolCounts, { query: { tournamentId: t.bga_tournament_id } })
      expect(counts.statusCode).toBe(409)
      expect(counts.body).toEqual({ error: 'tournament_full' })
    } finally {
      vi.mocked(verifySub).mockResolvedValue(null)
    }
  })

  it('the cards API down at deal time: 409 pool_unavailable on the three endpoints, then the next request deals (no restart)', async () => {
    const unique = 'ALT_CYCLONE_B_AX_05_U_4343'
    const t = await mkCube({ config: cubeConfig({ source: { cards: { ...CUBE_CARDS, [unique]: 1 } } }) })
    const realFetch = global.fetch
    vi.mocked(fetchUniques).mockImplementation(realFetchUniques)
    global.fetch = vi.fn(async () => { throw new Error('cards API down') })
    try {
      asUser(ALICE)
      const res = await call(tournamentPoolFor, { query: { id: t.id } })
      expect(res.statusCode).toBe(409)
      expect(res.body).toEqual({ error: 'pool_unavailable' })
      vi.mocked(verifySub).mockResolvedValue('zoe')
      const deck = await call(bgaDecklist, { query: { tournamentId: t.bga_tournament_id, tournamentName: 'x', gameId: 'g1' } })
      expect(deck.statusCode).toBe(409)
      expect(deck.body).toEqual({ error: 'pool_unavailable' })
      const counts = await call(poolCounts, { query: { tournamentId: t.bga_tournament_id } })
      expect(counts.statusCode).toBe(409)
      expect(counts.body).toEqual({ error: 'pool_unavailable' })
      vi.mocked(verifySub).mockResolvedValue(null)
      expect(await slotsOf(t.id)).toEqual([])
      expect((await query('SELECT count(*)::int AS n FROM sealed_pools')).rows[0].n).toBe(0)

      // The API is back: the same process deals (the outage was not cached).
      global.fetch = vi.fn(async () => ({
        ok: true, status: 200,
        json: async () => ({ member: [{ reference: unique, name: { en: 'Live unique' }, faction: { code: 'AX' }, rarity: { reference: 'UNIQUE' }, cardType: { reference: 'CHARACTER' } }] }),
      }))
      const ok = await call(tournamentPoolFor, { query: { id: t.id } })
      expect(ok.statusCode).toBe(200)
      expect(await slotsOf(t.id)).toHaveLength(2)
    } finally {
      global.fetch = realFetch
      vi.mocked(verifySub).mockResolvedValue(null)
      vi.mocked(fetchUniques).mockImplementation(async () => [])
    }
  }, 20000)

  it('a set file that does not load at deal time: 409 pool_unavailable, nothing dealt', async () => {
    const t = await mkCube()
    vi.mocked(fetchSet).mockImplementationOnce(async () => { throw new Error('Failed to fetch set CYCLONE (EN): 503') })
    asUser(ALICE)
    const res = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'pool_unavailable' })
    expect(await slotsOf(t.id)).toEqual([])
    expect((await call(tournamentPoolFor, { query: { id: t.id } })).statusCode).toBe(200)
  })

  it('poolResponse carries sourceType cube and cube { name, cardCount }', async () => {
    const t = await mkCube()
    asUser(ALICE)
    const res = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ sourceType: 'cube', cube: { name: 'Test cube', cardCount: 120 } })
    expect(res.body.boosters).toHaveLength(6)

    const set = await mkTournament()
    const plain = await call(tournamentPoolFor, { query: { id: set.id } })
    expect(plain.body.sourceType).toBe('set')
    expect(plain.body).not.toHaveProperty('cube')
  })

  it('the BGA path on a cube tournament creates a slot pool and mints a deck from it', async () => {
    const t = await mkCube({ bgaTournamentId: '828282', name: 'Cube cup' })
    vi.mocked(verifySub).mockResolvedValue('erin')
    let posted = null
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      if ((init.method ?? 'GET') === 'POST') { posted = JSON.parse(init.body); return { ok: true, status: 201, json: async () => ({ id: 'deck-erin', ...posted }) } }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    try {
      const res = await call(bgaDecklist, { query: { tournamentId: '828282', tournamentName: 'BGA', gameId: 'g1' } })
      expect(res.statusCode).toBe(200)
      expect(res.body['hydra:member'][0]).toMatchObject({ id: 'deck-erin', name: 'Random Cube cup' })
      const pool = (await query("SELECT * FROM sealed_pools WHERE sub = 'erin'")).rows[0]
      expect(pool).toMatchObject({ tournament_ref: t.id, cube_slot: 0, created_by: 'bga' })
      expect(posted.deckCards.length).toBeGreaterThan(0)
      for (const { cardReference, quantity } of posted.deckCards) expect(pool.cards[cardReference]).toBeGreaterThanOrEqual(quantity)
    } finally {
      vi.unstubAllGlobals()
      vi.mocked(verifySub).mockResolvedValue(null)
    }
  })
})
