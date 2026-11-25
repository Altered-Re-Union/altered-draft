// The ONE place a sealed pool is generated from a config (docs/tournaments/user-tournaments-spec.md
// §5.2). Server-side only (imports card data fetching). Lot 1 = the legacy regeneration
// logic (seeded PRNG + deterministic uniques + generateTournamentSealedPool), now also
// honouring `excludeBanlist`. Callers STORE the result on the pool row; this function is
// still deterministic so a legacy row (no stored cards) reproduces bit for bit.
import { hashSeed, mulberry32 } from './prng.js'
import { generateTournamentSealedPool, generateFactionSealedPool, generateMultisetSealedPool, pickRareSlots, pickWeightedSet, rollBoosterHits, quotas, shuffle, deduplicateByNameFaction } from './packGenerator.js'
import { pickDeterministicUniques, hasFactionRanges } from './uniqueFactionRanges.js'
import { fetchSet, SETS } from './cardData.js'
import { filterBanned, isBanned, banlistVersionOf } from './banlist.js'
import { legacyColumnsFromConfig, configSetCodes, SEALED_BOOSTERS } from './tournamentConfig.js'
import { setCodeFromRef } from './assets.js'

/**
 * The one filter every pickDeterministicUniques call of this module goes through: rejects a
 * banned unique (when the ban list is on) and any ref already drawn for this pool, so two
 * calls on the same uniques stream never hand out the same serial. The caller adds every
 * drawn ref to `drawn`. An always-true predicate consumes no extra rng (goldens pin it).
 */
function uniqueGate(config) {
  const drawn = new Set()
  const banlist = banlistVersionOf(config)
  const isAllowed = ref => !drawn.has(ref) && (!config.excludeBanlist || !isBanned(ref, banlist))
  return { isAllowed, drawn }
}

const setRank = code => { const i = SETS.findIndex(s => s.code === code); return i === -1 ? SETS.length : i }

/**
 * Random mode (spec §13.2 "Random mode", §13.3): every booster rolls `rng() < 1 / oneIn` on
 * the booster stream; a hit asks `setForHit(i)` for the unique's set (null = dropped, the
 * roll is still consumed; a faction source draws it on `uRng` here, before any unique call).
 * Then one pickDeterministicUniques per set in SETS order on `uRng`; each ref replaces the
 * last slot (a rare) of its hit booster, in booster order. Mutates `boosters`.
 * @returns {string[]} the placed refs
 */
export function placeRandomUniques(boosters, { rng, uRng, oneIn, setForHit, faction, isAllowed, onDrawn }) {
  const hitsBySet = {}
  rollBoosterHits(boosters.length, oneIn, rng).forEach((hit, i) => {
    if (!hit) return
    const code = setForHit(i)
    if (code) (hitsBySet[code] ??= []).push(i)
  })
  const placed = []
  for (const code of Object.keys(hitsBySet).sort((a, b) => setRank(a) - setRank(b))) {
    const idx = hitsBySet[code]
    const refs = pickDeterministicUniques(code, uRng, { uniqueCount: idx.length, faction, isAllowed })
    onDrawn(refs)
    if (refs.length < idx.length) throw new Error(`could only draw ${refs.length}/${idx.length} random uniques for ${code}`)
    idx.forEach((i, k) => { boosters[i][boosters[i].length - 1] = refs[k] })
    placed.push(...refs)
  }
  return placed
}

/**
 * The exact string fed into hashSeed() for a pool. Deliberately excludes tournament_id:
 * a pool's contents must not change when it gets bound to a tournament.
 * @param {string} sub
 * @param {{set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques?, nonce}} cols
 */
export function buildPoolSeedString(sub, cols) {
  return [
    sub,
    cols.set_code,
    String(cols.unique_count),
    String(cols.even_factions),
    String(cols.heroes_in_pool),
    String(cols.guaranteed_uniques ?? 0),
    cols.nonce,
  ].join('|')
}

/**
 * @param {string} sub - verified Keycloak sub of the pool's owner
 * @param {{ config: object, nonce: string }} pool - a validated config (tournamentConfig.js) + the row's nonce
 * @param {{ fetchCards?: (setCode: string) => Promise<object[]> }} deps - test seam; defaults to fetchSet
 * @returns {Promise<{ cards: Record<string, number>, boosters: string[][] }>}
 */
export async function buildPool(sub, { config, nonce }, { fetchCards = fetchSet } = {}) {
  if (config.source.type === 'cube') throw new Error('cube pools are dealt per tournament: poolStore.insertCappedPool')
  if (config.source.type === 'faction') return buildFactionPool(sub, { config, nonce }, fetchCards)
  if (config.source.type === 'multiset') return buildMultisetPool(sub, { config, nonce }, fetchCards)
  const setCode = config.source.setCode
  const cols = { ...legacyColumnsFromConfig(config), nonce }
  const seedStr = buildPoolSeedString(sub, cols)

  const inBooster = config.uniques.inBoosters
  const outside = config.uniques.guaranteed
  const wanted = inBooster + outside
  const gate = uniqueGate(config)
  // One deterministic stream for every unique, then split: the first `inBooster` replace
  // rare slots, the rest are handed out next to the boosters (like appended heroes).
  // Random mode continues the same uniques stream after this draw.
  const uRng = mulberry32(hashSeed(`${seedStr}#uniques`))
  const allUniques = pickDeterministicUniques(setCode, uRng, {
    uniqueCount: wanted,
    evenFactions: config.uniques.evenFactions,
    faction: config.uniques.faction ?? null,
    isAllowed: gate.isAllowed,
  })
  for (const ref of allUniques) gate.drawn.add(ref)
  if (allUniques.length < wanted) {
    throw new Error(`could only draw ${allUniques.length}/${wanted} uniques for ${setCode}`)
  }
  const boosterUniques = allUniques.slice(0, inBooster)
  const outsideUniques = allUniques.slice(inBooster)

  let cards = await fetchCards(setCode)
  if (!cards?.length) throw new Error(`no cards loaded for ${setCode}`)
  if (config.excludeBanlist) cards = filterBanned(cards, banlistVersionOf(config))

  const includeHeroes = config.heroes === 'packs'
  const rng = mulberry32(hashSeed(seedStr))
  const boosters = generateTournamentSealedPool(cards, rng, {
    boosters: config.source.boosters ?? SEALED_BOOSTERS,
    uniqueRefs: boosterUniques,
    includeHeroes,
  })
  if (config.uniques.randomOneIn != null) {
    placeRandomUniques(boosters, {
      rng, uRng,
      oneIn: config.uniques.randomOneIn,
      setForHit: () => (hasFactionRanges(setCode) ? setCode : null),
      faction: config.uniques.faction ?? null,
      isAllowed: gate.isAllowed,
      onDrawn: refs => refs.forEach(ref => gate.drawn.add(ref)),
    })
  }

  const counts = {}
  for (const ref of boosters.flat()) counts[ref] = (counts[ref] ?? 0) + 1
  for (const ref of outsideUniques) counts[ref] = (counts[ref] ?? 0) + 1
  if (!includeHeroes) {
    for (const card of cards) {
      if (card.cardType === 'HERO') counts[card.reference] = (counts[card.reference] ?? 0) + 1
    }
  }
  return { cards: counts, boosters }
}

// Mono-faction source (design §6): weighted sets, exact quotas, uniques spread over the
// included sets that have range data. Its own rng streams; the `set` branch above is untouched.
async function buildFactionPool(sub, { config, nonce }, fetchCards) {
  const { faction, sets: weights } = config.source
  const setCodes = configSetCodes(config)
  const seedStr = buildPoolSeedString(sub, { ...legacyColumnsFromConfig(config), nonce })

  const cardsBySet = {}
  const loaded = await Promise.all(setCodes.map(code => fetchCards(code)))
  setCodes.forEach((code, i) => {
    if (!loaded[i]?.length) throw new Error(`no cards loaded for ${code}`)
    cardsBySet[code] = config.excludeBanlist ? filterBanned(loaded[i], banlistVersionOf(config)) : loaded[i]
  })

  const inBooster = config.uniques.inBoosters
  const wanted = inBooster + config.uniques.guaranteed
  const gate = uniqueGate(config)
  const uRng = mulberry32(hashSeed(`${seedStr}#uniques`))
  let boosterUniques = []
  let outsideUniques = []
  if (wanted > 0) {
    const eligible = setCodes.filter(hasFactionRanges)
    if (!eligible.length) throw new Error('no unique data for the included sets')
    const q = quotas(Object.fromEntries(eligible.map(c => [c, weights[c]])), wanted, uRng)
    const all = []
    for (const code of eligible) {
      if (!q[code]) continue
      const refs = pickDeterministicUniques(code, uRng, {
        uniqueCount: q[code],
        faction: config.uniques.faction ?? null,
        isAllowed: gate.isAllowed,
      })
      for (const ref of refs) gate.drawn.add(ref)
      all.push(...refs)
    }
    if (all.length < wanted) throw new Error(`could only draw ${all.length}/${wanted} uniques for the included sets`)
    const mixed = shuffle(all, uRng)
    boosterUniques = mixed.slice(0, inBooster)
    outsideUniques = mixed.slice(inBooster)
  }

  const includeHeroes = config.heroes === 'packs'
  const rng = mulberry32(hashSeed(seedStr))
  const boosters = generateFactionSealedPool(cardsBySet, rng, {
    faction,
    weights,
    boosters: config.source.boosters ?? SEALED_BOOSTERS,
    uniqueRefs: boosterUniques,
    includeHeroes,
  })
  if (config.uniques.randomOneIn != null) {
    // Boosters mix sets: each hit's set is drawn by the source weights over the sets with data.
    const eligibleWeights = Object.fromEntries(setCodes.filter(hasFactionRanges).map(code => [code, weights[code]]))
    const hasEligible = Object.values(eligibleWeights).some(w => w > 0)
    placeRandomUniques(boosters, {
      rng, uRng,
      oneIn: config.uniques.randomOneIn,
      setForHit: () => (hasEligible ? pickWeightedSet(eligibleWeights, uRng) ?? null : null),
      faction: config.uniques.faction ?? null,
      isAllowed: gate.isAllowed,
      onDrawn: refs => refs.forEach(ref => gate.drawn.add(ref)),
    })
  }

  const counts = {}
  for (const ref of boosters.flat()) counts[ref] = (counts[ref] ?? 0) + 1
  for (const ref of outsideUniques) counts[ref] = (counts[ref] ?? 0) + 1
  if (!includeHeroes) {
    for (const code of setCodes) {
      const heroes = cardsBySet[code].filter(c => c.cardType === 'HERO' && c.rarity !== 'U' && c.faction === faction)
      for (const card of deduplicateByNameFaction(heroes)) counts[card.reference] = (counts[card.reference] ?? 0) + 1
    }
  }
  return { cards: counts, boosters }
}

// Multi-set source (spec §13.3): classic single-set boosters per set, shuffled together. An
// in-booster unique is of its booster's set (only sets with range data are eligible); each
// guaranteed unique's set is drawn weighted by the booster counts. Random mode rolls every
// booster instead of picking rare slots; a hit on a booster of a set with data takes its last
// slot, other hits are dropped. Rng order is a contract: booster stream = boosters, shuffle,
// rare-slot positions or random rolls; uniques stream = set draws, then one
// pickDeterministicUniques per set in SETS order (the random hits and the guaranteed together).
async function buildMultisetPool(sub, { config, nonce }, fetchCards) {
  const counts = config.source.sets
  const setCodes = configSetCodes(config)
  const seedStr = buildPoolSeedString(sub, { ...legacyColumnsFromConfig(config), nonce })
  const rng = mulberry32(hashSeed(seedStr))
  const uRng = mulberry32(hashSeed(`${seedStr}#uniques`))

  const cardsBySet = {}
  for (const code of setCodes) {
    const loaded = await fetchCards(code)
    if (!loaded?.length) throw new Error(`no cards loaded for ${code}`)
    cardsBySet[code] = config.excludeBanlist ? filterBanned(loaded, banlistVersionOf(config)) : loaded
  }

  const includeHeroes = config.heroes === 'packs'
  const boosters = generateMultisetSealedPool(cardsBySet, rng, { counts, includeHeroes })
  const setOf = i => setCodeFromRef(boosters[i][0])

  const inBoosters = config.uniques.inBoosters
  const guaranteed = config.uniques.guaranteed
  const randomOneIn = config.uniques.randomOneIn ?? null
  const outsideUniques = []
  if (inBoosters + guaranteed > 0 || randomOneIn != null) {
    const eligibleSets = setCodes.filter(hasFactionRanges)
    if (!eligibleSets.length && inBoosters + guaranteed > 0) throw new Error('no unique data for the included sets')
    const eligible = boosters.map((_, i) => i).filter(i => hasFactionRanges(setOf(i)))

    const positionsBySet = {}
    if (randomOneIn != null) {
      rollBoosterHits(boosters.length, randomOneIn, rng).forEach((hit, i) => {
        if (hit && hasFactionRanges(setOf(i))) (positionsBySet[setOf(i)] ??= []).push([i, boosters[i].length - 1])
      })
    } else if (inBoosters > 0) {
      const positions = pickRareSlots(boosters, eligible, inBoosters, rng, boosters[0].length - 3)
      if (positions.length < inBoosters) throw new Error(`only ${positions.length}/${inBoosters} rare slots in boosters with unique data`)
      for (const pos of positions) (positionsBySet[setOf(pos[0])] ??= []).push(pos)
    }
    const outsideBySet = {}
    const weights = Object.fromEntries(eligibleSets.map(code => [code, counts[code]]))
    for (let i = 0; i < guaranteed; i++) {
      const code = pickWeightedSet(weights, uRng)
      outsideBySet[code] = (outsideBySet[code] ?? 0) + 1
    }

    const gate = uniqueGate(config)
    for (const code of eligibleSets) {
      const slots = positionsBySet[code] ?? []
      const wanted = slots.length + (outsideBySet[code] ?? 0)
      if (!wanted) continue
      const refs = pickDeterministicUniques(code, uRng, {
        uniqueCount: wanted,
        faction: config.uniques.faction ?? null,
        isAllowed: gate.isAllowed,
      })
      for (const ref of refs) gate.drawn.add(ref)
      if (refs.length < wanted) throw new Error(`could only draw ${refs.length}/${wanted} uniques for ${code}`)
      slots.forEach(([p, s], k) => { boosters[p][s] = refs[k] })
      outsideUniques.push(...refs.slice(slots.length))
    }
  }

  const cards = {}
  for (const ref of boosters.flat()) cards[ref] = (cards[ref] ?? 0) + 1
  for (const ref of outsideUniques) cards[ref] = (cards[ref] ?? 0) + 1
  if (!includeHeroes) {
    for (const code of setCodes) {
      for (const card of cardsBySet[code]) {
        if (card.cardType === 'HERO') cards[card.reference] = (cards[card.reference] ?? 0) + 1
      }
    }
  }
  return { cards, boosters }
}
