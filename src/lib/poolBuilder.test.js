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
