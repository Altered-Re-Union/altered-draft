// The ONE place a sealed pool is generated from a config (docs/tournaments/user-tournaments-spec.md
// §5.2). Server-side only (imports card data fetching). Lot 1 = the legacy regeneration
// logic (seeded PRNG + deterministic uniques + generateTournamentSealedPool), now also
// honouring `excludeBanlist`. Callers STORE the result on the pool row; this function is
// still deterministic so a legacy row (no stored cards) reproduces bit for bit.
import { hashSeed, mulberry32 } from './prng.js'
import { generateTournamentSealedPool, generateFactionSealedPool, quotas, shuffle, deduplicateByNameFaction } from './packGenerator.js'
import { pickDeterministicUniques, hasFactionRanges } from './uniqueFactionRanges.js'
import { fetchSet } from './cardData.js'
import { filterBanned, isBanned } from './banlist.js'
import { legacyColumnsFromConfig, configSetCodes, SEALED_BOOSTERS } from './tournamentConfig.js'

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
  if (config.source.type === 'faction') return buildFactionPool(sub, { config, nonce }, fetchCards)
  const setCode = config.source.setCode
  const cols = { ...legacyColumnsFromConfig(config), nonce }
  const seedStr = buildPoolSeedString(sub, cols)

  const inBooster = config.uniques.inBoosters
  const outside = config.uniques.guaranteed
  const wanted = inBooster + outside
  const isAllowed = config.excludeBanlist ? ref => !isBanned(ref) : undefined
  // One deterministic stream for every unique, then split: the first `inBooster` replace
  // rare slots, the rest are handed out next to the boosters (like appended heroes).
  const allUniques = pickDeterministicUniques(setCode, mulberry32(hashSeed(`${seedStr}#uniques`)), {
    uniqueCount: wanted,
    evenFactions: config.uniques.evenFactions,
    faction: config.uniques.faction ?? null,
    ...(isAllowed ? { isAllowed } : {}),
  })
  if (allUniques.length < wanted) {
    throw new Error(`could only draw ${allUniques.length}/${wanted} uniques for ${setCode}`)
  }
  const boosterUniques = allUniques.slice(0, inBooster)
  const outsideUniques = allUniques.slice(inBooster)

  let cards = await fetchCards(setCode)
  if (!cards?.length) throw new Error(`no cards loaded for ${setCode}`)
  if (config.excludeBanlist) cards = filterBanned(cards)

  const includeHeroes = config.heroes === 'packs'
  const boosters = generateTournamentSealedPool(cards, mulberry32(hashSeed(seedStr)), {
    boosters: config.source.boosters ?? SEALED_BOOSTERS,
    uniqueRefs: boosterUniques,
    includeHeroes,
  })

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
  const loaded = await Promise.all(setCodes.map(fetchCards))
  setCodes.forEach((code, i) => {
    if (!loaded[i]?.length) throw new Error(`no cards loaded for ${code}`)
    cardsBySet[code] = config.excludeBanlist ? filterBanned(loaded[i]) : loaded[i]
  })

  const inBooster = config.uniques.inBoosters
  const wanted = inBooster + config.uniques.guaranteed
  const isAllowed = config.excludeBanlist ? ref => !isBanned(ref) : undefined
  let boosterUniques = []
  let outsideUniques = []
  if (wanted > 0) {
    const eligible = setCodes.filter(hasFactionRanges)
    if (!eligible.length) throw new Error('no unique data for the included sets')
    const uRng = mulberry32(hashSeed(`${seedStr}#uniques`))
    const q = quotas(Object.fromEntries(eligible.map(c => [c, weights[c]])), wanted, uRng)
    const all = []
    for (const code of eligible) {
      if (!q[code]) continue
      all.push(...pickDeterministicUniques(code, uRng, {
        uniqueCount: q[code],
        faction: config.uniques.faction ?? null,
        ...(isAllowed ? { isAllowed } : {}),
      }))
    }
    if (all.length < wanted) throw new Error(`could only draw ${all.length}/${wanted} uniques for the included sets`)
    const mixed = shuffle(all, uRng)
    boosterUniques = mixed.slice(0, inBooster)
    outsideUniques = mixed.slice(inBooster)
  }

  const includeHeroes = config.heroes === 'packs'
  const boosters = generateFactionSealedPool(cardsBySet, mulberry32(hashSeed(seedStr)), {
    faction,
    weights,
    boosters: config.source.boosters ?? SEALED_BOOSTERS,
    uniqueRefs: boosterUniques,
    includeHeroes,
  })

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
