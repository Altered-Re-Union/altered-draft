import { describe, it, expect } from 'vitest'
import { buildPool, buildPoolSeedString } from './poolBuilder.js'
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
