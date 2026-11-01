// Golden test for legacy pools: rows created before pools were stored are still rebuilt by
// regeneratePool → buildPool(configFromLegacyFormat(row)). That must reproduce, bit for
// bit, what the pre-storage code produced, or every deck already played on BGA from such a
// pool would become illegal. `legacyRegenerate` below is the body of the old
// api/_lib/tournamentPool.js regeneratePool (commit 3f9bb2a), with the card fetch injected.
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { buildPool, buildPoolSeedString } from './poolBuilder.js'
import { configFromLegacyFormat } from './tournamentConfig.js'
import { hashSeed, mulberry32 } from './prng.js'
import { generateTournamentSealedPool } from './packGenerator.js'
import { pickDeterministicUniques } from './uniqueFactionRanges.js'
import { FACTIONS } from './cardData.js'

function legacyRegenerate(sub, poolRow, cards) {
  const seedStr = buildPoolSeedString(sub, poolRow)
  const inBooster = poolRow.unique_count ?? 0
  const outside = poolRow.guaranteed_uniques ?? 0
  const allUniques = pickDeterministicUniques(poolRow.set_code, mulberry32(hashSeed(`${seedStr}#uniques`)), {
    uniqueCount: inBooster + outside,
    evenFactions: !!poolRow.even_factions,
  })
  const boosterUniques = allUniques.slice(0, inBooster)
  const outsideUniques = allUniques.slice(inBooster)
  const boosters = generateTournamentSealedPool(cards, mulberry32(hashSeed(seedStr)), {
    uniqueRefs: boosterUniques,
    includeHeroes: poolRow.heroes_in_pool,
  })
  const counts = {}
  for (const ref of boosters.flat()) counts[ref] = (counts[ref] ?? 0) + 1
  for (const ref of outsideUniques) counts[ref] = (counts[ref] ?? 0) + 1
  if (!poolRow.heroes_in_pool) {
    for (const card of cards) {
      if (card.cardType === 'HERO') counts[card.reference] = (counts[card.reference] ?? 0) + 1
    }
  }
  return { counts, boosters }
}

// A realistic-sized synthetic set (no network): 6 heroes, 8 commons and 6 rares per faction.
function fakeSet(setCode) {
  const cards = []
  let n = 1
  for (const f of FACTIONS) {
    cards.push({ reference: `ALT_${setCode}_B_${f}_${n++}_C`, name: `Hero ${f}`, faction: f, rarity: 'C', cardType: 'HERO' })
    for (let i = 0; i < 8; i++, n++) cards.push({ reference: `ALT_${setCode}_B_${f}_${n}_C`, name: `Common ${f} ${i}`, faction: f, rarity: 'C', cardType: 'CHARACTER' })
    for (let i = 0; i < 6; i++, n++) cards.push({ reference: `ALT_${setCode}_B_${f}_${n}_R1`, name: `Rare ${f} ${i}`, faction: f, rarity: 'R1', cardType: 'SPELL' })
  }
  return cards
}

const ROWS = [
  { set_code: 'EOLE', unique_count: 1, even_factions: false, heroes_in_pool: false, guaranteed_uniques: 1, nonce: 'n-eole' }, // today's format
  { set_code: 'CYCLONE', unique_count: 3, even_factions: true, heroes_in_pool: true, guaranteed_uniques: 0, nonce: 'n-sky' },
  { set_code: 'CORE', unique_count: 0, even_factions: false, heroes_in_pool: true, guaranteed_uniques: 0, nonce: 'n-core' },
  { set_code: 'BISE', unique_count: 2, even_factions: false, heroes_in_pool: false, guaranteed_uniques: 2, nonce: 'n-bise' },
]

describe('legacy pool regeneration (golden)', () => {
  for (const row of ROWS) {
    it(`buildPool reproduces the pre-storage regeneration exactly (${row.set_code}, ${row.unique_count}+${row.guaranteed_uniques} uniques, heroes ${row.heroes_in_pool ? 'in packs' : 'appended'})`, async () => {
      const cards = fakeSet(row.set_code)
      for (const sub of ['11111111-1111-1111-1111-111111111111', 'some-other-sub']) {
        const expected = legacyRegenerate(sub, row, cards)
        const actual = await buildPool(sub, { config: configFromLegacyFormat(row), nonce: row.nonce }, { fetchCards: async () => cards })
        expect(actual.boosters).toEqual(expected.boosters)
        expect(actual.cards).toEqual(expected.counts)
      }
    })
  }

  // Locks the shared draw libraries too (packGenerator, prng, uniqueFactionRanges): a change
  // there would move legacy pools AND this hash, even though both sides above would agree.
  it('the draw for the current format is frozen', async () => {
    const row = ROWS[0]
    const cards = fakeSet(row.set_code)
    const { boosters, cards: counts } = await buildPool('11111111-1111-1111-1111-111111111111', { config: configFromLegacyFormat(row), nonce: row.nonce }, { fetchCards: async () => cards })
    const digest = crypto.createHash('sha256').update(JSON.stringify({ boosters, counts })).digest('hex')
    expect(digest).toMatchSnapshot()
  })
})

describe('mono-faction pool (golden)', () => {
  it('the draw for a mono-faction config is frozen', async () => {
    const config = { v: 1, format: 'sealed', source: { type: 'faction', faction: 'AX', sets: { CORE: 1, EOLE: 2 }, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false, faction: 'AX' }, excludeBanlist: false }
    const { boosters, cards: counts } = await buildPool('11111111-1111-1111-1111-111111111111', { config, nonce: 'n-faction' }, { fetchCards: async code => fakeSet(code) })
    expect(crypto.createHash('sha256').update(JSON.stringify({ boosters, counts })).digest('hex')).toMatchSnapshot()
  })
})
