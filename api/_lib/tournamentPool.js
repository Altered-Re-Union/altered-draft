// Regenerates a tournament sealed pool from a sealed_pools row (poolStore.js) — the
// nonce/binding model, replacing the earlier time-window-based event lookup.
import { hashSeed, mulberry32 } from '../../src/lib/prng.js'
import { generateTournamentSealedPool } from '../../src/lib/packGenerator.js'
import { pickDeterministicUniques } from '../../src/lib/uniqueFactionRanges.js'
import { fetchSet } from '../../src/lib/cardData.js'
import { buildPoolSeedString } from '../../src/lib/poolStore.js'

/**
 * Regenerates the deterministic pool for a sealed_pools row. Returns both the flat
 * `counts` (ref -> count, incl. the appended heroes when `heroes_in_pool` is false, and the
 * `guaranteed_uniques` handed out outside the boosters) and the `boosters` (the 7 packs, 12
 * refs each, with the `unique_count` in-booster uniques already injected into rare slots —
 * NO heroes and NO guaranteed uniques, since those aren't opened in boosters). The booster
 * structure lets the frontend show a pack-by-pack view; the flat counts drive the full-pool
 * deckbuilder + validation.
 * @param {string} sub - verified Keycloak sub (must be the row's owner)
 * @param {object} poolRow - a row from sealed_pools
 * @returns {Promise<{ counts: Record<string, number>, boosters: string[][] }>}
 */
export async function regeneratePool(sub, poolRow) {
  const seedStr = buildPoolSeedString(sub, poolRow)
  const inBooster = poolRow.unique_count ?? 0       // uniques that replace a rare slot in a booster
  const outside = poolRow.guaranteed_uniques ?? 0   // extra uniques appended OUTSIDE the boosters
  // Draw every unique from one deterministic stream, then split: the first `inBooster` are
  // injected into rare slots, the rest are the guaranteed uniques handed out alongside the
  // boosters (like appended heroes). pickDeterministicUniques dedupes, so the two groups
  // never overlap.
  const allUniques = pickDeterministicUniques(poolRow.set_code, mulberry32(hashSeed(`${seedStr}#uniques`)), {
    uniqueCount: inBooster + outside,
    evenFactions: !!poolRow.even_factions,
  })
  const boosterUniques = allUniques.slice(0, inBooster)
  const outsideUniques = allUniques.slice(inBooster)

  const cards = await fetchSet(poolRow.set_code)
  const boosters = generateTournamentSealedPool(cards, mulberry32(hashSeed(seedStr)), {
    uniqueRefs: boosterUniques,
    includeHeroes: poolRow.heroes_in_pool,
  })
  const counts = {}
  for (const ref of boosters.flat()) counts[ref] = (counts[ref] ?? 0) + 1

  // Guaranteed uniques belong to the pool but to no specific booster (same treatment as the
  // appended heroes below) — they show up in the full pool, not in any pack-by-pack view.
  for (const ref of outsideUniques) counts[ref] = (counts[ref] ?? 0) + 1

  if (!poolRow.heroes_in_pool) {
    for (const card of cards) {
      if (card.cardType === 'HERO') counts[card.reference] = (counts[card.reference] ?? 0) + 1
    }
  }

  return { counts, boosters }
}

/** Backward-compatible: just the flat counts (used by the deck-validation / summary callers). */
export async function regeneratePoolCounts(sub, poolRow) {
  return (await regeneratePool(sub, poolRow)).counts
}

/**
 * Shapes a pool row + its regenerated cards into the response the frontend consumes.
 * Pass `boosters` (from regeneratePool) to expose the pack-by-pack structure; omit it for
 * callers that only need the flat pool (deck validation / summary updates).
 */
export function poolResponse(poolRow, cardCounts, boosters = null) {
  return {
    id: poolRow.id,
    kind: poolRow.kind,
    setCode: poolRow.set_code,
    tournamentSeed: poolRow.tournament_seed,
    boundAt: poolRow.bound_at,
    resetAt: poolRow.reset_at,
    cards: cardCounts,
    ...(boosters ? { boosters } : {}),
    deck: poolRow.deck_id
      ? {
          id: poolRow.deck_id,
          name: poolRow.deck_name,
          heroRef: poolRow.deck_hero_ref,
          faction: poolRow.deck_faction,
          cardQuantity: poolRow.deck_card_quantity,
        }
      : null,
  }
}
