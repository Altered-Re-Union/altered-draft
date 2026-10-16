// Integration tests for the user-created tournaments feature (store + handlers) against
// the REAL Postgres of docker-compose.test.yml. Pool generation is mocked (no network):
// buildPool returns a tiny fixed pool, which is all the SQL paths need.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { query, getPool } from '../../src/lib/db.js'
import {
  getOrCreateNormalPool, resetNormalPool, getOrCreatePreparationPool,
  getOrCreateTournamentPool, getPoolForTournament, bindTournamentId, listBoundTournamentPools,
  countPoolsByTournament, countPoolsByOrigin, poolSummariesForTournaments,
} from '../../src/lib/poolStore.js'
import {
  createTournament, getTournament, getTournamentByBgaId, listTournaments, countOpenTournaments,
  updateTournament, countPoolsForTournament, deleteTournamentIfNoPools, toTournamentJson,
} from '../../src/lib/tournamentStore.js'

const CONFIG = {
  v: 1, format: 'sealed',
  source: { type: 'set', setCode: 'CYCLONE', boosters: 7 },
  heroes: 'packs',
  uniques: { inBoosters: 1, guaranteed: 0, evenFactions: false },
  excludeBanlist: false,
}
const inDays = n => new Date(Date.now() + n * 86400000)

async function mkTournament(over = {}) {
  const bgaId = over.bgaTournamentId ?? String(Math.floor(Math.random() * 1e9))
  return createTournament({
    name: 'Winter Cup', description: 'desc', bgaUrl: `https://boardgamearena.com/tournament?id=${bgaId}`,
    bgaTournamentId: bgaId, startsAt: inDays(2), endsAt: null, organizerSub: 'org', organizerName: 'Org', config: CONFIG,
    ...over,
  })
}

vi.mock('../../src/lib/poolBuilder.js', async importOriginal => {
  const mod = await importOriginal()
  return {
    ...mod,
    buildPool: vi.fn(async (sub, { config, nonce }) => ({
      cards: { [`ALT_${config.source.setCode}_B_AX_01_C`]: 2, [`ALT_${config.source.setCode}_B_BR_02_R1`]: 1, [`NONCE_${nonce}`]: 1 },
      boosters: [[`ALT_${config.source.setCode}_B_AX_01_C`, `ALT_${config.source.setCode}_B_AX_01_C`, `ALT_${config.source.setCode}_B_BR_02_R1`, `NONCE_${nonce}`]],
    })),
  }
})

vi.mock('../../api/_lib/auth.js', async importOriginal => {
  const mod = await importOriginal()
  return { ...mod, verifyUser: vi.fn(async () => null), verifySub: vi.fn(async () => null) }
})
import { verifyUser } from '../../api/_lib/auth.js'
import tournamentsIndex from '../../api/tournaments/index.js'
import tournamentsItem from '../../api/tournaments/[id].js'
import tournamentPoolFor from '../../api/tournaments/[id]/pool.js'
import boundPools from '../../api/tournament-bound-pools.js'

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
const MOD = { sub: 'mod', name: 'Mod', roles: ['mod'], isModerator: true }
const asUser = user => verifyUser.mockImplementation(async req => (req.headers.authorization ? user : null))

beforeEach(async () => {
  await query('TRUNCATE sealed_pool_games, sealed_pools, tournaments')
})

afterAll(async () => {
  await getPool().end()
})

describe('schema', () => {
  it('has the tournaments table and the new sealed_pools columns', async () => {
    const { rows } = await query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'sealed_pools' AND column_name = ANY($1)",
      [['tournament_ref', 'config', 'cards', 'boosters', 'created_by']],
    )
    expect(rows.map(r => r.column_name).sort()).toEqual(['boosters', 'cards', 'config', 'created_by', 'tournament_ref'])
    const t = await query("SELECT 1 FROM information_schema.tables WHERE table_name = 'tournaments'")
    expect(t.rows).toHaveLength(1)
  })
})

describe('legacy flows store their pools', () => {
  it('creates the normal pool with stored cards/boosters, the active format as config, and created_by', async () => {
    const p = await getOrCreateNormalPool('alice', { createdBy: 'page' })
    expect(p.kind).toBe('normal')
    expect(p.config.source.setCode).toBe('EOLE') // seeded by sealed-pools-schema.sql
    expect(p.cards['ALT_EOLE_B_AX_01_C']).toBe(2)
    expect(p.boosters).toHaveLength(1)
    expect(p.created_by).toBe('page')
    const again = await getOrCreateNormalPool('alice')
    expect(again.id).toBe(p.id)
  })

  it('reset regenerates + stores a fresh pool and reports the previous deck', async () => {
    const p = await getOrCreateNormalPool('alice')
    await query("UPDATE sealed_pools SET reset_at = now() - interval '1 hour', deck_id = $2, deck_card_quantity = 30 WHERE id = $1", [p.id, 'deck-1'])
    const r = await resetNormalPool('alice')
    expect(r.previousDeckId).toBe('deck-1')
    expect(r.pool.nonce).not.toBe(p.nonce)
    expect(r.pool.cards[`NONCE_${r.pool.nonce}`]).toBe(1)
    expect(r.pool.deck_id).toBeNull()
    expect(r.pool.config.source.setCode).toBe('EOLE')
  })

  it('still enforces the reset cooldown', async () => {
    await getOrCreateNormalPool('alice')
    await resetNormalPool('alice')
    const second = await resetNormalPool('alice')
    expect(second.cooldownRemainingMs).toBeGreaterThan(0)
  })

  it('creates one stored pending prep pool per player', async () => {
    const p = await getOrCreatePreparationPool('bob', { createdBy: 'bga' })
    expect(p.kind).toBe('tournament')
    expect(p.tournament_id).toBeNull()
    expect(p.tournament_ref).toBeNull()
    expect(p.cards).toBeTruthy()
    expect(p.created_by).toBe('bga')
    expect((await getOrCreatePreparationPool('bob')).id).toBe(p.id)
  })
})

describe('tournamentStore', () => {
  it('creates, reads by id and by BGA id, and rejects a duplicate BGA id', async () => {
    const t = await mkTournament({ bgaTournamentId: '597924' })
    expect(t.format).toBe('sealed')
    expect((await getTournament(t.id)).name).toBe('Winter Cup')
    expect((await getTournamentByBgaId('597924')).id).toBe(t.id)
    expect(await getTournament('not-a-uuid')).toBeNull()
    await expect(mkTournament({ bgaTournamentId: '597924' })).rejects.toMatchObject({ code: 'bga_tournament_taken' })
  })

  it('lists by derived status, ordered by start', async () => {
    const soon = await mkTournament({ name: 'Soon', startsAt: inDays(1) })
    const later = await mkTournament({ name: 'Later', startsAt: inDays(5) })
    const running = await mkTournament({ name: 'Running', startsAt: inDays(-1) })
    const over = await mkTournament({ name: 'Over', startsAt: inDays(-10), endsAt: inDays(-1) })
    const cancelled = await mkTournament({ name: 'Cancelled', startsAt: inDays(3) })
    await updateTournament(cancelled.id, { cancelledAt: new Date() })

    expect((await listTournaments('open')).map(r => r.name)).toEqual(['Running', 'Soon', 'Later'])
    expect((await listTournaments('upcoming')).map(r => r.name)).toEqual(['Soon', 'Later'])
    expect((await listTournaments('ongoing')).map(r => r.name)).toEqual(['Running'])
    expect((await listTournaments('all')).map(r => r.name)).toEqual(['Over', 'Running', 'Soon', 'Cancelled', 'Later'])
    expect(await countOpenTournaments('org')).toBe(3)
    void later; void over
  })

  it('updates fields, and refuses config/link edits once a pool exists when requireUnlocked', async () => {
    const t = await mkTournament()
    const renamed = await updateTournament(t.id, { name: 'Renamed', endsAt: inDays(9) })
    expect(renamed.name).toBe('Renamed')
    expect(renamed.ends_at).toBeInstanceOf(Date)
    expect(renamed.updated_at.getTime()).toBeGreaterThanOrEqual(t.updated_at.getTime())

    const ok = await updateTournament(t.id, { config: { ...CONFIG, heroes: 'free' } }, { requireUnlocked: true })
    expect(ok.config.heroes).toBe('free')

    await query(
      `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce, tournament_ref, tournament_id, bound_at)
       VALUES ('alice', 'tournament', 'CYCLONE', 0, false, true, 0, 'n', $1, $2, now())`, [t.id, t.bga_tournament_id])
    expect(await countPoolsForTournament(t.id)).toBe(1)
    expect(await updateTournament(t.id, { config: CONFIG }, { requireUnlocked: true })).toBeNull()
    expect((await updateTournament(t.id, { description: 'still editable' })).description).toBe('still editable')
  })

  it('deletes only when no pool exists', async () => {
    const t = await mkTournament()
    const u = await mkTournament()
    await query(
      `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce, tournament_ref, tournament_id, bound_at)
       VALUES ('alice', 'tournament', 'CYCLONE', 0, false, true, 0, 'n', $1, $2, now())`, [t.id, t.bga_tournament_id])
    expect(await deleteTournamentIfNoPools(t.id)).toBe('has_pools')
    expect(await deleteTournamentIfNoPools(u.id)).toBe('deleted')
    expect(await deleteTournamentIfNoPools(u.id)).toBe('not_found')
  })

  it('serializes to the API shape', async () => {
    const t = await mkTournament({ bgaTournamentId: '42' })
    const json = toTournamentJson(t, { poolCount: 3 })
    expect(json).toMatchObject({
      id: t.id, name: 'Winter Cup', description: 'desc', format: 'sealed',
      bgaUrl: 'https://boardgamearena.com/tournament?id=42', bgaTournamentId: '42',
      status: 'upcoming', organizer: { name: 'Org' }, config: CONFIG, poolCount: 3,
      endsAt: null, cancelledAt: null, endedAt: null,
    })
    expect(typeof json.startsAt).toBe('string')
    expect(json).not.toHaveProperty('organizerSub')
  })
})

describe('tournament pools', () => {
  it('creates a stored pool from the tournament config, attached and pre-bound to the BGA id', async () => {
    const t = await mkTournament({ bgaTournamentId: '1001', name: 'AD name' })
    const p = await getOrCreateTournamentPool('alice', t, { createdBy: 'page' })
    expect(p.tournament_ref).toBe(t.id)
    expect(p.tournament_id).toBe('1001')
    expect(p.tournament_name).toBe('AD name')
    expect(p.bound_at).toBeInstanceOf(Date)
    expect(p.config.source.setCode).toBe('CYCLONE')
    expect(p.cards['ALT_CYCLONE_B_AX_01_C']).toBe(2)
    expect(p.created_by).toBe('page')
    expect((await getOrCreateTournamentPool('alice', t)).id).toBe(p.id)
    expect((await getPoolForTournament('alice', t.id)).id).toBe(p.id)
    expect(await getPoolForTournament('bob', t.id)).toBeNull()
  })

  it('does not consume the generic pending pool, and keeps it mintable', async () => {
    const t = await mkTournament()
    await getOrCreateTournamentPool('alice', t)
    const pending = await getOrCreatePreparationPool('alice')
    expect(pending.tournament_ref).toBeNull()
    expect(pending.tournament_id).toBeNull()
  })

  it('BGA path: a known BGA id creates from the tournament config and keeps the altered-draft name', async () => {
    const t = await mkTournament({ bgaTournamentId: '2002', name: 'AD name' })
    const p = await bindTournamentId('alice', '2002', 'BGA name - Stage 2')
    expect(p.tournament_ref).toBe(t.id)
    expect(p.tournament_name).toBe('AD name')
    expect(p.created_by).toBe('bga')
    const again = await bindTournamentId('alice', '2002', 'BGA name - Stage 3')
    expect(again.id).toBe(p.id)
    expect(again.tournament_name).toBe('AD name')
  })

  it('BGA path: an unknown BGA id still binds the legacy pending pool and takes the BGA name', async () => {
    const pending = await getOrCreatePreparationPool('alice')
    const bound = await bindTournamentId('alice', '3003', 'Some BGA tournament')
    expect(bound.id).toBe(pending.id)
    expect(bound.tournament_id).toBe('3003')
    expect(bound.tournament_ref).toBeNull()
    expect(bound.tournament_name).toBe('Some BGA tournament')
  })

  it('adopts a legacy pool already bound to the BGA id when the tournament is declared later', async () => {
    const legacy = await bindTournamentId('alice', '4004', 'Early bird')
    const t = await mkTournament({ bgaTournamentId: '4004' })
    const p = await getOrCreateTournamentPool('alice', t)
    expect(p.id).toBe(legacy.id)
    expect(p.tournament_ref).toBe(t.id)
    expect(await countPoolsByTournament([t.id])).toEqual({ [t.id]: 1 })
  })

  it('absorbs concurrent creations: one row, every caller gets it', async () => {
    const t = await mkTournament()
    const results = await Promise.all([
      getOrCreateTournamentPool('alice', t, { createdBy: 'page' }),
      getOrCreateTournamentPool('alice', t, { createdBy: 'bga' }),
      getOrCreateTournamentPool('alice', t, { createdBy: 'page' }),
      bindTournamentId('alice', t.bga_tournament_id, 'x'),
    ])
    const ids = new Set(results.map(r => r.id))
    expect(ids.size).toBe(1)
    const { rows } = await query('SELECT count(*)::int AS n FROM sealed_pools WHERE sub = $1', ['alice'])
    expect(rows[0].n).toBe(1)
  })

  it('counts by origin, lists the player\'s pools per tournament, and joins the tournament into bound pools', async () => {
    const t = await mkTournament({ name: 'Joined' })
    await getOrCreateTournamentPool('alice', t, { createdBy: 'page' })
    await getOrCreateTournamentPool('bob', t, { createdBy: 'bga' })
    expect(await countPoolsByOrigin(t.id)).toEqual({ page: 1, bga: 1, legacy: 0 })
    const mine = await poolSummariesForTournaments('alice', [t.id])
    expect(mine[t.id]).toMatchObject({ deckName: null, deckCardQuantity: null })
    const bound = await listBoundTournamentPools('alice')
    expect(bound).toHaveLength(1)
    expect(bound[0].t_name).toBe('Joined')
    expect(bound[0].t_starts_at).toBeInstanceOf(Date)
  })
})

describe('POST + GET /api/tournaments', () => {
  const body = {
    name: 'Winter Cup', description: 'Be there', bgaUrl: 'https://fr.boardgamearena.com/tournament/?id=9001',
    startsAt: inDays(3).toISOString(), endsAt: null, config: CONFIG,
  }

  it('creates for a logged-in user (201) and lists it publicly', async () => {
    asUser(ALICE)
    const created = await call(tournamentsIndex, { method: 'POST', body })
    expect(created.statusCode).toBe(201)
    expect(created.body).toMatchObject({ name: 'Winter Cup', bgaTournamentId: '9001', bgaUrl: 'https://boardgamearena.com/tournament?id=9001', status: 'upcoming', organizer: { name: 'Alice' }, poolCount: 0, locked: false })

    verifyUser.mockResolvedValue(null)
    const list = await call(tournamentsIndex, { method: 'GET', auth: false })
    expect(list.statusCode).toBe(200)
    expect(list.body.tournaments).toHaveLength(1)
    expect(list.body.tournaments[0]).not.toHaveProperty('viewer')
  })

  it('needs a login to create, validates fields + config, and rejects a reused BGA id', async () => {
    verifyUser.mockResolvedValue(null)
    expect((await call(tournamentsIndex, { method: 'POST', body })).statusCode).toBe(401)
    asUser(ALICE)
    const bad = await call(tournamentsIndex, { method: 'POST', body: { ...body, name: 'x', config: { ...CONFIG, heroes: 'nope' } } })
    expect(bad.statusCode).toBe(400)
    expect(bad.body).toEqual({ error: 'invalid_request', fields: { name: 'invalid_length' }, config: ['heroes'] })
    expect((await call(tournamentsIndex, { method: 'POST', body })).statusCode).toBe(201)
    const dup = await call(tournamentsIndex, { method: 'POST', body })
    expect(dup.statusCode).toBe(409)
    expect(dup.body).toEqual({ error: 'bga_tournament_taken' })
  })

  it('caps open tournaments at 10 per account, moderators exempt', async () => {
    asUser(ALICE)
    for (let i = 0; i < 10; i++) {
      expect((await call(tournamentsIndex, { method: 'POST', body: { ...body, bgaUrl: `https://boardgamearena.com/tournament?id=${100 + i}` } })).statusCode).toBe(201)
    }
    const eleventh = await call(tournamentsIndex, { method: 'POST', body: { ...body, bgaUrl: 'https://boardgamearena.com/tournament?id=999' } })
    expect(eleventh.statusCode).toBe(429)
    expect(eleventh.body).toEqual({ error: 'too_many_open_tournaments' })
    asUser(MOD)
    for (let i = 0; i < 11; i++) {
      expect((await call(tournamentsIndex, { method: 'POST', body: { ...body, bgaUrl: `https://boardgamearena.com/tournament?id=${200 + i}` } })).statusCode).toBe(201)
    }
  })

  it('a stale bearer on the public list still gets the anonymous view, not 401', async () => {
    await mkTournament()
    verifyUser.mockResolvedValue(null)
    const res = await call(tournamentsIndex, { method: 'GET', auth: true })
    expect(res.statusCode).toBe(200)
    expect(res.body.tournaments[0]).not.toHaveProperty('viewer')
  })

  it('adds the viewer block for a logged-in reader and filters by status', async () => {
    const t = await mkTournament({ startsAt: inDays(-1) })
    await mkTournament({ startsAt: inDays(4) })
    asUser(ALICE)
    await getOrCreateTournamentPool('alice', t)
    const ongoing = await call(tournamentsIndex, { method: 'GET', query: { status: 'ongoing' } })
    expect(ongoing.body.tournaments).toHaveLength(1)
    expect(ongoing.body.tournaments[0].viewer).toMatchObject({ hasPool: true })
    expect(ongoing.body.tournaments[0].poolCount).toBe(1)
    expect((await call(tournamentsIndex, { method: 'GET', query: { status: 'upcoming' } })).body.tournaments[0].viewer.hasPool).toBe(false)
    expect((await call(tournamentsIndex, { method: 'GET', query: { status: 'bogus' } })).statusCode).toBe(400)
  })
})

describe('GET/PATCH/DELETE /api/tournaments/:id', () => {
  it('404s unknown ids, exposes viewer/organizer data, hides poolsByOrigin from players', async () => {
    const t = await mkTournament({ organizerSub: 'alice', organizerName: 'Alice' })
    expect((await call(tournamentsItem, { query: { id: '00000000-0000-0000-0000-000000000000' }, auth: false })).statusCode).toBe(404)
    expect((await call(tournamentsItem, { query: { id: 'nope' }, auth: false })).statusCode).toBe(404)

    asUser({ ...ALICE, sub: 'bob', name: 'Bob' })
    const asBob = await call(tournamentsItem, { query: { id: t.id } })
    expect(asBob.body.viewer).toEqual({ isOrganizer: false, isModerator: false, hasPool: false, poolId: null, deck: null })
    expect(asBob.body).not.toHaveProperty('poolsByOrigin')

    asUser(ALICE)
    const asOrg = await call(tournamentsItem, { query: { id: t.id } })
    expect(asOrg.body.viewer.isOrganizer).toBe(true)
    expect(asOrg.body.poolsByOrigin).toEqual({ page: 0, bga: 0, legacy: 0 })
  })

  it('PATCH: organizer edits fields and actions; non-organizers get 403; locked fields 409', async () => {
    const t = await mkTournament({ organizerSub: 'alice', organizerName: 'Alice' })
    asUser({ ...ALICE, sub: 'bob' })
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'Hacked' } })).statusCode).toBe(403)

    asUser(ALICE)
    const renamed = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'Renamed', endsAt: inDays(10).toISOString() } })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.body.name).toBe('Renamed')
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { endsAt: inDays(-5).toISOString() } })).statusCode).toBe(400)

    const cancelled = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'cancel' } })
    expect(cancelled.body.status).toBe('cancelled')
    // A cancelled tournament stays editable: that is how a BGA link gets reused (restore + fix).
    const editedWhileCancelled = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'Edited while cancelled', bgaUrl: 'https://boardgamearena.com/tournament?id=778' } })
    expect(editedWhileCancelled.statusCode).toBe(200)
    expect(editedWhileCancelled.body).toMatchObject({ name: 'Edited while cancelled', bgaTournamentId: '778', status: 'cancelled' })
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'restore' } })).body.status).toBe('upcoming')
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'close' } })).body.status).toBe('ended')
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'reopen' } })).body.status).toBe('upcoming')
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'explode' } })).statusCode).toBe(400)

    const relinked = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { bgaUrl: 'https://boardgamearena.com/tournament?id=777', config: { ...CONFIG, heroes: 'free' } } })
    expect(relinked.body.bgaTournamentId).toBe('777')
    expect(relinked.body.config.heroes).toBe('free')

    await getOrCreateTournamentPool('carol', (await getTournament(t.id)))
    const locked = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { config: CONFIG } })
    expect(locked.statusCode).toBe(409)
    expect(locked.body).toEqual({ error: 'tournament_locked' })
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { description: 'fine' } })).statusCode).toBe(200)

    asUser(MOD)
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'Moderated' } })).statusCode).toBe(200)
  })

  it('DELETE: 204 when no pool, 409 otherwise, 403 for strangers', async () => {
    const t = await mkTournament({ organizerSub: 'alice' })
    asUser({ ...ALICE, sub: 'bob' })
    expect((await call(tournamentsItem, { method: 'DELETE', query: { id: t.id } })).statusCode).toBe(403)
    asUser(ALICE)
    await getOrCreateTournamentPool('carol', t)
    const blocked = await call(tournamentsItem, { method: 'DELETE', query: { id: t.id } })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.body).toEqual({ error: 'tournament_has_pools' })
    const u = await mkTournament({ organizerSub: 'alice' })
    expect((await call(tournamentsItem, { method: 'DELETE', query: { id: u.id } })).statusCode).toBe(204)
    expect(await getTournament(u.id)).toBeNull()
  })
})

describe('GET /api/tournaments/:id/pool', () => {
  it('creates the caller\'s pool once, returns the pool shape with the tournament block', async () => {
    const t = await mkTournament({ name: 'Pool me' })
    verifyUser.mockResolvedValue(null)
    expect((await call(tournamentPoolFor, { query: { id: t.id } })).statusCode).toBe(401)
    asUser(ALICE)
    const first = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(first.statusCode).toBe(200)
    expect(first.body).toMatchObject({ kind: 'tournament', tournamentRef: t.id, tournamentName: 'Pool me', tournament: { id: t.id, name: 'Pool me', status: 'upcoming' }, gamesPlayed: 0, deck: null })
    expect(first.body.boosters).toHaveLength(1)
    expect(first.body.cards['ALT_CYCLONE_B_AX_01_C']).toBe(2)
    const second = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(second.body.id).toBe(first.body.id)
  })

  it('refuses to CREATE on a cancelled/ended tournament but still returns an existing pool', async () => {
    const t = await mkTournament()
    asUser(ALICE)
    await call(tournamentPoolFor, { query: { id: t.id } })
    await updateTournament(t.id, { cancelledAt: new Date() })
    expect((await call(tournamentPoolFor, { query: { id: t.id } })).statusCode).toBe(200)
    asUser({ ...ALICE, sub: 'bob' })
    const refused = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(refused.statusCode).toBe(409)
    expect(refused.body).toEqual({ error: 'tournament_closed', status: 'cancelled' })
    expect((await call(tournamentPoolFor, { query: { id: '00000000-0000-0000-0000-000000000000' } })).statusCode).toBe(404)
  })
})

describe('GET /api/tournament-bound-pools', () => {
  it('carries the tournament block for declared pools and null for legacy-bound ones', async () => {
    const t = await mkTournament({ name: 'Declared' })
    asUser(ALICE)
    await getOrCreateTournamentPool('alice', t)
    await bindTournamentId('alice', '5005', 'Legacy one')
    verifyUser.mockImplementation(async () => ALICE)
    const { verifySub } = await import('../../api/_lib/auth.js')
    verifySub.mockResolvedValue('alice')
    const res = await call(boundPools)
    expect(res.statusCode).toBe(200)
    const byName = Object.fromEntries(res.body.pools.map(p => [p.tournamentName, p]))
    expect(byName['Declared'].tournament).toMatchObject({ id: t.id, name: 'Declared', status: 'upcoming' })
    expect(byName['Legacy one'].tournament).toBeNull()
  })
})
