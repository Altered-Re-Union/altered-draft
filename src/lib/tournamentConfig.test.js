import { describe, it, expect } from 'vitest'
import { validateTournamentConfig, configFromLegacyFormat, legacyColumnsFromConfig } from './tournamentConfig.js'

const valid = {
  format: 'sealed',
  source: { type: 'set', setCode: 'CYCLONE', boosters: 7 },
  heroes: 'packs',
  uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false },
  excludeBanlist: true,
}

describe('validateTournamentConfig', () => {
  it('normalizes a valid config (numbers coerced, booleans defaulted, version stamped)', () => {
    const r = validateTournamentConfig({ ...valid, uniques: { inBoosters: '2', guaranteed: 0 }, excludeBanlist: undefined })
    expect(r.ok).toBe(true)
    expect(r.config).toEqual({
      v: 1, format: 'sealed',
      source: { type: 'set', setCode: 'CYCLONE', boosters: 7 },
      heroes: 'packs',
      uniques: { inBoosters: 2, guaranteed: 0, evenFactions: false },
      excludeBanlist: false,
    })
  })

  it('accepts a missing format/boosters (defaults) but rejects other values', () => {
    expect(validateTournamentConfig({ ...valid, format: undefined, source: { type: 'set', setCode: 'EOLE' } }).ok).toBe(true)
    expect(validateTournamentConfig({ ...valid, format: 'draft' }).errors).toContain('format')
    expect(validateTournamentConfig({ ...valid, source: { ...valid.source, boosters: 6 } }).errors).toContain('source.boosters')
  })

  it('rejects unknown/hidden sets, other source types, bad hero modes and out-of-range uniques', () => {
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'NOPE' } }).errors).toContain('source.setCode')
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'COREKS' } }).errors).toContain('source.setCode')
    expect(validateTournamentConfig({ ...valid, source: { type: 'cube', setCode: 'CORE' } }).errors).toContain('source.type')
    expect(validateTournamentConfig({ ...valid, heroes: 'draft' }).errors).toContain('heroes')
    expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 8, guaranteed: 0 } }).errors).toContain('uniques.inBoosters')
    expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 0, guaranteed: -1 } }).errors).toContain('uniques.guaranteed')
    expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 'x', guaranteed: 0 } }).errors).toContain('uniques.inBoosters')
  })

  it('rejects uniques on a set without faction-range data (FUGUE) but allows zero', () => {
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'FUGUE' } }).errors).toContain('uniques.unsupportedSet')
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'FUGUE' }, uniques: { inBoosters: 0, guaranteed: 0 } }).ok).toBe(true)
  })

  it('rejects non-object input without throwing', () => {
    expect(validateTournamentConfig(null).ok).toBe(false)
    expect(validateTournamentConfig('x').ok).toBe(false)
  })
})

describe('legacy format <-> config', () => {
  const row = { set_code: 'EOLE', unique_count: 1, even_factions: false, heroes_in_pool: false, guaranteed_uniques: 1 }

  it('converts a current_format row into a config', () => {
    expect(configFromLegacyFormat(row)).toEqual({
      v: 1, format: 'sealed',
      source: { type: 'set', setCode: 'EOLE', boosters: 7 },
      heroes: 'free',
      uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false },
      excludeBanlist: false,
    })
  })

  it('round-trips through legacyColumnsFromConfig', () => {
    expect(legacyColumnsFromConfig(configFromLegacyFormat(row))).toEqual(row)
  })

  it('defaults a missing guaranteed_uniques to 0', () => {
    expect(configFromLegacyFormat({ ...row, guaranteed_uniques: undefined }).uniques.guaranteed).toBe(0)
  })
})
