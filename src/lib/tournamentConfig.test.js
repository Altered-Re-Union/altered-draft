import { describe, it, expect } from 'vitest'
import { validateTournamentConfig, configFromLegacyFormat, legacyColumnsFromConfig, legacyFormatForBgaTournament, configSetCodes } from './tournamentConfig.js'

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
      uniques: { inBoosters: 2, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null },
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
      uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false, randomOneIn: null },
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

describe('validateTournamentConfig evenFactions', () => {
  it('drops evenFactions when fewer than 2 uniques are drawn (it only means something from 2 on)', () => {
    const one = validateTournamentConfig({ ...valid, uniques: { inBoosters: 1, guaranteed: 0, evenFactions: true } })
    expect(one.config.uniques.evenFactions).toBe(false)
    const two = validateTournamentConfig({ ...valid, uniques: { inBoosters: 1, guaranteed: 1, evenFactions: true } })
    expect(two.config.uniques.evenFactions).toBe(true)
  })
})

describe('validateTournamentConfig faction', () => {
  it('keeps a valid faction and rejects an unknown one', () => {
    expect(validateTournamentConfig({ ...valid, uniques: { ...valid.uniques, faction: 'AX' } }).config.uniques.faction).toBe('AX')
    expect(validateTournamentConfig({ ...valid, uniques: { ...valid.uniques, faction: 'XX' } }).errors).toContain('uniques.faction')
    expect(validateTournamentConfig({ ...valid, uniques: { ...valid.uniques, faction: 'ax' } }).errors).toContain('uniques.faction')
  })

  it('defaults a missing faction to null (all factions)', () => {
    expect(validateTournamentConfig(valid).config.uniques.faction).toBe(null)
  })

  it('drops the faction when no unique is drawn', () => {
    const r = validateTournamentConfig({ ...valid, uniques: { inBoosters: 0, guaranteed: 0, faction: 'BR' } })
    expect(r.config.uniques.faction).toBe(null)
  })

  it('drops evenFactions when a faction is set', () => {
    const r = validateTournamentConfig({ ...valid, uniques: { inBoosters: 2, guaranteed: 2, evenFactions: true, faction: 'YZ' } })
    expect(r.config.uniques).toEqual({ inBoosters: 2, guaranteed: 2, evenFactions: false, faction: 'YZ', randomOneIn: null })
  })
})

describe('legacyFormatForBgaTournament', () => {
  const cols = { set_code: 'EOLE', unique_count: 1, even_factions: false, heroes_in_pool: false, guaranteed_uniques: 1 }

  it('is null when no legacy pool is bound to the BGA id', () => {
    expect(legacyFormatForBgaTournament([])).toBeNull()
  })

  it('imposes the legacy pools\' format when they all share it', () => {
    expect(legacyFormatForBgaTournament([{ ...cols, count: 2 }, { ...cols, count: 1 }])).toEqual({
      pools: 3, mixed: false, config: configFromLegacyFormat(cols),
    })
  })

  it('reports mixed formats (no config) when the legacy pools differ', () => {
    expect(legacyFormatForBgaTournament([{ ...cols, count: 2 }, { ...cols, set_code: 'CYCLONE', count: 1 }])).toEqual({ pools: 3, mixed: true, config: null })
  })
})

describe('validateTournamentConfig faction source', () => {
  const factionCfg = (over = {}) => ({
    source: { type: 'faction', faction: 'AX', sets: { CORE: 1, BISE: 2, FUGUE: 1 } },
    heroes: 'packs', uniques: { inBoosters: 1, guaranteed: 1 }, ...over,
  })
  it('accepts a faction source, drops zero weights, coerces string weights, forces the uniques faction', () => {
    const r = validateTournamentConfig(factionCfg({ source: { type: 'faction', faction: 'AX', sets: { CORE: '2', ALIZE: 0, BISE: 1 } }, uniques: { inBoosters: 1, guaranteed: 0, evenFactions: true, faction: 'BR' } }))
    expect(r.ok).toBe(true)
    expect(r.config.source).toEqual({ type: 'faction', faction: 'AX', sets: { CORE: 2, BISE: 1 }, boosters: 7 })
    expect(r.config.uniques).toEqual({ inBoosters: 1, guaranteed: 0, evenFactions: false, faction: 'AX', randomOneIn: null })
  })
  it('keeps the sets in SETS order whatever the input order', () => {
    expect(Object.keys(validateTournamentConfig(factionCfg({ source: { type: 'faction', faction: 'LY', sets: { EOLE: 1, CORE: 1 } } })).config.source.sets)).toEqual(['CORE', 'EOLE'])
  })
  it('drops the uniques faction when no unique is drawn', () => {
    expect(validateTournamentConfig(factionCfg({ uniques: { inBoosters: 0, guaranteed: 0 } })).config.uniques.faction).toBeNull()
  })
  it.each([
    ['unknown faction', { type: 'faction', faction: 'XX', sets: { CORE: 1 } }, 'source.faction'],
    ['hidden set', { type: 'faction', faction: 'AX', sets: { COREKS: 1 } }, 'source.sets'],
    ['unknown set', { type: 'faction', faction: 'AX', sets: { NOPE: 1 } }, 'source.sets'],
    ['weight above the max', { type: 'faction', faction: 'AX', sets: { CORE: 4 } }, 'source.sets'],
    ['negative weight', { type: 'faction', faction: 'AX', sets: { CORE: -1 } }, 'source.sets'],
    ['non-integer weight', { type: 'faction', faction: 'AX', sets: { CORE: 1.5 } }, 'source.sets'],
    ['all zero', { type: 'faction', faction: 'AX', sets: { CORE: 0, BISE: 0 } }, 'source.sets'],
    ['sets not an object', { type: 'faction', faction: 'AX', sets: ['CORE'] }, 'source.sets'],
    ['unknown type', { type: 'cube', faction: 'AX', sets: { CORE: 1 } }, 'source.type'],
  ])('rejects %s', (_, source, code) => {
    const r = validateTournamentConfig(factionCfg({ source }))
    expect(r.ok).toBe(false); expect(r.errors).toContain(code)
  })
  it('refuses uniques only when no included set has faction-range data', () => {
    expect(validateTournamentConfig(factionCfg({ source: { type: 'faction', faction: 'AX', sets: { FUGUE: 1 } } })).errors).toEqual(['uniques.unsupportedSet'])
    expect(validateTournamentConfig(factionCfg({ source: { type: 'faction', faction: 'AX', sets: { FUGUE: 1, CYCLONE: 1 } } })).ok).toBe(true)
    expect(validateTournamentConfig(factionCfg({ source: { type: 'faction', faction: 'AX', sets: { FUGUE: 1 } }, uniques: { inBoosters: 0, guaranteed: 0 } })).ok).toBe(true)
  })
  it('legacyColumnsFromConfig gives a null set_code for a faction source and configSetCodes lists its sets', () => {
    const { config } = validateTournamentConfig(factionCfg())
    expect(legacyColumnsFromConfig(config)).toEqual({ set_code: null, unique_count: 1, even_factions: false, heroes_in_pool: true, guaranteed_uniques: 1 })
    expect(configSetCodes(config)).toEqual(['CORE', 'BISE', 'FUGUE'])
    expect(configSetCodes({ source: { type: 'set', setCode: 'EOLE' } })).toEqual(['EOLE'])
  })
  it('configSetCodes returns SETS order for a config read back from jsonb (keys by length then bytes)', () => {
    const fromJsonb = { source: { type: 'faction', faction: 'AX', sets: { BISE: 1, CORE: 2, EOLE: 1, ALIZE: 1, FUGUE: 3 } } }
    expect(configSetCodes(fromJsonb)).toEqual(['CORE', 'ALIZE', 'BISE', 'EOLE', 'FUGUE'])
    expect(configSetCodes({ source: { type: 'faction', faction: 'AX', sets: { S2: 1, EOLE: 1, S1: 1 } } })).toEqual(['EOLE', 'S2', 'S1'])
  })
  it('ignores the client uniques faction / evenFactions for a faction source, even malformed', () => {
    const r = validateTournamentConfig(factionCfg({ uniques: { inBoosters: 1, guaranteed: 0, faction: 'XX', evenFactions: 'yes' } }))
    expect(r.ok).toBe(true)
    expect(r.config.uniques).toEqual({ inBoosters: 1, guaranteed: 0, evenFactions: false, faction: 'AX', randomOneIn: null })
  })
})

describe('validateTournamentConfig multiset source', () => {
  const multi = sets => ({ format: 'sealed', source: { type: 'multiset', sets }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0 } })

  it('accepts a split, drops zeros, coerces strings, keeps SETS order', () => {
    const r = validateTournamentConfig(multi({ EOLE: '3', CYCLONE: 4, FUGUE: 0 }))
    expect(r.ok).toBe(true)
    expect(r.config.source).toEqual({ type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 }, boosters: 7 })
    expect(Object.keys(r.config.source.sets)).toEqual(['CYCLONE', 'EOLE'])
  })
  it('normalizes a multiset left with one set to a set source', () => {
    for (const sets of [{ CYCLONE: 7 }, { CYCLONE: 7, EOLE: 0 }, { CYCLONE: '7' }]) {
      expect(validateTournamentConfig(multi(sets)).config.source).toEqual({ type: 'set', setCode: 'CYCLONE', boosters: 7 })
    }
  })
  it('refuses a total other than 7, a count out of range, a hidden or unknown set, an empty split', () => {
    for (const sets of [{ CYCLONE: 4, EOLE: 2 }, { CYCLONE: 4, EOLE: 4 }, { CYCLONE: 8 }, { CYCLONE: -1, EOLE: 8 }, { CYCLONE: 2.5, EOLE: 4.5 }, { COREKS: 7 }, { NOPE: 7 }, {}, { CYCLONE: 0 }, 'CYCLONE', null]) {
      expect(validateTournamentConfig(multi(sets)).errors, JSON.stringify(sets)).toEqual(['source.sets'])
    }
    expect(validateTournamentConfig({ ...multi({ CYCLONE: 4, EOLE: 3 }), source: { type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 }, boosters: 6 } }).errors).toEqual(['source.boosters'])
  })
  it('configSetCodes and legacyColumnsFromConfig on a multiset', () => {
    const { config } = validateTournamentConfig(multi({ EOLE: 3, CYCLONE: 4 }))
    expect(configSetCodes(config)).toEqual(['CYCLONE', 'EOLE'])
    expect(configSetCodes({ source: { type: 'multiset', sets: { FUGUE: 1, CORE: 6 } } })).toEqual(['CORE', 'FUGUE'])
    expect(legacyColumnsFromConfig(config).set_code).toBeNull()
  })
})

describe('validateTournamentConfig randomOneIn', () => {
  const multi = sets => ({ format: 'sealed', source: { type: 'multiset', sets }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0 } })
  const factionCfg = (over = {}) => ({
    source: { type: 'faction', faction: 'AX', sets: { CORE: 1, BISE: 2, FUGUE: 1 } },
    heroes: 'packs', uniques: { inBoosters: 1, guaranteed: 1 }, ...over,
  })

  it('accepts 1..10, coerces a string, forces inBoosters to 0 and evenFactions off', () => {
    const r = validateTournamentConfig({ ...valid, uniques: { inBoosters: 3, guaranteed: 1, evenFactions: true, randomOneIn: '8' } })
    expect(r.config.uniques).toEqual({ inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 8 })
    expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 1, guaranteed: 0, randomOneIn: null } }).config.uniques.randomOneIn).toBeNull()
  })
  it('refuses 0, 11, 2.5 and a non-number', () => {
    for (const randomOneIn of [0, 11, 2.5, 'x', true]) expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 0, guaranteed: 0, randomOneIn } }).errors).toEqual(['uniques.randomOneIn'])
  })
  it('keeps the uniques faction in random mode without any exact unique, forces it for a faction source', () => {
    expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 0, guaranteed: 0, randomOneIn: 8, faction: 'AX' } }).config.uniques.faction).toBe('AX')
    expect(validateTournamentConfig(factionCfg({ uniques: { inBoosters: 0, guaranteed: 0, randomOneIn: 4, faction: 'BR' } })).config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: 'AX', randomOneIn: 4 })
  })
  it('refuses random mode when no included set has unique data, accepts it next to one that has', () => {
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'FUGUE' }, uniques: { inBoosters: 0, guaranteed: 0, randomOneIn: 8 } }).errors).toEqual(['uniques.unsupportedSet'])
    expect(validateTournamentConfig({ ...multi({ FUGUE: 7 }), uniques: { randomOneIn: 8 } }).errors).toEqual(['uniques.unsupportedSet'])
    expect(validateTournamentConfig({ ...multi({ CYCLONE: 1, FUGUE: 6 }), uniques: { randomOneIn: 8 } }).ok).toBe(true)
  })
  it('caps exact in-booster uniques at 3 per booster of the sets with unique data', () => {
    expect(validateTournamentConfig({ ...multi({ CYCLONE: 1, FUGUE: 6 }), uniques: { inBoosters: 4, guaranteed: 0 } }).errors).toEqual(['uniques.inBoosters'])
    expect(validateTournamentConfig({ ...multi({ CYCLONE: 1, FUGUE: 6 }), uniques: { inBoosters: 3, guaranteed: 7 } }).ok).toBe(true)
    expect(validateTournamentConfig({ ...multi({ CYCLONE: 1, FUGUE: 6 }), uniques: { inBoosters: 7, randomOneIn: 2 } }).ok).toBe(true) // ignored in random mode
  })
  it('forces even factions off for a multi-set split, keeps it for the normalized single set', () => {
    expect(validateTournamentConfig({ ...multi({ CYCLONE: 4, EOLE: 3 }), uniques: { inBoosters: 2, guaranteed: 0, evenFactions: true } }).config.uniques.evenFactions).toBe(false)
    expect(validateTournamentConfig({ ...multi({ CYCLONE: 7 }), uniques: { inBoosters: 2, guaranteed: 0, evenFactions: true } }).config.uniques.evenFactions).toBe(true)
  })
})
