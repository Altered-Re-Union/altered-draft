// Shared "regenerate the tournament sealed pool" logic — used by both
// /api/validate-deck and /api/sealed-pool so they never drift apart.
import { hashSeed, mulberry32 } from '../../src/lib/prng.js'
import { generateTournamentSealedPool } from '../../src/lib/packGenerator.js'
import { pickDeterministicUniques } from '../../src/lib/uniqueFactionRanges.js'
import { fetchSet } from '../../src/lib/cardData.js'

/**
 * Regenerates the deterministic tournament sealed pool for `sub` at `event`
 * (as returned by findActiveEvent) and returns it as ref -> count in the pool.
 *
 * `event.heroesInPool` (default true) controls how heroes are handled: when true,
 * heroes are drafted into the boosters like any other card, so only whichever ones
 * got drawn are legal. When false, heroes are excluded from the random pool entirely
 * (`includeHeroes: false` below) and instead EVERY hero of the set is added to the
 * pool afterward — not as a possible drafted card, just guaranteed present — so any
 * hero is legal without a consumer (e.g. altered-core-decks-api's format validators)
 * needing a special "any set-N hero" exemption; a hero is just another pool ref.
 * @param {string} sub - verified Keycloak sub
 * @param {{starts_at: string, ends_at: string, setCode: string, uniqueCount?: number, evenFactions?: boolean, heroesInPool?: boolean}} event
 * @returns {Promise<Record<string, number>>}
 */
export async function regeneratePoolCounts(sub, event) {
  const seedStr = `${sub}|${event.starts_at}|${event.ends_at}`
  const uniqueRefs = pickDeterministicUniques(event.setCode, mulberry32(hashSeed(`${seedStr}#uniques`)), {
    uniqueCount: event.uniqueCount ?? 0,
    evenFactions: !!event.evenFactions,
  })
  const cards = await fetchSet(event.setCode)
  const heroesInPool = event.heroesInPool !== false
  const pool = generateTournamentSealedPool(cards, mulberry32(hashSeed(seedStr)), {
    uniqueRefs,
    includeHeroes: heroesInPool,
  })
  const counts = {}
  for (const ref of pool.flat()) counts[ref] = (counts[ref] ?? 0) + 1

  if (!heroesInPool) {
    for (const card of cards) {
      if (card.cardType === 'HERO') counts[card.reference] = (counts[card.reference] ?? 0) + 1
    }
  }

  return counts
}
