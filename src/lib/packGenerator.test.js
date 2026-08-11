import { describe, it, expect } from 'vitest'
import {
  generateAllPacks, generateChaosPacks, generateStructuredPacks,
  generateCubeDraftPacks, generateCubeRecipePacks, dealHeroSlots,
  generateTournamentSealedPool, generatePacksFromPool,
} from './packGenerator.js'
import { FACTIONS } from './cardData.js'
import { mulberry32 } from './prng.js'

// --- Fixtures -------------------------------------------------------------
// Enough commons/rares per faction that every pack slot can always be filled,
// so composition assertions aren't muddied by pool-exhaustion backfills.
let counter = 0
function card(faction, rarity, cardType = 'CHARACTER') {
  counter += 1
  return { reference: `${faction}_${rarity}_${cardType}_${counter}`, name: `Card ${counter}`, faction, rarity, cardType }
}

function makeCardPool({ commonsPerFaction = 6, raresPerFaction = 4, heroesPerFaction = 2, uniquesPerFaction = 1 } = {}) {
  const cards = []
  for (const f of FACTIONS) {
    for (let i = 0; i < commonsPerFaction; i++) cards.push(card(f, 'C'))
    for (let i = 0; i < raresPerFaction; i++) cards.push(card(f, i % 2 === 0 ? 'R1' : 'R2'))
    for (let i = 0; i < heroesPerFaction; i++) cards.push(card(f, 'C', 'HERO'))
    for (let i = 0; i < uniquesPerFaction; i++) cards.push(card(f, 'U'))
  }
  return cards
}

describe('generateAllPacks (booster composition)', () => {
  it('deals playerCount * packsPerPlayer packs of 13 (1 hero + 9 commons + 3 rares)', () => {
    const cards = makeCardPool()
    const packs = generateAllPacks(cards, 4, 4, { rng: mulberry32(1) })
    expect(packs).toHaveLength(16)
    for (const pack of packs) {
      expect(pack).toHaveLength(13)
      expect(new Set(pack).size).toBe(pack.length) // no duplicate refs within a pack
    }
  })

  it('drops to 12 cards (no hero slot) when includeHeroes is false', () => {
    const cards = makeCardPool()
    const packs = generateAllPacks(cards, 1, 1, { includeHeroes: false, rng: mulberry32(1) })
    expect(packs[0]).toHaveLength(12)
  })

  it('gives every 8th pack (index 7, 15, ...) a unique in the last slot by default', () => {
    const cards = makeCardPool({ uniquesPerFaction: 3 })
    const packs = generateAllPacks(cards, 1, 8, { rng: mulberry32(5) })
    const uniqueRefs = new Set(cards.filter(c => c.rarity === 'U').map(c => c.reference))

    packs.forEach((pack, i) => {
      const lastCard = pack[pack.length - 1]
      if (i % 8 === 7) {
        expect(uniqueRefs.has(lastCard)).toBe(true)
      } else {
        expect(uniqueRefs.has(lastCard)).toBe(false)
      }
    })
  })

  it('with "add random uniques" (randomUniqueRate > 0), never hands out the same injected unique twice', () => {
    const cards = makeCardPool({ uniquesPerFaction: 0 }) // standard sets carry no uniques
    const uniquePool = [card('AX', 'U'), card('BR', 'U')] // only 2 available
    const packs = generateAllPacks(cards, 1, 20, { rng: mulberry32(3), randomUniqueRate: 1, uniquePool })

    const poolRefs = new Set(uniquePool.map(c => c.reference))
    const drawn = packs.flat().filter(ref => poolRefs.has(ref))
    expect(new Set(drawn).size).toBe(drawn.length) // no repeats
    expect(drawn.length).toBeLessThanOrEqual(uniquePool.length)
  })
})

describe('generateChaosPacks', () => {
  it('builds single-set boosters per the requested mix and shuffles them together', () => {
    const cardsBySet = { CORE: makeCardPool(), BISE: makeCardPool() }
    const packs = generateChaosPacks(cardsBySet, { CORE: 3, BISE: 2 }, { rng: mulberry32(9) })
    expect(packs).toHaveLength(5)
    for (const pack of packs) expect(pack).toHaveLength(13)
  })

  it('skips sets with a zero or missing count, and sets with no card data', () => {
    const cardsBySet = { CORE: makeCardPool() }
    const packs = generateChaosPacks(cardsBySet, { CORE: 2, BISE: 0, EOLE: 5 }, { rng: mulberry32(1) })
    expect(packs).toHaveLength(2)
  })
})

describe('generateStructuredPacks', () => {
  it('lays packs out BY ROUND so every seat opens the same set each round', () => {
    const cardsBySet = { CORE: makeCardPool(), BISE: makeCardPool() }
    const playerCount = 3
    // 2 CORE + 2 BISE per player -> rounds [CORE, CORE, BISE, BISE]
    const packs = generateStructuredPacks(cardsBySet, { CORE: 2, BISE: 2 }, playerCount, { rng: mulberry32(2) })
    expect(packs).toHaveLength(4 * playerCount)

    const coreRefs = new Set(cardsBySet.CORE.map(c => c.reference))
    const biseRefs = new Set(cardsBySet.BISE.map(c => c.reference))
    const isFromSet = (pack, refSet) => pack.every(ref => refSet.has(ref))

    // Round 1 (indices 0..playerCount-1) and round 2 are CORE; rounds 3 & 4 are BISE.
    for (let i = 0; i < playerCount * 2; i++) expect(isFromSet(packs[i], coreRefs)).toBe(true)
    for (let i = playerCount * 2; i < playerCount * 4; i++) expect(isFromSet(packs[i], biseRefs)).toBe(true)
  })
})

describe('generateCubeDraftPacks (multiset, duplicates preserved)', () => {
  it('deals equal-size packs and does not dedupe intentional duplicate copies', () => {
    const base = makeCardPool({ commonsPerFaction: 2, raresPerFaction: 1, heroesPerFaction: 0, uniquesPerFaction: 0 })
    const cardObjects = [...base, ...base] // duplicate the whole pool
    const totalPacks = 4
    const packs = generateCubeDraftPacks(cardObjects, totalPacks)
    expect(packs).toHaveLength(totalPacks)
    const sizes = new Set(packs.map(p => p.length))
    expect(sizes.size).toBe(1) // every pack the same size

    const totalDealt = packs.flat().length
    expect(totalDealt).toBeLessThanOrEqual(cardObjects.length)
  })

  it('returns [] when totalPacks < 1', () => {
    expect(generateCubeDraftPacks(makeCardPool(), 0)).toEqual([])
  })
})

describe('generateCubeRecipePacks (fixed rarity recipe)', () => {
  it('gives every pack exactly the recipe counts, recycling a scarce pool without repeats within a pack', () => {
    const commons = Array.from({ length: 5 }, () => card('AX', 'C')) // scarce: fewer than 3*8=24 needed
    const rares = Array.from({ length: 40 }, () => card('BR', 'R1'))
    const uniques = Array.from({ length: 20 }, () => card('LY', 'U'))
    const cardObjects = [...commons, ...rares, ...uniques]

    const totalPacks = 8
    const recipe = { commons: 3, rares: 8, uniques: 1 }
    const packs = generateCubeRecipePacks(cardObjects, totalPacks, recipe)

    expect(packs).toHaveLength(totalPacks)
    for (const pack of packs) {
      expect(pack).toHaveLength(12)
      expect(new Set(pack).size).toBe(12) // no dup within a single booster
    }
  })

  it('never repeats a unique across the whole pool when uniques >= totalPacks', () => {
    const uniques = Array.from({ length: 16 }, () => card('LY', 'U'))
    const packs = generateCubeRecipePacks(uniques, 16, { commons: 0, rares: 0, uniques: 1 })
    const allUniquesDealt = packs.flat()
    expect(new Set(allUniquesDealt).size).toBe(allUniquesDealt.length)
  })

  it('returns [] when totalPacks < 1', () => {
    expect(generateCubeRecipePacks(makeCardPool(), 0, { commons: 1, rares: 1, uniques: 1 })).toEqual([])
  })
})

describe('dealHeroSlots', () => {
  it('is a no-op when heroRefs is empty', () => {
    const packs = [['a', 'b'], ['c', 'd']]
    expect(dealHeroSlots(packs, [])).toBe(packs)
  })

  it('prepends a hero to every pack, cycling through the hero pool when packs > heroes', () => {
    const packs = [['a'], ['b'], ['c']]
    const heroRefs = ['H1', 'H2']
    const dealt = dealHeroSlots(packs, heroRefs)
    expect(dealt).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      expect(['H1', 'H2']).toContain(dealt[i][0])
      expect(dealt[i].slice(1)).toEqual(packs[i])
    }
  })

  it('does not mutate the input packs', () => {
    const packs = [['a']]
    dealHeroSlots(packs, ['H1'])
    expect(packs).toEqual([['a']])
  })
})

describe('generateTournamentSealedPool', () => {
  it('is fully deterministic for the same seeded rng', () => {
    const cards = makeCardPool()
    const a = generateTournamentSealedPool(cards, mulberry32(55), { boosters: 7 })
    const b = generateTournamentSealedPool(cards, mulberry32(55), { boosters: 7 })
    expect(a).toEqual(b)
  })

  it('swaps exactly uniqueRefs.length rare slots for the given unique refs', () => {
    const cards = makeCardPool()
    const uniqueRefs = ['INJECTED_U_1', 'INJECTED_U_2', 'INJECTED_U_3']
    const pool = generateTournamentSealedPool(cards, mulberry32(7), { boosters: 7, uniqueRefs })
    const flat = pool.flat()
    for (const ref of uniqueRefs) expect(flat).toContain(ref)
  })

  it('produces boosters with no unique slot of their own when uniqueRefs is empty', () => {
    const cards = makeCardPool({ uniquesPerFaction: 5 })
    const pool = generateTournamentSealedPool(cards, mulberry32(1), { boosters: 3 })
    const uniqueRefsInPool = new Set(cards.filter(c => c.rarity === 'U').map(c => c.reference))
    for (const ref of pool.flat()) expect(uniqueRefsInPool.has(ref)).toBe(false)
  })
})

describe('generatePacksFromPool', () => {
  it('builds playerCount * packsPerPlayer packs of 12 from a flat reference list', () => {
    const refs = Array.from({ length: 50 }, (_, i) => `REF_${i}`)
    const packs = generatePacksFromPool(refs, 2, 4)
    expect(packs).toHaveLength(8)
    for (const pack of packs) expect(pack).toHaveLength(12)
  })
})
