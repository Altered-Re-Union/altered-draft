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

// Same shape as decks.js's deckCardsToRefs (frontend) — duplicated here rather than
// imported, since that module pulls in browser-only auth code (reunion.js).
function deckCardsToRefs(deck) {
  const cards = deck?.deckCards ?? deck?.cards ?? []
  const refs = []
  for (const c of cards) {
    const ref = String(c.cardReference ?? c.reference ?? '').toUpperCase()
    const qty = Math.max(1, parseInt(c.quantity ?? 1, 10) || 1)
    if (ref) for (let i = 0; i < qty; i++) refs.push(ref)
  }
  return refs
}

// "Invalid " is the literal token the BGA-side integration matches on (see
// TournamentPoolView.jsx, whose throttled sync enforces this same rule + prefix on every
// app-side edit).
const INVALID_PREFIX = 'Invalid '
// Flags an unreviewed auto-built deck (see ensureDeck below); stripped/dropped the moment
// the player makes their own edit, since TournamentPoolView.jsx's sync never adds it back.
const RANDOM_PREFIX = 'Random '

// The base deck name (no date, no prefix) always tracks the tournament this pool is/will be
// bound to — the real tournament name once bound (see poolStore.js's bindTournamentId),
// else a generic placeholder for the still-pending preparation pool or the out-of-tournament
// normal pool. Fixed English (no user locale available on this backend-only path) — mirrors
// TournamentPoolView.jsx's own fallback strings, which recompute the same name from the
// player's own sync and take over as soon as they touch their deck.
function baseDeckName(poolRow) {
  if (poolRow.kind === 'tournament') return poolRow.tournament_name || 'Next tournament sealed set 6'
  return 'Sealed set 6 · out of tournament'
}

function isSealedValid(refs, cardMap) {
  const heroCount = refs.filter(r => cardMap[r]?.cardType === 'HERO').length
  const factions = new Set(refs.map(r => cardMap[r]?.faction).filter(Boolean))
  return refs.length >= 30 && factions.size <= 3 && heroCount <= 1
}

async function patchDeck(deckId, bearerToken, body) {
  const res = await fetch(`${DECKS_API}/${encodeURIComponent(deckId)}`, {
    method: 'PATCH',
    // decks-api's api_platform.yaml restricts PATCH to application/merge-patch+json
    // (patch_formats) — application/json here gets rejected outright.
    headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json', 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Could not update deck ${deckId} (HTTP ${res.status}).`)
  return res.json()
}

/**
 * Whether `poolRow.deck_id` still exists on decks-api — and, if it does, reconciles it back
 * onto the rules the app's own sync enforces (TournamentPoolView.jsx): a deck edited
 * out-of-band (directly through decks-api, or a third-party deckbuilder) can drift from
 * both `format` and the isDraft/"Invalid " convention with no signal to invalidate the
 * cached summary on `sealed_pools`, so this always re-derives from the deck's live card
 * list rather than trusting the cache:
 *  - `format` is forced back to `'sealed'` whenever it's anything else.
 *  - the deck's actual legality (>=30 cards, <=3 factions, <=1 hero) drives BOTH `isDraft`
 *    (invalid -> draft, valid -> off draft) and the "Invalid " name prefix (added/stripped
 *    to match), regardless of whatever isDraft/name it walked in with.
 *  - the base name itself is always re-derived from the pool (see baseDeckName below), not
 *    trusted from the deck, so a prep pool getting bound to a real tournament renames its
 *    already-minted deck too.
 * Any reconciling PATCH is written to decks-api immediately, and the pool's cached summary
 * is refreshed to match so later responses (built from the cache, not a live fetch) don't
 * serve the stale name. Returns the (possibly refreshed) pool row, or `null` if the deck is
 * definitively gone (404) — non-404 failures (network hiccup, decks-api outage, an expired
 * bearer token) are NOT treated as "gone", so a transient error can't wipe a perfectly good
 * cached deck.
 */
async function deckStillExists(poolRow, bearerToken) {
  const deckId = poolRow.deck_id
  const res = await fetch(`${DECKS_API}/${encodeURIComponent(deckId)}`, {
    headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json' },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Could not verify deck ${deckId} (HTTP ${res.status}).`)
  const deck = await res.json()

  const refs = deckCardsToRefs(deck)
  const cardMap = await buildCardMap(poolRow.set_code, refs)
  const valid = isSealedValid(refs, cardMap)
  // Always re-derive the base name from the pool itself (tournament name / placeholder),
  // not from whatever's currently on the deck — so a pool binding to a real tournament (or
  // the tournament's name changing) renames an already-minted deck the next time BGA loads
  // it, same as any other drift this function reconciles. Only the "still unreviewed"
  // Random flag is read off the existing name, since nothing else records that state.
  const isRandom = deck.name?.startsWith(RANDOM_PREFIX) ?? false
  const base = baseDeckName(poolRow)
  const desiredName = isRandom ? `${RANDOM_PREFIX}${base}` : (valid ? base : `${INVALID_PREFIX}${base}`)

  const patch = {}
  if (deck.format !== 'sealed') patch.format = 'sealed'
  if (deck.isDraft !== !valid) patch.isDraft = !valid
  if (deck.name !== desiredName) patch.name = desiredName
  if (!Object.keys(patch).length) return poolRow

  try {
    await patchDeck(deckId, bearerToken, patch)
  } catch (e) {
    console.log(`deckStillExists: could not reconcile deck ${deckId}: ${e?.message}`)
    return poolRow
  }

  const heroRef = refs.find(r => cardMap[r]?.cardType === 'HERO') ?? null
  const faction = heroRef ? (cardMap[heroRef]?.faction ?? null) : null
  const updated = await updateDeckSummary(poolRow.id, {
    deckId, name: desiredName, heroRef, faction, cardQuantity: refs.length,
  })
  return updated ?? poolRow
}

/**
 * If `poolRow` has no linked deck yet (or one with zero cards, or one that's since been
 * deleted/edited away on decks-api directly), mints a random valid-shaped deck from the
 * pool's own cards, saves it via decks-api, and caches the summary onto the pool row — so a
 * BGA game that loads before the player has built anything still gets a legal deck instead
 * of none (or a dead deck id that 404s when BGA fetches its content). The name is prefixed
 * "Random " so the BGA-side integration can flag it as unreviewed; any later edit through
 * the app's own deckbuilder overwrites the name (dropping the prefix) the next time it
 * syncs via decks-api, since that sync always recomputes the name from scratch.
 * @returns {Promise<object>} the pool row, updated if a deck was minted (unchanged otherwise)
 */
export async function ensureDeck(sub, poolRow, bearerToken) {
  if (poolRow.deck_id && poolRow.deck_card_quantity) {
    try {
      const reconciled = await deckStillExists(poolRow, bearerToken)
      if (reconciled) return reconciled
      console.log(`ensureDeck: cached deck ${poolRow.deck_id} for pool ${poolRow.id} no longer exists — reminting`)
    } catch (e) {
      console.log(`ensureDeck: existence check failed for deck ${poolRow.deck_id}, trusting cache: ${e?.message}`)
      return poolRow
    }
  }

  const { counts } = await regeneratePool(sub, poolRow)
  const cardMap = await buildCardMap(poolRow.set_code, Object.keys(counts))
  const deckCounts = buildRandomDeck(counts, cardMap)
  const refs = Object.entries(deckCounts).flatMap(([ref, qty]) => Array(qty).fill(ref))
  if (!refs.length) return poolRow // the pool itself is empty — nothing to build a deck from

  const heroRef = refs.find(r => cardMap[r]?.cardType === 'HERO') ?? null
  const faction = heroRef ? (cardMap[heroRef]?.faction ?? null) : null
  const name = `${RANDOM_PREFIX}${baseDeckName(poolRow)}`

  // Create as a DRAFT first. decks-api's SealedFormatValidator only runs when isDraft is
  // false, and it validates pool membership by calling BACK into altered-draft's own
  // /api/tournament-pool-by-deck — for a brand-new deck id, that link doesn't exist on our
  // side yet (we only write it below, via updateDeckSummary). Validating with isDraft:false
  // right away would always fail that first check, and decks-api CACHES the failure for
  // 30s keyed by deck id — so even an immediate retry on the same deck would still read as
  // invalid. isDraft:true skips validation entirely on creation, sidestepping the race.
  const res = await fetch(DECKS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, format: 'sealed', isDraft: true, isPublic: false, deckCards: toDeckCards(refs) }),
  })
  if (!res.ok) throw new Error(`Could not save the random deck (HTTP ${res.status}).`)
  const created = await res.json()

  const updated = await updateDeckSummary(poolRow.id, {
    deckId: created.id,
    name,
    heroRef,
    faction,
    cardQuantity: refs.length,
  })

  // Now that the pool<->deck link exists on our side, flip it off draft — decks-api
  // re-validates on this PATCH, and this time the pool-membership lookup succeeds and
  // caches a good result instead of the earlier failure.
  const patchRes = await fetch(`${DECKS_API}/${encodeURIComponent(created.id)}`, {
    method: 'PATCH',
    // decks-api's api_platform.yaml restricts PATCH to application/merge-patch+json
    // (patch_formats) — application/json here gets rejected outright.
    headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json', 'Content-Type': 'application/merge-patch+json' },
    body: JSON.stringify({ isDraft: false }),
  })
  if (!patchRes.ok) {
    console.log(`ensureDeck: could not flip deck ${created.id} off draft (HTTP ${patchRes.status})`)
  }

  return updated
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
