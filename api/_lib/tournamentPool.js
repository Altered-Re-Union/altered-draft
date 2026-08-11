// Regenerates a tournament sealed pool from a sealed_pools row (poolStore.js) — the
// nonce/binding model, replacing the earlier time-window-based event lookup.
import { hashSeed, mulberry32 } from '../../src/lib/prng.js'
import { generateTournamentSealedPool } from '../../src/lib/packGenerator.js'
import { pickDeterministicUniques } from '../../src/lib/uniqueFactionRanges.js'
import { fetchSet, fetchUniques, isUniqueRef } from '../../src/lib/cardData.js'
import { buildPoolSeedString, updateDeckSummary } from '../../src/lib/poolStore.js'
import { buildRandomDeck } from '../../src/lib/randomDeck.js'

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
 * Card lookup (reference -> normalized card) for an arbitrary ref list drawn from a pool's
 * card counts. The base set covers everything except uniques, which get resolved
 * individually — mirrors TournamentPoolView.jsx's own pool-load cardMap build.
 */
async function buildCardMap(setCode, refs) {
  const cards = await fetchSet(setCode)
  const map = {}
  for (const c of cards) map[c.reference] = c
  const uniqueRefs = refs.filter(r => isUniqueRef(r) && !map[r])
  if (uniqueRefs.length) {
    const uCards = await fetchUniques(uniqueRefs)
    for (const c of uCards) map[c.reference] = c
  }
  return map
}

const DECKS_API = 'https://decks.alteredcore.org/api/decks'

function toDeckCards(refs) {
  const counts = {}
  for (const ref of refs) counts[ref] = (counts[ref] ?? 0) + 1
  return Object.entries(counts).map(([cardReference, quantity]) => ({
    cardReference, quantity: Math.max(1, Math.min(quantity, 99)),
  }))
}

/**
 * If `poolRow` has no linked deck yet (or one with zero cards), mints a random valid-shaped
 * deck from the pool's own cards, saves it via decks-api, and caches the summary onto the
 * pool row — so a BGA game that loads before the player has built anything still gets a
 * legal deck instead of none. The name is prefixed "Random " so the BGA-side integration
 * can flag it as unreviewed; any later edit through the app's own deckbuilder overwrites
 * the name (dropping the prefix) the next time it syncs via decks-api, since that sync
 * always recomputes the name from scratch.
 * @returns {Promise<object>} the pool row, updated if a deck was minted (unchanged otherwise)
 */
export async function ensureDeck(sub, poolRow, bearerToken) {
  if (poolRow.deck_id && poolRow.deck_card_quantity) return poolRow

  const { counts } = await regeneratePool(sub, poolRow)
  const cardMap = await buildCardMap(poolRow.set_code, Object.keys(counts))
  const deckCounts = buildRandomDeck(counts, cardMap)
  const refs = Object.entries(deckCounts).flatMap(([ref, qty]) => Array(qty).fill(ref))
  if (!refs.length) return poolRow // the pool itself is empty — nothing to build a deck from

  const heroRef = refs.find(r => cardMap[r]?.cardType === 'HERO') ?? null
  const faction = heroRef ? (cardMap[heroRef]?.faction ?? null) : null
  const name = `Random ${poolRow.set_code} sealed · ${new Date().toISOString().slice(0, 10)}`

  const res = await fetch(DECKS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, format: 'sealed', isDraft: false, isPublic: false, deckCards: toDeckCards(refs) }),
  })
  if (!res.ok) throw new Error(`Could not save the random deck (HTTP ${res.status}).`)
  const created = await res.json()

  return updateDeckSummary(poolRow.id, {
    deckId: created.id,
    name,
    heroRef,
    faction,
    cardQuantity: refs.length,
  })
}

/**
 * Shapes a pool row + its regenerated cards into the response the frontend consumes.
 * Pass `boosters` (from regeneratePool) to expose the pack-by-pack structure; omit it for
 * callers that only need the flat pool (deck validation / summary updates). Pass
 * `gamesPlayed` (from poolStore.js's countGamesPlayed) when the caller has already fetched
 * it; omitted callers just don't get the field, no extra query forced on every response.
 */
export function poolResponse(poolRow, cardCounts, boosters = null, gamesPlayed = null) {
  return {
    id: poolRow.id,
    kind: poolRow.kind,
    setCode: poolRow.set_code,
    tournamentId: poolRow.tournament_id,
    tournamentName: poolRow.tournament_name,
    boundAt: poolRow.bound_at,
    resetAt: poolRow.reset_at,
    cards: cardCounts,
    ...(boosters ? { boosters } : {}),
    ...(gamesPlayed !== null ? { gamesPlayed } : {}),
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
