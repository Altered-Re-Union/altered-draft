// Integration tests for the user-created tournaments feature (store + handlers) against
// the REAL Postgres of docker-compose.test.yml. Pool generation is mocked (no network):
// buildPool returns a tiny fixed pool, which is all the SQL paths need.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { query, getPool } from '../../src/lib/db.js'
import { getOrCreateNormalPool, resetNormalPool, getOrCreatePreparationPool } from '../../src/lib/poolStore.js'

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
