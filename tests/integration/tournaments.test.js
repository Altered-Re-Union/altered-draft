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
    buildPool: vi.fn(async (sub, { config, nonce }) => {
      const sets = config.source.type === 'faction' ? Object.keys(config.source.sets) : [config.source.setCode]
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
  return {
    ...mod,
    fetchSet: vi.fn(async setCode => [card(`ALT_${setCode}_B_AX_01_C`, 'AX', 'HERO'), card(`ALT_${setCode}_B_BR_02_R1`, 'BR')]),
    fetchUniques: vi.fn(async () => []),
  }
})

vi.mock('../../api/_lib/auth.js', async importOriginal => {
  const mod = await importOriginal()
  return { ...mod, verifyUser: vi.fn(async () => null), verifySub: vi.fn(async () => null) }
})
import { verifyUser, verifySub } from '../../api/_lib/auth.js'
import { buildPool } from '../../src/lib/poolBuilder.js'
import bgaDecklist from '../../api/tournament-bga-decklist.js'
import fs from 'node:fs'
import path from 'node:path'
import tournamentsIndex from '../../api/tournaments/index.js'
import tournamentsItem from '../../api/tournaments/[id].js'
import tournamentPoolFor from '../../api/tournaments/[id]/pool.js'
import boundPools from '../../api/tournament-bound-pools.js'
import { freezeSealedPools } from '../../scripts/freeze-sealed-pools.mjs'

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

  it('reports the pending prep pool without creating one', async () => {
    const { verifySub } = await import('../../api/_lib/auth.js')
    verifySub.mockResolvedValue('alice')
    let res = await call(boundPools)
    expect(res.body.pending).toBeNull()
    expect((await query("SELECT count(*)::int AS n FROM sealed_pools WHERE sub = 'alice'")).rows[0].n).toBe(0)

    const prep = await getOrCreatePreparationPool('alice')
    res = await call(boundPools)
    expect(res.body.pending).toEqual({ id: prep.id, deck: null })

    await bindTournamentId('alice', '6006', 'Now bound')
    res = await call(boundPools)
    expect(res.body.pending).toBeNull()
    expect(res.body.pools.map(p => p.id)).toEqual([prep.id])
  })
})

describe('freeze-sealed-pools', () => {
  it('stores cards/boosters/config on rows that lack them, skips the others, survives one failure', async () => {
    await query(
      `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce)
       VALUES ('a', 'normal', 'EOLE', 1, false, false, 1, 'n1'), ('b', 'normal', 'EOLE', 1, false, false, 1, 'n2')`)
    const stored = await getOrCreateNormalPool('c')
    const regenerate = vi.fn(async (sub, row) => {
      if (sub === 'b') throw new Error('network down')
      return { counts: { X: 1 }, boosters: [['X']] }
    })
    const result = await freezeSealedPools({ regenerate })
    expect(result).toEqual({ total: 2, frozen: 1, failed: 1 })
    const a = (await query("SELECT * FROM sealed_pools WHERE sub = 'a'")).rows[0]
    expect(a.cards).toEqual({ X: 1 })
    expect(a.config.source.setCode).toBe('EOLE')
    expect((await query("SELECT cards FROM sealed_pools WHERE sub = 'b'")).rows[0].cards).toBeNull()
    expect(regenerate).not.toHaveBeenCalledWith('c', expect.anything())
    void stored
  })
})

describe('final review fixes', () => {
  it('PATCH to a BGA link already used by another tournament answers 409 bga_tournament_taken, not 500', async () => {
    const t = await mkTournament({ organizerSub: 'alice' })
    await mkTournament({ bgaTournamentId: '31337' })
    asUser(ALICE)
    const res = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { bgaUrl: 'https://boardgamearena.com/tournament?id=31337' } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'bga_tournament_taken' })
  })

  it('renaming a tournament renames its existing pools (deck names derive from tournament_name)', async () => {
    const t = await mkTournament({ organizerSub: 'alice', name: 'Old name' })
    await getOrCreateTournamentPool('bob', t)
    asUser(ALICE)
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'New name' } })).statusCode).toBe(200)
    expect((await getPoolForTournament('bob', t.id)).tournament_name).toBe('New name')
  })

  it('an adopted legacy pool takes the altered-draft name', async () => {
    await bindTournamentId('alice', '6006', 'BGA stage name')
    const t = await mkTournament({ bgaTournamentId: '6006', name: 'AD name' })
    const p = await getOrCreateTournamentPool('alice', t)
    expect(p.tournament_name).toBe('AD name')
  })
})

describe('detach (moderators) and other follow-ups', () => {
  it('a moderator detaches a squatted declaration: every pool deleted, BGA id freed for the real organizer', async () => {
    const squat = await mkTournament({ organizerSub: 'alice', bgaTournamentId: '7007', name: 'Squat' })
    const played = await getOrCreateTournamentPool('bob', squat)
    await query('INSERT INTO sealed_pool_games (pool_id, game_id) VALUES ($1, $2)', [played.id, 'g1'])
    await getOrCreateTournamentPool('carol', squat)

    asUser(ALICE)
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: squat.id }, body: { action: 'detach' } })).statusCode).toBe(403)

    asUser(MOD)
    const detached = await call(tournamentsItem, { method: 'PATCH', query: { id: squat.id }, body: { action: 'detach' } })
    expect(detached.statusCode).toBe(200)
    expect(detached.body).toMatchObject({ status: 'detached', poolCount: 0 })
    expect(typeof detached.body.detachedAt).toBe('string')
    expect((await query('SELECT count(*)::int AS n FROM sealed_pools WHERE tournament_ref = $1', [squat.id])).rows[0].n).toBe(0)

    // Frozen: no edit, no new pool, hidden from the open list and from the creation cap.
    asUser(ALICE)
    const edit = await call(tournamentsItem, { method: 'PATCH', query: { id: squat.id }, body: { name: 'Back' } })
    expect(edit.statusCode).toBe(409)
    expect(edit.body).toEqual({ error: 'tournament_detached' })
    expect((await call(tournamentPoolFor, { query: { id: squat.id } })).body).toEqual({ error: 'tournament_closed', status: 'detached' })
    expect((await listTournaments('open')).map(r => r.id)).not.toContain(squat.id)
    expect(await countOpenTournaments('alice')).toBe(0)

    // The real organizer declares the same BGA tournament; BGA's call now lands on it.
    const real = await mkTournament({ organizerSub: 'dave', bgaTournamentId: '7007', name: 'Real' })
    const p = await bindTournamentId('bob', '7007', 'BGA name')
    expect(p.tournament_ref).toBe(real.id)
    expect(p.tournament_name).toBe('Real')
  })

  it('reopen clears an end date already reached, so the tournament is open again', async () => {
    const t = await mkTournament({ organizerSub: 'alice', startsAt: inDays(-5), endsAt: inDays(-1) })
    asUser(ALICE)
    const res = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'reopen' } })
    expect(res.body).toMatchObject({ status: 'ongoing', endsAt: null })
    const future = await mkTournament({ organizerSub: 'alice', endsAt: inDays(9) })
    await call(tournamentsItem, { method: 'PATCH', query: { id: future.id }, body: { action: 'close' } })
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: future.id }, body: { action: 'reopen' } })).body.endsAt).not.toBeNull()
  })

  it('lists declared tournaments first in the player\'s bound pools', async () => {
    const t = await mkTournament({ name: 'Declared' })
    await getOrCreateTournamentPool('alice', t)
    await bindTournamentId('alice', '8008', 'Legacy bound later')
    expect((await listBoundTournamentPools('alice')).map(p => p.tournament_name)).toEqual(['Declared', 'Legacy bound later'])
  })
})

describe('GET /api/tournaments?bgaId= (form duplicate-link check)', () => {
  it('returns the live declaration of that BGA id whatever its status, and nothing for a free or detached id', async () => {
    const t = await mkTournament({ bgaTournamentId: '424201', name: 'Declared' })
    await updateTournament(t.id, { cancelledAt: new Date() })
    const old = await mkTournament({ bgaTournamentId: '424202' })
    await query('UPDATE tournaments SET detached_at = now() WHERE id = $1', [old.id])
    verifyUser.mockResolvedValue(null)
    const taken = await call(tournamentsIndex, { query: { bgaId: '424201' }, auth: false })
    expect(taken.statusCode).toBe(200)
    expect(taken.body.tournaments.map(x => [x.id, x.name, x.status])).toEqual([[t.id, 'Declared', 'cancelled']])
    expect((await call(tournamentsIndex, { query: { bgaId: '424202' }, auth: false })).body.tournaments).toEqual([])
    expect((await call(tournamentsIndex, { query: { bgaId: '999' }, auth: false })).body.tournaments).toEqual([])
    expect((await call(tournamentsIndex, { query: { bgaId: 'abc' }, auth: false })).statusCode).toBe(400)
  })
})

describe('GET /api/tournaments?mine=1 (my created tournaments)', () => {
  it('lists every tournament the caller organizes, whatever its status, most recent start first; 401 logged out', async () => {
    const soon = await mkTournament({ organizerSub: 'alice', name: 'Soon', startsAt: inDays(1) })
    const later = await mkTournament({ organizerSub: 'alice', name: 'Later', startsAt: inDays(9) })
    const gone = await mkTournament({ organizerSub: 'alice', name: 'Cancelled', startsAt: inDays(4) })
    await updateTournament(gone.id, { cancelledAt: new Date() })
    await mkTournament({ organizerSub: 'bob', name: 'Not mine' })
    asUser(ALICE)
    const res = await call(tournamentsIndex, { query: { mine: '1' } })
    expect(res.statusCode).toBe(200)
    expect(res.body.tournaments.map(x => [x.name, x.status])).toEqual([['Later', 'upcoming'], ['Cancelled', 'cancelled'], ['Soon', 'upcoming']])
    expect(res.body.tournaments[0].viewer.isOrganizer).toBe(true)
    void soon; void later
    verifyUser.mockResolvedValue(null)
    expect((await call(tournamentsIndex, { query: { mine: '1' }, auth: false })).statusCode).toBe(401)
  })
})

describe('declaring a BGA tournament already played with legacy pools (option A)', () => {
  // A legacy pool bound to a BGA id, with explicit snapshot columns (the generic format of the day).
  const legacyPool = (sub, bgaId, setCode = 'EOLE') => query(
    `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce, tournament_id, tournament_name, bound_at, cards, boosters, created_by)
     VALUES ($1, 'tournament', $2, 1, false, false, 1, $3, $4, 'BGA name', now(), '{"X":1}', '[]', 'bga') RETURNING id`,
    [sub, setCode, `n-${sub}-${bgaId}`, bgaId])
  const body = bgaId => ({ name: 'Late cup', bgaUrl: `https://boardgamearena.com/tournament?id=${bgaId}`, startsAt: inDays(3).toISOString(), config: CONFIG })

  it('POST adopts every legacy pool at once and takes their format, locked from the start', async () => {
    await legacyPool('carol', '515151'); await legacyPool('dave', '515151')
    asUser(ALICE)
    const res = await call(tournamentsIndex, { method: 'POST', body: body('515151') })
    expect(res.statusCode).toBe(201)
    expect(res.body.config).toMatchObject({ source: { setCode: 'EOLE' }, heroes: 'free', uniques: { inBoosters: 1, guaranteed: 1 } })
    expect(res.body).toMatchObject({ poolCount: 2, locked: true })
    const { rows } = await query('SELECT tournament_ref, tournament_name FROM sealed_pools WHERE tournament_id = $1', ['515151'])
    expect(rows).toEqual([{ tournament_ref: res.body.id, tournament_name: 'Late cup' }, { tournament_ref: res.body.id, tournament_name: 'Late cup' }])
    // carol's page now sees her pool right away
    asUser({ ...ALICE, sub: 'carol' })
    expect((await call(tournamentsItem, { query: { id: res.body.id } })).body.viewer.hasPool).toBe(true)
  })

  it('POST refuses when the legacy pools of that BGA id do not share one format', async () => {
    await legacyPool('carol', '525252', 'EOLE'); await legacyPool('dave', '525252', 'CYCLONE')
    asUser(ALICE)
    const res = await call(tournamentsIndex, { method: 'POST', body: body('525252') })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'bga_tournament_mixed_formats' })
    expect((await query("SELECT count(*)::int AS n FROM tournaments WHERE bga_tournament_id = '525252'")).rows[0].n).toBe(0)
  })

  it('PATCH to a BGA link with legacy pools adopts them and takes their format', async () => {
    const t = await mkTournament({ organizerSub: 'alice' })
    await legacyPool('carol', '535353')
    asUser(ALICE)
    const res = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { bgaUrl: 'https://boardgamearena.com/tournament?id=535353', config: CONFIG } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ bgaTournamentId: '535353', poolCount: 1, locked: true, config: { source: { setCode: 'EOLE' } } })
    await legacyPool('dave', '545454', 'EOLE'); await legacyPool('erin', '545454', 'CYCLONE')
    const u = await mkTournament({ organizerSub: 'alice' })
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: u.id }, body: { bgaUrl: 'https://boardgamearena.com/tournament?id=545454' } })).body)
      .toEqual({ error: 'bga_tournament_mixed_formats' })
  })

  it('the ?bgaId= lookup reports the imposed (or mixed) legacy format to the form', async () => {
    await legacyPool('carol', '555555')
    verifyUser.mockResolvedValue(null)
    const one = await call(tournamentsIndex, { query: { bgaId: '555555' }, auth: false })
    expect(one.body).toMatchObject({ tournaments: [], legacy: { pools: 1, mixed: false, config: { source: { setCode: 'EOLE' } } } })
    await legacyPool('dave', '555555', 'CYCLONE')
    expect((await call(tournamentsIndex, { query: { bgaId: '555555' }, auth: false })).body.legacy).toEqual({ pools: 2, mixed: true, config: null })
    expect((await call(tournamentsIndex, { query: { bgaId: '565656' }, auth: false })).body.legacy).toBeNull()
  })
})


describe('PR #20 review fixes', () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  it('a pool left attached to a detached declaration is re-adopted by the new declaration (never null)', async () => {
    const old = await mkTournament({ bgaTournamentId: '707070', name: 'Squat' })
    const stray = await getOrCreateTournamentPool('alice', old)
    await query('UPDATE tournaments SET detached_at = now() WHERE id = $1', [old.id]) // e.g. a pool inserted during a detach
    const real = await mkTournament({ bgaTournamentId: '707070', name: 'Real' })
    const p = await getOrCreateTournamentPool('alice', real)
    expect(p).not.toBeNull()
    expect(p.id).toBe(stray.id)
    expect(p.tournament_ref).toBe(real.id)
  })

  it('a stale tournament row cannot create a pool with an outdated config', async () => {
    const t = await mkTournament()
    await query("UPDATE tournaments SET config = jsonb_set(config, '{source,setCode}', '\"EOLE\"') WHERE id = $1", [t.id])
    const p = await getOrCreateTournamentPool('alice', t) // t still says CYCLONE
    expect(p.config.source.setCode).toBe('EOLE')
  })

  it('a stale row of a detached tournament refuses to create a pool', async () => {
    const t = await mkTournament()
    await query('UPDATE tournaments SET detached_at = now() WHERE id = $1', [t.id])
    await expect(getOrCreateTournamentPool('alice', t)).rejects.toMatchObject({ code: 'tournament_unavailable' })
  })

  it('a config change racing the first pool never leaves a pool in an outdated format', async () => {
    const base = vi.mocked(buildPool).getMockImplementation()
    for (let i = 0; i < 4; i++) {
      const t = await mkTournament({ organizerSub: 'alice' })
      vi.mocked(buildPool).mockImplementationOnce(async (...a) => { await sleep(150); return base(...a) })
      asUser(ALICE)
      const [pool, patch] = await Promise.all([
        getOrCreateTournamentPool(`p${i}`, t),
        sleep(30).then(() => call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { config: { ...CONFIG, source: { type: 'set', setCode: 'EOLE' } } } })),
      ])
      const final = await getTournament(t.id)
      expect(pool.config.source.setCode).toBe(final.config.source.setCode)
      expect([200, 409]).toContain(patch.statusCode)
    }
  })

  it('detach releases the adopted pools (re-adopted by the next declaration) and deletes only the declaration\'s own', async () => {
    const legacy = await bindTournamentId('carol', '717171', 'BGA name') // carol already plays it
    const squat = await mkTournament({ bgaTournamentId: '717171', name: 'Squat', config: { ...CONFIG, source: { type: 'set', setCode: 'EOLE', boosters: 7 } } })
    const native = await getOrCreateTournamentPool('dave', squat)
    expect((await query('SELECT tournament_ref, adopted_at FROM sealed_pools WHERE id = $1', [legacy.id])).rows[0]).toMatchObject({ tournament_ref: squat.id })
    asUser(MOD)
    const res = await call(tournamentsItem, { method: 'PATCH', query: { id: squat.id }, body: { action: 'detach' } })
    expect(res.statusCode).toBe(200)
    const after = (await query('SELECT id, tournament_ref, adopted_at, tournament_id FROM sealed_pools WHERE id = ANY($1)', [[legacy.id, native.id]])).rows
    expect(after).toEqual([{ id: legacy.id, tournament_ref: null, adopted_at: null, tournament_id: '717171' }])
    const real = await mkTournament({ bgaTournamentId: '717171', name: 'Real', config: { ...CONFIG, source: { type: 'set', setCode: 'EOLE', boosters: 7 } } })
    expect((await query('SELECT tournament_ref, tournament_name FROM sealed_pools WHERE id = $1', [legacy.id])).rows[0]).toEqual({ tournament_ref: real.id, tournament_name: 'Real' })
  })

  it('tournament-bga-decklist end to end on a declared tournament: creates the pool, records the game, mints a Random deck', async () => {
    const t = await mkTournament({ bgaTournamentId: '727272', name: 'Declared cup' })
    vi.mocked(verifySub).mockResolvedValue('erin')
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      calls.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`)
      if ((init.method ?? 'GET') === 'POST') return { ok: true, status: 201, json: async () => ({ id: 'deck-erin', ...JSON.parse(init.body) }) }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    try {
      const res = await call(bgaDecklist, { query: { tournamentId: '727272', tournamentName: 'BGA - Stage 1', gameId: 'g1' } })
      expect(res.statusCode).toBe(200)
      expect(res.body['hydra:totalItems']).toBe(1)
      expect(res.body['hydra:member'][0]).toMatchObject({ id: 'deck-erin', name: 'Random Declared cup', format: 'sealed' })
      const pool = (await query("SELECT * FROM sealed_pools WHERE sub = 'erin'")).rows[0]
      expect(pool).toMatchObject({ tournament_ref: t.id, tournament_id: '727272', created_by: 'bga', deck_id: 'deck-erin' })
      expect((await query('SELECT game_id FROM sealed_pool_games WHERE pool_id = $1', [pool.id])).rows).toEqual([{ game_id: 'g1' }])
      expect(calls).toEqual(['POST /api/decks', 'PATCH /api/decks/deck-erin'])
    } finally {
      vi.unstubAllGlobals()
      vi.mocked(verifySub).mockResolvedValue(null)
    }
  })

  it('sealed-pools-schema.sql replays twice on a populated database without touching the data', async () => {
    const t = await mkTournament({ name: 'Survivor' })
    const p = await getOrCreateTournamentPool('alice', t)
    await query("UPDATE sealed_pools SET created_by = 'page' WHERE id = $1", [p.id])
    const sql = fs.readFileSync(path.resolve(__dirname, '../../sealed-pools-schema.sql'), 'utf8')
    await query(sql)
    await query(sql)
    expect((await query('SELECT tournament_ref, created_by, cards IS NOT NULL AS stored FROM sealed_pools WHERE id = $1', [p.id])).rows[0]).toEqual({ tournament_ref: t.id, created_by: 'page', stored: true })
    const fks = (await query("SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'sealed_pools'::regclass AND contype = 'f' AND confrelid = 'tournaments'::regclass")).rows[0].n
    expect(fks).toBe(1)
    const idx = (await query("SELECT indexname FROM pg_indexes WHERE tablename IN ('sealed_pools', 'tournaments')")).rows.map(r => r.indexname)
    expect(idx).toEqual(expect.arrayContaining(['tournaments_bga_tournament_id_live', 'sealed_pools_one_per_sub_per_tournament_ref', 'sealed_pools_by_tournament_ref', 'sealed_pools_legacy_by_bga_id']))
    expect(idx).not.toContain('tournaments_bga_tournament_id')
  })
})

const FACTION_CONFIG = { ...CONFIG, source: { type: 'faction', faction: 'AX', sets: { CYCLONE: 1, EOLE: 2 }, boosters: 7 }, uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null } }

describe('mono-faction tournaments', () => {
  it('stores a faction pool with a null set_code and the config', async () => {
    const tn = await mkTournament({ config: FACTION_CONFIG })
    const pool = await getOrCreateTournamentPool('alice', tn, { createdBy: 'page' })
    const { rows: [row] } = await query('SELECT set_code, config, cards, boosters FROM sealed_pools WHERE id = $1', [pool.id])
    expect(row.set_code).toBeNull()
    expect(row.config.source).toEqual(FACTION_CONFIG.source)
    expect(Object.keys(row.cards).some(r => r.startsWith('ALT_CYCLONE_'))).toBe(true)
    expect(Object.keys(row.cards).some(r => r.startsWith('ALT_EOLE_'))).toBe(true)
  })

  it('BGA path: the deck-list call resolves cards from every set of a faction pool', async () => {
    const tn = await mkTournament({ config: FACTION_CONFIG, bgaTournamentId: '737373' })
    const { fetchSet } = await import('../../src/lib/cardData.js')
    fetchSet.mockClear()
    vi.mocked(verifySub).mockResolvedValue('frank')
    let posted = null
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      if ((init.method ?? 'GET') === 'POST') { posted = JSON.parse(init.body); return { ok: true, status: 201, json: async () => ({ id: 'deck-frank', ...posted }) } }
      return { ok: true, status: 200, json: async () => ({}) }
    }))
    try {
      const res = await call(bgaDecklist, { query: { tournamentId: tn.bga_tournament_id, tournamentName: 'x', gameId: 'g1' } })
      expect(res.statusCode).toBe(200)
      expect(fetchSet.mock.calls.map(c => c[0])).toEqual(expect.arrayContaining(['CYCLONE', 'EOLE'])) // the mock's NONCE_ ref adds a harmless extra call
      const pool = (await query("SELECT cards FROM sealed_pools WHERE sub = 'frank'")).rows[0]
      expect(posted.deckCards.length).toBeGreaterThan(0)
      for (const { cardReference } of posted.deckCards) expect(Object.keys(pool.cards)).toContain(cardReference)
    } finally {
      vi.unstubAllGlobals()
      vi.mocked(verifySub).mockResolvedValue(null)
    }
  })
})
