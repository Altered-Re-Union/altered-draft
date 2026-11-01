import { describe, it, expect } from 'vitest'
import {
  generateAllPacks, generateChaosPacks, generateStructuredPacks,
  generateCubeDraftPacks, generateCubeRecipePacks, dealHeroSlots,
  generateTournamentSealedPool, generatePacksFromPool, quotas, generateFactionSealedPool,
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

describe('quotas', () => {
  it('apportions exactly by largest remainder', () => {
    expect(quotas({ CORE: 1, BISE: 2 }, 63, mulberry32(1))).toEqual({ CORE: 21, BISE: 42 })
    expect(quotas({ CORE: 1, BISE: 2, CYCLONE: 1 }, 21, mulberry32(1))).toEqual({ CORE: 5, BISE: 11, CYCLONE: 5 })
  })
  it('always sums to n and keeps every set, zero included', () => {
    const q = quotas({ CORE: 1, ALIZE: 1, BISE: 1, CYCLONE: 1, DUSTER: 1, EOLE: 1 }, 2, mulberry32(3))
    expect(Object.values(q).reduce((a, b) => a + b, 0)).toBe(2)
    expect(Object.keys(q)).toEqual(['CORE', 'ALIZE', 'BISE', 'CYCLONE', 'DUSTER', 'EOLE'])
    expect(Object.values(q).filter(v => v === 1)).toHaveLength(2)
  })
  it('breaks remainder ties with the rng, not with the set order', () => {
    const winners = new Set()
    for (let seed = 1; seed <= 30; seed++) {
      const q = quotas({ CORE: 1, ALIZE: 1, BISE: 1, CYCLONE: 1, DUSTER: 1, EOLE: 1 }, 1, mulberry32(seed))
      winners.add(Object.keys(q).find(k => q[k] === 1))
    }
    expect(winners.size).toBeGreaterThan(2)
    expect(quotas({ CORE: 1, BISE: 1 }, 1, mulberry32(9))).toEqual(quotas({ BISE: 1, CORE: 1 }, 1, mulberry32(9)))
  })
  it('handles set codes unknown to SETS, after the known ones in insertion order', () => {
    const q = quotas({ S2: 1, S1: 1, CORE: 2 }, 4, mulberry32(1))
    expect(Object.keys(q)).toEqual(['CORE', 'S2', 'S1'])
    expect(q).toEqual({ CORE: 2, S2: 1, S1: 1 })
  })
})

describe('generateFactionSealedPool', () => {
  function fakeFactionSets() {
    const mk = (set, faction, rarity, n, cardType = 'CHARACTER', refFaction = faction, name) => ({
      reference: `ALT_${set}_B_${refFaction}_${n}_${rarity}`, name: name ?? `${set} ${faction} ${rarity} ${cardType} ${n}`, faction, rarity, cardType,
    })
    const sets = { S1: [], S2: [], S3: [] }
    const add = (set, f, { heroes, commons, rares }) => {
      for (let i = 1; i <= heroes; i++) sets[set].push(mk(set, f, 'C', 100 + i, 'HERO'))
      for (let i = 1; i <= commons; i++) sets[set].push(mk(set, f, 'C', i, 'CHARACTER', f, `Common ${f} ${i}`))
      for (let i = 1; i <= rares; i++) sets[set].push(mk(set, f, 'R1', 50 + i))
    }
    add('S1', 'AX', { heroes: 3, commons: 12, rares: 8 })
    add('S2', 'AX', { heroes: 1, commons: 9, rares: 2 })
    sets.S2.push({ reference: 'ALT_S2_B_YZ_45_R2', name: 'S2 OOF', faction: 'AX', rarity: 'R2', cardType: 'CHARACTER' })
    add('S3', 'AX', { heroes: 1, commons: 9, rares: 0 })
    for (const set of Object.keys(sets)) {
      add(set, 'BR', { heroes: 1, commons: 10, rares: 4 })
      sets[set].push(mk(set, 'AX', 'C', 900, 'TOKEN'))
    }
    return sets
  }
  const sets = fakeFactionSets()
  const byRef = new Map(Object.values(sets).flat().map(c => [c.reference, c]))
  const rareStart = pack => pack.length - 3

  it('deals 7 boosters of 13 (12 without heroes), all of the faction, no duplicate inside a booster', () => {
    const packs = generateFactionSealedPool(sets, mulberry32(1), { faction: 'AX', weights: { S1: 1, S2: 2, S3: 1 } })
    expect(packs).toHaveLength(7)
    for (const p of packs) {
      expect(p).toHaveLength(13)
      expect(new Set(p).size).toBe(13)
      expect(p.every(r => byRef.get(r).faction === 'AX')).toBe(true)
      expect(byRef.get(p[0]).cardType).toBe('HERO')
      expect(p.slice(1, 10).every(r => byRef.get(r).rarity === 'C')).toBe(true)
      expect(p.slice(10).every(r => ['R1', 'R2', 'EX'].includes(byRef.get(r).rarity))).toBe(true)
    }
    expect(generateFactionSealedPool(sets, mulberry32(1), { faction: 'AX', weights: { S1: 1 }, includeHeroes: false })[0]).toHaveLength(12)
  })
  it('gives every pool the exact per-set quotas for commons and rares', () => {
    const packs = generateFactionSealedPool(sets, mulberry32(2), { faction: 'AX', weights: { S1: 1, S2: 2 } })
    const count = (slice, set) => packs.flatMap(slice).filter(r => r.split('_')[1] === set).length
    expect(count(p => p.slice(1, 10), 'S1')).toBe(21); expect(count(p => p.slice(1, 10), 'S2')).toBe(42)
    expect(count(p => p.slice(10), 'S1')).toBe(7); expect(count(p => p.slice(10), 'S2')).toBe(14)
    expect(count(p => p, 'S3')).toBe(0)
  })
  it('includes out-of-faction rares and keeps reprints as distinct cards', () => {
    const packs = generateFactionSealedPool(sets, mulberry32(3), { faction: 'AX', weights: { S2: 1 } })
    expect(packs.flat()).toContain('ALT_S2_B_YZ_45_R2')
    const both = generateFactionSealedPool(sets, mulberry32(3), { faction: 'AX', weights: { S1: 1, S2: 1 } })
    expect(both.flatMap(p => p.slice(1, 10)).filter(r => r.startsWith('ALT_S2_')).length).toBeGreaterThanOrEqual(31)
  })
  it('falls back to the other sets when a set has no rare of the faction', () => {
    const packs = generateFactionSealedPool(sets, mulberry32(4), { faction: 'AX', weights: { S1: 1, S3: 1 } })
    for (const p of packs) expect(p.slice(10).every(r => r.startsWith('ALT_S1_'))).toBe(true)
    for (const p of packs) expect(p).toHaveLength(13)
  })
  it('deals distinct heroes until exhausted, then repeats', () => {
    const packs = generateFactionSealedPool(sets, mulberry32(5), { faction: 'AX', weights: { S1: 1, S2: 1, S3: 1 } })
    const heroes = packs.map(p => p[0])
    expect(new Set(heroes).size).toBe(5) // 3 + 1 + 1 distinct heroes, then 2 repeats
    const single = generateFactionSealedPool(sets, mulberry32(5), { faction: 'AX', weights: { S2: 1 } })
    expect(new Set(single.map(p => p[0])).size).toBe(1)
  })
  it('is deterministic for a seed and places the in-booster uniques in rare slots', () => {
    const opts = { faction: 'AX', weights: { S1: 1, S2: 1 }, uniqueRefs: ['ALT_S1_B_AX_01_U_7', 'ALT_S2_B_AX_02_U_9'] }
    const a = generateFactionSealedPool(sets, mulberry32(6), opts)
    expect(a).toEqual(generateFactionSealedPool(sets, mulberry32(6), opts))
    expect(a).not.toEqual(generateFactionSealedPool(sets, mulberry32(7), opts))
    const positions = a.flatMap((p, i) => p.map((r, j) => [r, i, j])).filter(([r]) => r.includes('_U_'))
    expect(positions).toHaveLength(2)
    for (const [, i, j] of positions) expect(j).toBeGreaterThanOrEqual(rareStart(a[i]))
  })
})
