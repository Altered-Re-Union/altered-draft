import { describe, it, expect, vi } from 'vitest'
import { buildPool, buildPoolSeedString, placeRandomUniques } from './poolBuilder.js'
import { mulberry32 } from './prng.js'
import { FACTIONS } from './cardData.js'
import EOLE from './data/factionRanges/EOLE.json' with { type: 'json' }

// A synthetic set: 2 heroes, 3 commons per faction, 4 rares (+ 1 banned common).
function fakeSet() {
  const cards = []
  cards.push({ reference: 'ALT_TEST_B_AX_01_C', name: 'Hero A', faction: 'AX', rarity: 'C', cardType: 'HERO' })
  cards.push({ reference: 'ALT_TEST_B_BR_01_C', name: 'Hero B', faction: 'BR', rarity: 'C', cardType: 'HERO' })
  let n = 10
  for (const f of FACTIONS) {
    for (let i = 0; i < 3; i++, n++) {
      cards.push({ reference: `ALT_TEST_B_${f}_${n}_C`, name: `Common ${f} ${i}`, faction: f, rarity: 'C', cardType: 'CHARACTER' })
    }
  }
  for (let i = 0; i < 4; i++, n++) {
    cards.push({ reference: `ALT_TEST_B_AX_${n}_R1`, name: `Rare ${i}`, faction: 'AX', rarity: 'R1', cardType: 'SPELL' })
  }
  // Same family as a banned CORE card: banlist.js keys on ALT_<SET>_B_<FACTION>_<NUM>.
  cards.push({ reference: 'ALT_CORE_B_BR_06_C', name: 'Banned one', faction: 'BR', rarity: 'C', cardType: 'CHARACTER' })
  return cards
}

const config = (over = {}) => ({
  v: 1, format: 'sealed',
  source: { type: 'set', setCode: 'TEST', boosters: 7 },
  heroes: 'packs',
  uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false },
  excludeBanlist: false,
  ...over,
})
const fetchCards = async () => fakeSet()

describe('buildPool', () => {
  it('is deterministic for the same sub/config/nonce and differs for another nonce', async () => {
    const a = await buildPool('alice', { config: config(), nonce: 'n1' }, { fetchCards })
    const b = await buildPool('alice', { config: config(), nonce: 'n1' }, { fetchCards })
    const c = await buildPool('alice', { config: config(), nonce: 'n2' }, { fetchCards })
    expect(a).toEqual(b)
    expect(c.boosters).not.toEqual(a.boosters)
  })

  it('deals 7 boosters of 13 (1 hero + 9 commons + 3 rares) and counts them', async () => {
    const { cards, boosters } = await buildPool('alice', { config: config(), nonce: 'n1' }, { fetchCards })
    expect(boosters).toHaveLength(7)
    for (const pack of boosters) expect(pack).toHaveLength(13)
    const total = Object.values(cards).reduce((s, n) => s + n, 0)
    expect(total).toBe(7 * 13)
  })

  it('with heroes "free", boosters have no hero and every hero is appended once to the pool', async () => {
    const { cards, boosters } = await buildPool('alice', { config: config({ heroes: 'free' }), nonce: 'n1' }, { fetchCards })
    for (const pack of boosters) expect(pack).toHaveLength(12)
    expect(cards['ALT_TEST_B_AX_01_C']).toBe(1)
    expect(cards['ALT_TEST_B_BR_01_C']).toBe(1)
  })

  it('excludes banned families when excludeBanlist is on', async () => {
    const seen = new Set()
    for (let i = 0; i < 20; i++) {
      const { cards } = await buildPool('alice', { config: config({ excludeBanlist: true }), nonce: `n${i}` }, { fetchCards })
      Object.keys(cards).forEach(r => seen.add(r))
    }
    expect(seen.has('ALT_CORE_B_BR_06_C')).toBe(false)
  })

  it('throws when the set has no cards', async () => {
    await expect(buildPool('alice', { config: config(), nonce: 'n1' }, { fetchCards: async () => [] })).rejects.toThrow(/no cards/)
  })

  it('draws real uniques for a set with range data, in-booster ones inside rare slots, guaranteed ones outside', async () => {
    const cfg = config({ source: { type: 'set', setCode: 'EOLE', boosters: 7 }, uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false } })
    const { cards, boosters } = await buildPool('alice', { config: cfg, nonce: 'n1' }, { fetchCards })
    const inPacks = boosters.flat().filter(r => r.includes('_U_'))
    const all = Object.keys(cards).filter(r => r.includes('_U_'))
    expect(inPacks).toHaveLength(1)
    expect(all).toHaveLength(2)
    expect(inPacks[0]).toMatch(/^ALT_EOLE_B_/)
  })

  it('restricts every unique, in boosters and guaranteed, to the configured faction', async () => {
    const cfg = config({ source: { type: 'set', setCode: 'EOLE', boosters: 7 }, uniques: { inBoosters: 3, guaranteed: 2, evenFactions: false, faction: 'LY' } })
    const { cards } = await buildPool('alice', { config: cfg, nonce: 'n1' }, { fetchCards })
    const uniques = Object.keys(cards).filter(r => r.includes('_U_'))
    expect(uniques).toHaveLength(5)
    for (const ref of uniques) {
      const [, family, serial] = ref.match(/^ALT_EOLE_B_([A-Z0-9_]+)_U_(\d+)$/)
      expect(EOLE[family].LY.some(([s, e]) => Number(serial) >= s && Number(serial) <= e)).toBe(true)
    }
  })
})

describe('buildPoolSeedString', () => {
  it('matches the legacy seed layout exactly (tournament_id is NOT part of it)', () => {
    const s = buildPoolSeedString('sub1', { set_code: 'EOLE', unique_count: 1, even_factions: false, heroes_in_pool: false, guaranteed_uniques: 1, nonce: 'N', tournament_id: 'ignored' })
    expect(s).toBe('sub1|EOLE|1|false|false|1|N')
  })
})

// A faction-source fixture: per faction (AX, BR) 2 heroes, 10 commons, 6 rares (one OOF _R2 print).
function fakeFactionSet(setCode) {
  const cards = []
  for (const f of ['AX', 'BR']) {
    for (let h = 1; h <= 2; h++) cards.push({ reference: `ALT_${setCode}_B_${f}_0${h}_C`, name: `Hero ${f} ${h}`, faction: f, rarity: 'C', cardType: 'HERO' })
    for (let i = 0; i < 10; i++) cards.push({ reference: `ALT_${setCode}_B_${f}_${10 + i}_C`, name: `Common ${f} ${i}`, faction: f, rarity: 'C', cardType: 'CHARACTER' })
    for (let i = 0; i < 5; i++) cards.push({ reference: `ALT_${setCode}_B_${f}_${30 + i}_R1`, name: `Rare ${f} ${i}`, faction: f, rarity: 'R1', cardType: 'SPELL' })
    // OOF print: ref letters say YZ, the card object says AX/BR
    cards.push({ reference: `ALT_${setCode}_B_YZ_${f === 'AX' ? 45 : 46}_R2`, name: `Rare ${f} oof`, faction: f, rarity: 'R2', cardType: 'SPELL' })
  }
  if (setCode === 'CORE') cards.push({ reference: 'ALT_CORE_B_AX_17_C', name: 'Banned AX', faction: 'AX', rarity: 'C', cardType: 'CHARACTER' })
  return cards
}

describe('buildPool faction source', () => {
  const fetchCards = async code => fakeFactionSet(code)
  const factionConfig = (over = {}) => ({
    v: 1, format: 'sealed',
    source: { type: 'faction', faction: 'AX', sets: { CORE: 1, EOLE: 2 }, boosters: 7 },
    heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null }, excludeBanlist: false, ...over,
  })
  it('is deterministic and fetches each included set once', async () => {
    const calls = []
    const fetchCards = async code => { calls.push(code); return fakeFactionSet(code) }
    const a = await buildPool('sub', { config: factionConfig(), nonce: 'n1' }, { fetchCards })
    const b = await buildPool('sub', { config: factionConfig(), nonce: 'n1' }, { fetchCards })
    expect(a).toEqual(b); expect(calls.slice(0, 2)).toEqual(['CORE', 'EOLE'])
    expect((await buildPool('sub', { config: factionConfig(), nonce: 'n2' }, { fetchCards })).boosters).not.toEqual(a.boosters)
  })
  it('calls fetchCards with the set code only (no Array.map index leaking in as the language)', async () => {
    const argLists = []
    const fetchCards = async (...args) => { argLists.push(args); return fakeFactionSet(args[0]) }
    await buildPool('sub', { config: factionConfig(), nonce: 'n1' }, { fetchCards })
    expect(argLists.length).toBeGreaterThan(0)
    for (const args of argLists) expect(args).toHaveLength(1)
  })

  it('deals 7 boosters of 13 with exact per-set quotas and only faction cards', async () => {
    const { boosters, cards } = await buildPool('sub', { config: factionConfig(), nonce: 'n' }, { fetchCards })
    expect(boosters).toHaveLength(7); for (const p of boosters) expect(p).toHaveLength(13)
    expect(boosters.flatMap(p => p.slice(1, 10)).filter(r => r.startsWith('ALT_CORE_')).length).toBe(21)
    expect(Object.values(cards).reduce((a, b) => a + b, 0)).toBe(91)
    expect(Object.keys(cards).every(r => fakeFactionSet(r.split('_')[1]).find(c => c.reference === r).faction === 'AX')).toBe(true)
  })
  it('appends every hero of the faction from every included set with heroes "free"', async () => {
    const { boosters, cards } = await buildPool('sub', { config: factionConfig({ heroes: 'free' }), nonce: 'n' }, { fetchCards })
    for (const p of boosters) expect(p).toHaveLength(12)
    const heroes = Object.keys(cards).filter(r => fakeFactionSet(r.split('_')[1]).find(c => c.reference === r).cardType === 'HERO')
    expect(heroes.sort()).toEqual(['ALT_CORE_B_AX_01_C', 'ALT_CORE_B_AX_02_C', 'ALT_EOLE_B_AX_01_C', 'ALT_EOLE_B_AX_02_C'])
  })
  it('applies the ban list set by set', async () => {
    const { cards } = await buildPool('sub', { config: factionConfig({ excludeBanlist: true }), nonce: 'n' }, { fetchCards })
    expect(Object.keys(cards).some(r => r.startsWith('ALT_CORE_B_AX_17'))).toBe(false)
  })
  it('draws the uniques from the included sets that have range data, never from FUGUE', async () => {
    const config = factionConfig({ source: { type: 'faction', faction: 'AX', sets: { FUGUE: 2, EOLE: 1 }, boosters: 7 }, uniques: { inBoosters: 2, guaranteed: 1, evenFactions: false, faction: 'AX' } })
    const { boosters, cards } = await buildPool('sub', { config, nonce: 'n' }, { fetchCards })
    const uniques = Object.keys(cards).filter(r => r.includes('_U_'))
    expect(uniques).toHaveLength(3); expect(uniques.every(r => r.startsWith('ALT_EOLE_B_'))).toBe(true)
    expect(boosters.flat().filter(r => r.includes('_U_'))).toHaveLength(2)
    expect(boosters.flat().filter(r => !r.includes('_U_') && r.split('_')[5]?.startsWith('R')).length).toBe(19)
  })
  it('throws when uniques are wanted and no included set has range data', async () => {
    const config = factionConfig({ source: { type: 'faction', faction: 'AX', sets: { FUGUE: 1 }, boosters: 7 }, uniques: { inBoosters: 1, guaranteed: 0, evenFactions: false, faction: 'AX' } })
    await expect(buildPool('sub', { config, nonce: 'n' }, { fetchCards })).rejects.toThrow(/unique/)
  })
})

// A multiset fixture: one hero in AX and BR, 3 commons per faction, 6 rares; the refs carry the set code.
function fakeMultiSet(code) {
  const cards = []
  cards.push({ reference: `ALT_${code}_B_AX_01_C`, name: `Hero AX ${code}`, faction: 'AX', rarity: 'C', cardType: 'HERO' })
  cards.push({ reference: `ALT_${code}_B_BR_02_C`, name: `Hero BR ${code}`, faction: 'BR', rarity: 'C', cardType: 'HERO' })
  let n = 10
  for (const f of FACTIONS) {
    for (let i = 0; i < 3; i++, n++) cards.push({ reference: `ALT_${code}_B_${f}_${n}_C`, name: `Common ${f} ${i}`, faction: f, rarity: 'C', cardType: 'CHARACTER' })
    cards.push({ reference: `ALT_${code}_B_${f}_${n++}_R1`, name: `Rare ${f}`, faction: f, rarity: 'R1', cardType: 'SPELL' })
  }
  // Banned family (banlist.js): ALT_CYCLONE_B_AX_81.
  if (code === 'CYCLONE') cards.push({ reference: 'ALT_CYCLONE_B_AX_81_C', name: 'Banned SKY', faction: 'AX', rarity: 'C', cardType: 'CHARACTER' })
  return cards
}

describe('buildPool multiset source', () => {
  const SUB = 'sub'
  const fetchCards = vi.fn(async code => fakeMultiSet(code))
  const multiConfig = (over = {}) => ({ v: 1, format: 'sealed', source: { type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 }, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null }, excludeBanlist: false, ...over })
  const setOf = ref => ref.split('_')[1]

  it('is deterministic, fetches each set once with the code only', async () => {
    const argLists = []
    const fetch = async (...args) => { argLists.push(args); return fakeMultiSet(args[0]) }
    const a = await buildPool(SUB, { config: multiConfig(), nonce: 'n1' }, { fetchCards: fetch })
    expect(argLists).toEqual([['CYCLONE'], ['EOLE']])
    const b = await buildPool(SUB, { config: multiConfig(), nonce: 'n1' }, { fetchCards: fetch })
    expect(a).toEqual(b)
    expect((await buildPool(SUB, { config: multiConfig(), nonce: 'n2' }, { fetchCards: fetch })).boosters).not.toEqual(a.boosters)
  })

  it('deals the per-set boosters, set-pure, hero of their own set', async () => {
    const { boosters, cards } = await buildPool(SUB, { config: multiConfig(), nonce: 'n' }, { fetchCards })
    expect(boosters.map(b => setOf(b[0])).sort()).toEqual(['CYCLONE', 'CYCLONE', 'CYCLONE', 'CYCLONE', 'EOLE', 'EOLE', 'EOLE'])
    for (const b of boosters) { expect(b).toHaveLength(13); expect(new Set(b.map(setOf)).size).toBe(1) }
    expect(Object.values(cards).reduce((a, b) => a + b, 0)).toBe(91)
  })

  it('puts exact in-booster uniques in boosters of their own set, never in a set without data', async () => {
    const config = multiConfig({ source: { type: 'multiset', sets: { CYCLONE: 4, FUGUE: 3 }, boosters: 7 }, uniques: { inBoosters: 2, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: null } })
    for (const nonce of ['n', 'n2', 'n3']) {
      const { boosters, cards } = await buildPool(SUB, { config, nonce }, { fetchCards })
      const inBoosters = boosters.flatMap((b, i) => b.map((r, j) => ({ r, i, j }))).filter(x => x.r.includes('_U_'))
      expect(inBoosters).toHaveLength(2)
      for (const { r, i, j } of inBoosters) { expect(setOf(boosters[i][0])).toBe('CYCLONE'); expect(setOf(r)).toBe('CYCLONE'); expect(j).toBeGreaterThanOrEqual(10) }
      const outside = Object.keys(cards).filter(r => r.includes('_U_') && !boosters.flat().includes(r))
      expect(outside).toHaveLength(1)
      expect(setOf(outside[0])).toBe('CYCLONE')
      expect(new Set(Object.keys(cards).filter(r => r.includes('_U_'))).size).toBe(3)
    }
  })

  it('spreads uniques over two sets with data, each in a booster of its own set, no serial twice', async () => {
    const config = multiConfig({ uniques: { inBoosters: 6, guaranteed: 4, evenFactions: false, faction: 'LY', randomOneIn: null } })
    const { boosters, cards } = await buildPool(SUB, { config, nonce: 'n' }, { fetchCards })
    boosters.forEach(b => b.filter(r => r.includes('_U_')).forEach(r => expect(setOf(r)).toBe(setOf(b[0]))))
    expect(boosters.flat().filter(r => r.includes('_U_'))).toHaveLength(6)
    const uniques = Object.keys(cards).filter(r => r.includes('_U_'))
    expect(uniques).toHaveLength(10)
    for (const r of uniques) expect(cards[r]).toBe(1)
  })

  it('appends every hero of every included set with heroes "free"', async () => {
    const { boosters, cards } = await buildPool(SUB, { config: multiConfig({ heroes: 'free' }), nonce: 'n' }, { fetchCards })
    for (const b of boosters) expect(b).toHaveLength(12)
    const heroes = Object.keys(cards).filter(r => /_0[12]_C$/.test(r))
    expect(heroes.sort()).toEqual(['ALT_CYCLONE_B_AX_01_C', 'ALT_CYCLONE_B_BR_02_C', 'ALT_EOLE_B_AX_01_C', 'ALT_EOLE_B_BR_02_C'])
    for (const h of heroes) expect(cards[h]).toBe(1)
  })

  it('applies the ban list set by set', async () => {
    for (let i = 0; i < 10; i++) {
      const { cards } = await buildPool(SUB, { config: multiConfig({ excludeBanlist: true }), nonce: `n${i}` }, { fetchCards })
      expect(Object.keys(cards).some(r => r.startsWith('ALT_CYCLONE_B_AX_81'))).toBe(false)
    }
  })

  it('throws when a set has no cards', async () => {
    const fetch = async code => (code === 'EOLE' ? [] : fakeMultiSet(code))
    await expect(buildPool(SUB, { config: multiConfig(), nonce: 'n' }, { fetchCards: fetch })).rejects.toThrow(/no cards loaded for EOLE/)
  })

  it('throws when uniques are wanted and no included set has range data', async () => {
    const config = multiConfig({ source: { type: 'multiset', sets: { FUGUE: 7 }, boosters: 7 }, uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: null } })
    await expect(buildPool(SUB, { config, nonce: 'n' }, { fetchCards })).rejects.toThrow(/unique/)
  })
})

describe('buildPool random uniques', () => {
  const SUB = 'sub'
  const setOf = ref => ref.split('_')[1]
  const uniquesOf = cards => Object.keys(cards).filter(r => r.includes('_U_'))

  it('placeRandomUniques: every eligible booster at 1 in 1, none above the threshold, data-less hits dropped', () => {
    const mk = () => [['ALT_CYCLONE_B_AX_1_C', ...Array(12).fill('ALT_CYCLONE_B_AX_2_C')], ['ALT_FUGUE_B_AX_1_C', ...Array(12).fill('ALT_FUGUE_B_AX_2_C')]]
    const gate = () => true
    const b = mk()
    const placed = placeRandomUniques(b, { rng: () => 0, uRng: mulberry32(1), oneIn: 8, setForHit: i => (setOf(b[i][0]) === 'CYCLONE' ? 'CYCLONE' : null), faction: null, isAllowed: gate, onDrawn: () => {} })
    expect(placed).toHaveLength(1)
    expect(b[0][12]).toMatch(/^ALT_CYCLONE_B_.*_U_\d+$/)
    expect(b[1][12]).toBe('ALT_FUGUE_B_AX_2_C')
    const c = mk()
    expect(placeRandomUniques(c, { rng: () => 0.9, uRng: mulberry32(1), oneIn: 8, setForHit: () => 'CYCLONE', faction: null, isAllowed: gate, onDrawn: () => {} })).toEqual([])
  })

  it('placeRandomUniques: feeds every drawn ref to onDrawn and throws when the set cannot give enough', () => {
    const b = [Array(13).fill('ALT_CYCLONE_B_AX_2_C'), Array(13).fill('ALT_CYCLONE_B_AX_2_C')]
    const seen = []
    const placed = placeRandomUniques(b, { rng: () => 0, uRng: mulberry32(1), oneIn: 1, setForHit: () => 'CYCLONE', faction: null, isAllowed: () => true, onDrawn: refs => seen.push(...refs) })
    expect(seen).toEqual(placed)
    expect(() => placeRandomUniques(b, { rng: () => 0, uRng: mulberry32(1), oneIn: 1, setForHit: () => 'CYCLONE', faction: null, isAllowed: () => false, onDrawn: () => {} })).toThrow(/uniques/)
  })

  it('set source at 1 in 1: a unique in every booster\'s last slot, plus the guaranteed one, no serial twice', async () => {
    const cfg = config({ source: { type: 'set', setCode: 'EOLE', boosters: 7 }, uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 1 } })
    const { boosters, cards } = await buildPool(SUB, { config: cfg, nonce: 'n' }, { fetchCards: async () => fakeSet() })
    for (const b of boosters) { expect(b[12]).toMatch(/^ALT_EOLE_B_.*_U_\d+$/); expect(b.slice(0, 12).some(r => r.includes('_U_'))).toBe(false) }
    expect(uniquesOf(cards)).toHaveLength(8)
  })

  it('set source in random mode: a hit is a booster\'s last slot only, about one booster in N over many pools', async () => {
    let hits = 0
    for (let i = 0; i < 40; i++) {
      const cfg = config({ source: { type: 'set', setCode: 'EOLE', boosters: 7 }, uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: 2 } })
      const { boosters } = await buildPool(SUB, { config: cfg, nonce: `n${i}` }, { fetchCards: async () => fakeSet() })
      for (const b of boosters) {
        expect(b.slice(0, 12).some(r => r.includes('_U_'))).toBe(false)
        if (b[12].includes('_U_')) hits++
      }
    }
    expect(hits).toBeGreaterThan(100)
    expect(hits).toBeLessThan(180)
  })

  it('multiset at 1 in 1: only the boosters of sets with data get one, of their own set', async () => {
    const cfg = { v: 1, format: 'sealed', source: { type: 'multiset', sets: { CYCLONE: 3, FUGUE: 4 }, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: 1 }, excludeBanlist: false }
    const { boosters, cards } = await buildPool(SUB, { config: cfg, nonce: 'n' }, { fetchCards: async code => fakeMultiSet(code) })
    const hits = boosters.filter(b => b[12].includes('_U_'))
    expect(hits).toHaveLength(3)
    for (const b of hits) { expect(setOf(b[0])).toBe('CYCLONE'); expect(setOf(b[12])).toBe('CYCLONE') }
    expect(uniquesOf(cards)).toHaveLength(3)
  })

  it('multiset at 1 in 1 with guaranteed uniques: every one distinct, the guaranteed ones outside the boosters', async () => {
    const cfg = { v: 1, format: 'sealed', source: { type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 }, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 2, evenFactions: false, faction: 'LY', randomOneIn: 1 }, excludeBanlist: false }
    const { boosters, cards } = await buildPool(SUB, { config: cfg, nonce: 'n' }, { fetchCards: async code => fakeMultiSet(code) })
    for (const b of boosters) expect(setOf(b[12])).toBe(setOf(b[0]))
    expect(uniquesOf(cards)).toHaveLength(9)
    for (const r of uniquesOf(cards)) expect(cards[r]).toBe(1)
  })

  it('multiset with no set with data in random mode and nothing guaranteed: no unique, no throw', async () => {
    const cfg = { v: 1, format: 'sealed', source: { type: 'multiset', sets: { FUGUE: 7 }, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: 1 }, excludeBanlist: false }
    const { cards } = await buildPool(SUB, { config: cfg, nonce: 'n' }, { fetchCards: async code => fakeMultiSet(code) })
    expect(uniquesOf(cards)).toHaveLength(0)
  })

  it('faction source at 1 in 1: seven uniques from the range-capable sets, after the guaranteed ones', async () => {
    const cfg = { v: 1, format: 'sealed', source: { type: 'faction', faction: 'AX', sets: { CORE: 1, FUGUE: 1 }, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: 'AX', randomOneIn: 1 }, excludeBanlist: false }
    const { boosters, cards } = await buildPool(SUB, { config: cfg, nonce: 'n' }, { fetchCards: async code => fakeFactionSet(code) })
    for (const b of boosters) expect(b[12]).toMatch(/^ALT_CORE_B_.*_U_\d+$/)
    expect(new Set(uniquesOf(cards)).size).toBe(8)
  })

  // randomOneIn null leaves every exact path untouched: pinned by the goldens.

  // Two pickDeterministicUniques calls on the SAME set in one pool (the guaranteed draw, then
  // the random hits). Every call is forced to restart the same rng sequence, so the second
  // call's first draw IS the guaranteed unique: only the gate keeps the serials distinct.
  it('never hands out the same serial twice when two draws hit the same set', async () => {
    vi.resetModules()
    vi.doMock('./uniqueFactionRanges.js', async importOriginal => {
      const real = await importOriginal()
      return { ...real, pickDeterministicUniques: (code, _rng, opts) => real.pickDeterministicUniques(code, mulberry32(7), opts) }
    })
    try {
      const { buildPool: build } = await import('./poolBuilder.js')
      for (const cfg of [
        config({ source: { type: 'set', setCode: 'EOLE', boosters: 7 }, uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 1 } }),
        { v: 1, format: 'sealed', source: { type: 'faction', faction: 'AX', sets: { CORE: 1 }, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: 'AX', randomOneIn: 1 }, excludeBanlist: false },
      ]) {
        const fetch = async code => (cfg.source.type === 'set' ? fakeSet() : fakeFactionSet(code))
        const { cards } = await build(SUB, { config: cfg, nonce: 'n' }, { fetchCards: fetch })
        const uniques = uniquesOf(cards)
        expect(uniques).toHaveLength(8)
        for (const r of uniques) expect(cards[r]).toBe(1)
      }
    } finally {
      vi.doUnmock('./uniqueFactionRanges.js')
      vi.resetModules()
    }
  })
})
