// The ONE place a sealed pool is generated from a config (docs/tournaments/user-tournaments-spec.md
// §5.2). Server-side only (imports card data fetching). Lot 1 = the legacy regeneration
// logic (seeded PRNG + deterministic uniques + generateTournamentSealedPool), now also
// honouring `excludeBanlist`. Callers STORE the result on the pool row; this function is
// still deterministic so a legacy row (no stored cards) reproduces bit for bit.
import { hashSeed, mulberry32 } from './prng.js'
import { generateTournamentSealedPool } from './packGenerator.js'
import { pickDeterministicUniques } from './uniqueFactionRanges.js'
import { fetchSet } from './cardData.js'
import { filterBanned, isBanned } from './banlist.js'
import { legacyColumnsFromConfig, SEALED_BOOSTERS } from './tournamentConfig.js'

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
