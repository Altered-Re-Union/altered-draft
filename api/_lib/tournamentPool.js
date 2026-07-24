// Regenerates a tournament sealed pool from a sealed_pools row (poolStore.js) — the
// nonce/binding model, replacing the earlier time-window-based event lookup.
import { hashSeed, mulberry32 } from '../../src/lib/prng.js'
import { generateTournamentSealedPool } from '../../src/lib/packGenerator.js'
import { pickDeterministicUniques } from '../../src/lib/uniqueFactionRanges.js'
import { fetchSet } from '../../src/lib/cardData.js'
import { buildPoolSeedString } from '../../src/lib/poolStore.js'

/**
 * Regenerates the deterministic pool for a sealed_pools row and returns it as ref -> count.
 * @param {string} sub - verified Keycloak sub (must be the row's owner)
 * @param {object} poolRow - a row from sealed_pools
 * @returns {Promise<Record<string, number>>}
 */
export async function regeneratePoolCounts(sub, poolRow) {
  const seedStr = buildPoolSeedString(sub, poolRow)
  const uniqueRefs = pickDeterministicUniques(poolRow.set_code, mulberry32(hashSeed(`${seedStr}#uniques`)), {
    uniqueCount: poolRow.unique_count ?? 0,
    evenFactions: !!poolRow.even_factions,
  })
  const cards = await fetchSet(poolRow.set_code)
  const pool = generateTournamentSealedPool(cards, mulberry32(hashSeed(seedStr)), {
    uniqueRefs,
    includeHeroes: poolRow.heroes_in_pool,
  })
  const counts = {}
  for (const ref of pool.flat()) counts[ref] = (counts[ref] ?? 0) + 1

  if (!poolRow.heroes_in_pool) {
    for (const card of cards) {
      if (card.cardType === 'HERO') counts[card.reference] = (counts[card.reference] ?? 0) + 1
    }
  }

  return counts
}

/** Shapes a pool row + its regenerated cards into the response the frontend consumes. */
export function poolResponse(poolRow, cardCounts) {
  return {
    id: poolRow.id,
    kind: poolRow.kind,
    setCode: poolRow.set_code,
    tournamentSeed: poolRow.tournament_seed,
    boundAt: poolRow.bound_at,
    resetAt: poolRow.reset_at,
    cards: cardCounts,
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
