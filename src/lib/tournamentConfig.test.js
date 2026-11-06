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

  it('stamps the current ban-list version when the ban list is on, whatever the client sent', () => {
    expect(validateTournamentConfig(valid).config.banlist).toBe('v2')
    expect(validateTournamentConfig({ ...valid, banlist: 'v1' }).config.banlist).toBe('v2')
    expect(validateTournamentConfig({ ...valid, banlist: 'nope' }).ok).toBe(true)
    expect('banlist' in validateTournamentConfig({ ...valid, excludeBanlist: false, banlist: 'v1' }).config).toBe(false)
  })

  it('accepts a missing format/boosters (defaults) but rejects other values', () => {
    expect(validateTournamentConfig({ ...valid, format: undefined, source: { type: 'set', setCode: 'EOLE' } }).ok).toBe(true)
    expect(validateTournamentConfig({ ...valid, format: 'draft' }).errors).toContain('format')
    expect(validateTournamentConfig({ ...valid, source: { ...valid.source, boosters: 6 } }).errors).toContain('source.boosters')
  })

  it('rejects unknown/hidden sets, other source types, bad hero modes and out-of-range uniques', () => {
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'NOPE' } }).errors).toContain('source.setCode')
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'COREKS' } }).errors).toContain('source.setCode')
    expect(validateTournamentConfig({ ...valid, source: { type: 'bogus', setCode: 'CORE' } }).errors).toContain('source.type')
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
    ['unknown type', { type: 'bogus', faction: 'AX', sets: { CORE: 1 } }, 'source.type'],
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
  it('keeps random mode, guaranteed uniques and the faction on a set and on a multiset source', () => {
    const uniques = { inBoosters: 3, guaranteed: 2, evenFactions: true, faction: 'AX', randomOneIn: 8 }
    const expected = { inBoosters: 0, guaranteed: 2, evenFactions: false, faction: 'AX', randomOneIn: 8 }
    expect(validateTournamentConfig({ ...valid, uniques }).config.uniques).toEqual(expected)
    expect(validateTournamentConfig({ ...multi({ CYCLONE: 4, EOLE: 3 }), uniques }).config.uniques).toEqual(expected)
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

describe('validateTournamentConfig cube source', () => {
  const cube = over => ({ format: 'sealed', source: { type: 'cube', name: 'My cube', origin: 'paste', cubeId: null, cards: { ALT_CORE_B_AX_01_C: 1, ALT_CORE_B_BR_02_R1: 2, ALT_CORE_B_AX_04_U_1437: 1 }, heroPool: ['ALT_CORE_B_BR_01_C', 'ALT_CORE_B_AX_01_C'], boosters: 7, cardsPerBooster: 12, perFaction: 1, ...over }, heroes: 'packs', uniques: { inBoosters: 3, guaranteed: 2, evenFactions: true, randomOneIn: 4 }, excludeBanlist: true })

  it('accepts a cube, sorts its keys and hero pool, forces the uniques and the ban list off', () => {
    const r = validateTournamentConfig(cube())
    expect(r.ok).toBe(true)
    expect(r.config.source).toEqual({ type: 'cube', name: 'My cube', origin: 'paste', cubeId: null, cards: { ALT_CORE_B_AX_01_C: 1, ALT_CORE_B_AX_04_U_1437: 1, ALT_CORE_B_BR_02_R1: 2 }, heroPool: ['ALT_CORE_B_AX_01_C', 'ALT_CORE_B_BR_01_C'], boosters: 7, cardsPerBooster: 12, perFaction: 1 })
    expect(r.config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null })
    expect(r.config.excludeBanlist).toBe(false)
    expect(r.config).not.toHaveProperty('banlist')
  })
  it('trims the name, coerces strings, keeps a community cube id, nulls it otherwise, keeps a non-B printing', () => {
    expect(validateTournamentConfig(cube({ name: '  Commons  ', origin: 'community', cubeId: 'all-commons', boosters: '6', cardsPerBooster: '10', perFaction: '0' })).config.source).toMatchObject({ name: 'Commons', cubeId: 'all-commons', boosters: 6, cardsPerBooster: 10, perFaction: 0 })
    expect(validateTournamentConfig(cube({ cubeId: 'x' })).config.source.cubeId).toBeNull()
    expect(validateTournamentConfig(cube({ cards: { ALT_BISE_P_BR_64_C: 1, ALT_CORE_A_AX_02_C: 1 } })).config.source.cards).toEqual({ ALT_BISE_P_BR_64_C: 1, ALT_CORE_A_AX_02_C: 1 })
  })
  it('refuses each cube problem with its code', () => {
    const cases = [
      [{ name: '' }, 'source.name'], [{ name: 'x'.repeat(81) }, 'source.name'],
      [{ origin: 'web' }, 'source.origin'], [{ origin: 'community', cubeId: '' }, 'source.cubeId'],
      [{ cards: {} }, 'source.cards'], [{ cards: [] }, 'source.cards'], [{ cards: { ALT_CORE_X_AX_01_C: 1 } }, 'source.cards'], [{ cards: { ALT_NOPE_B_AX_01_C: 1 } }, 'source.cards'],
      [{ cards: { ALT_CORE_B_AX_01_C: 0 } }, 'source.cards'], [{ cards: { ALT_CORE_B_AX_01_C: 100 } }, 'source.cards'],
      [{ cards: { ALT_CORE_B_AX_01_C: 1501 } }, 'source.cards'],
      [{ heroPool: [] }, 'source.heroPool'], [{ heroPool: ['ALT_CORE_B_AX_04_U_1437'] }, 'source.heroPool'], [{ heroPool: 'x' }, 'source.heroPool'],
      [{ boosters: 2 }, 'source.boosters'], [{ boosters: 9 }, 'source.boosters'],
      [{ cardsPerBooster: 9 }, 'source.cardsPerBooster'], [{ cardsPerBooster: 17 }, 'source.cardsPerBooster'],
      [{ perFaction: 3 }, 'source.perFaction'], [{ perFaction: 2, cardsPerBooster: 11 }, 'source.perFaction'],
      [{ boosters: 3, cardsPerBooster: 10 }, 'source.poolSize'],
    ]
    for (const [over, code] of cases) expect(validateTournamentConfig(cube(over)).errors, JSON.stringify(over)).toEqual([code])
  })
  it('configSetCodes and legacyColumnsFromConfig on a cube', () => {
    const { config } = validateTournamentConfig(cube({ cards: { ALT_EOLE_B_AX_01_C: 1, ALT_CORE_B_AX_01_C: 1 }, heroPool: ['ALT_CYCLONE_B_AX_01_C'] }))
    expect(configSetCodes(config)).toEqual(['CORE', 'CYCLONE', 'EOLE'])
    expect(legacyColumnsFromConfig(config)).toEqual({ set_code: null, unique_count: 0, even_factions: false, heroes_in_pool: true, guaranteed_uniques: 0 })
  })
  it('accepts a promo / OP printing of a set code SETS does not know, by its base set (Wozow)', () => {
    const r = validateTournamentConfig(cube({ cards: { ALT_DUSTERTOP_P_AX_04_C: 1 }, heroPool: ['ALT_DUSTEROP_P_AX_01_C'] }))
    expect(r.errors).toEqual([])
    expect(r.config.source.cards).toEqual({ ALT_DUSTERTOP_P_AX_04_C: 1 })
    expect(configSetCodes(r.config)).toEqual(['DUSTER'])
    expect(configSetCodes({ source: { type: 'cube', cards: { ALT_DUSTERTOP_P_AX_04_C: 1, ALT_CORE_B_AX_01_C: 1 }, heroPool: [] } })).toEqual(['CORE', 'DUSTER'])
  })
  it('refuses a cube with more than 300 distinct refs needing the cards API', () => {
    const uniques = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`ALT_CORE_B_AX_04_U_${1000 + i}`, 1]))
    expect(validateTournamentConfig(cube({ cards: uniques(300) })).errors).toEqual([])
    expect(validateTournamentConfig(cube({ cards: uniques(301) })).errors).toEqual(['source.cards'])
  })
})
