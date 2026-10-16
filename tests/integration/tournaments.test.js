// Integration tests for the user-created tournaments feature (store + handlers) against
// the REAL Postgres of docker-compose.test.yml. Pool generation is mocked (no network):
// buildPool returns a tiny fixed pool, which is all the SQL paths need.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { query, getPool } from '../../src/lib/db.js'
import { getOrCreateNormalPool, resetNormalPool, getOrCreatePreparationPool } from '../../src/lib/poolStore.js'
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
