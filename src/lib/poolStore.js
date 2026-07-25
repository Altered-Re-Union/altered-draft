// Data-access layer for the Set 6 preview tournament state (sealed-pools-schema.sql).
// See ROADMAP.md "Set 6 preview" for the design this implements: a "normal" pool (one
// per player, resettable with a cooldown), a "tournament" pool that starts pending
// (tournament_seed null) and gets bound exactly once (lazily, on first BGA lookup for a
// given seed), after which a fresh pending one becomes mintable again.
//
// No card list is ever stored: pool contents are always the deterministic output of the
// existing generateTournamentSealedPool() engine, fed by these columns via
// buildPoolSeedString() below.
import crypto from 'node:crypto'
import { query } from './db.js'

const RESET_COOLDOWN_MS = 30 * 60 * 1000

/** The most recently configured competitive format, or null if none set yet. */
export async function getActiveFormat() {
  const { rows } = await query(
    'SELECT * FROM current_format ORDER BY created_at DESC, id DESC LIMIT 1',
  )
  return rows[0] ?? null
}

function newNonce() {
  return crypto.randomUUID()
}

/** Builds the exact string fed into hashSeed() to derive a pool's seed. */
export function buildPoolSeedString(sub, pool) {
  const parts = [
    sub,
    pool.set_code,
    String(pool.unique_count),
    String(pool.even_factions),
    String(pool.heroes_in_pool),
    pool.nonce,
  ]
  if (pool.tournament_seed) parts.push(pool.tournament_seed)
  return parts.join('|')
}

async function insertPool(sub, kind, format) {
  const nonce = newNonce()
  const conflictClause = kind === 'normal'
    ? "ON CONFLICT (sub) WHERE kind = 'normal' DO NOTHING"
    : "ON CONFLICT (sub) WHERE kind = 'tournament' AND tournament_seed IS NULL DO NOTHING"
  const { rows } = await query(
    `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, nonce)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ${conflictClause}
     RETURNING *`,
    [sub, kind, format.set_code, format.unique_count, format.even_factions, format.heroes_in_pool, nonce],
  )
  return rows[0] ?? null
}

/** The player's single normal-mode pool, creating it (from the active format) if absent. */
export async function getOrCreateNormalPool(sub) {
  const { rows } = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'normal'",
    [sub],
  )
  if (rows[0]) return rows[0]

  const format = await getActiveFormat()
  if (!format) throw new Error('no active competitive format configured')

  const inserted = await insertPool(sub, 'normal', format)
  if (inserted) return inserted
  // Lost the insert race — someone else's concurrent request created it first.
  const retry = await query("SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'normal'", [sub])
  return retry.rows[0]
}

/**
 * Resets the player's normal-mode pool to a fresh nonce (re-snapshotting the current
 * active format), unless the 30-minute cooldown since the last reset hasn't elapsed.
 * Also returns the deck that WAS linked to it (if any), so the caller can delete it:
 * once its pool is gone, that deck can never be validated against anything again — no
 * point leaving it around as an orphan, and deleting it is what lets decks-api treat
 * "the pool linked to my deck id" as a stable, cacheable fact for as long as the deck
 * exists, instead of having to guess how long a normal-pool link stays valid.
 * @returns {Promise<{pool: object, previousDeckId: string|null} | {cooldownRemainingMs: number}>}
 */
export async function resetNormalPool(sub) {
  const pool = await getOrCreateNormalPool(sub)

  if (pool.reset_at) {
    const elapsed = Date.now() - new Date(pool.reset_at).getTime()
    if (elapsed < RESET_COOLDOWN_MS) {
      return { cooldownRemainingMs: RESET_COOLDOWN_MS - elapsed }
    }
  }

  const format = await getActiveFormat()
  if (!format) throw new Error('no active competitive format configured')

  const { rows } = await query(
    `UPDATE sealed_pools
     SET nonce = $2, set_code = $3, unique_count = $4, even_factions = $5, heroes_in_pool = $6,
         reset_at = now(), deck_id = NULL, deck_name = NULL, deck_hero_ref = NULL,
         deck_faction = NULL, deck_card_quantity = NULL
     WHERE id = $1
     RETURNING *`,
    [pool.id, newNonce(), format.set_code, format.unique_count, format.even_factions, format.heroes_in_pool],
  )
  return { pool: rows[0], previousDeckId: pool.deck_id ?? null }
}

/** The player's single pending (not yet bound) tournament pool, creating it if absent. */
export async function getOrCreatePreparationPool(sub) {
  const { rows } = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_seed IS NULL",
    [sub],
  )
  if (rows[0]) return rows[0]

  const format = await getActiveFormat()
  if (!format) throw new Error('no active competitive format configured')

  const inserted = await insertPool(sub, 'tournament', format)
  if (inserted) return inserted
  const retry = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_seed IS NULL",
    [sub],
  )
  return retry.rows[0]
}

/**
 * Binds `tournamentSeed` to the player's currently-pending preparation pool (first call
 * for a given (sub, tournamentSeed) pair only — idempotent on repeat calls, which is the
 * normal case since every BGA game inside the same tournament re-triggers this). Frees a
 * new preparation pool to be minted right after, since this row no longer matches the
 * "pending" partial index once bound.
 */
export async function bindTournamentSeed(sub, tournamentSeed) {
  const already = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_seed = $2",
    [sub, tournamentSeed],
  )
  if (already.rows[0]) return already.rows[0]

  const pending = await getOrCreatePreparationPool(sub)

  const { rows } = await query(
    `UPDATE sealed_pools SET tournament_seed = $2, bound_at = now()
     WHERE id = $1 AND tournament_seed IS NULL
     RETURNING *`,
    [pending.id, tournamentSeed],
  )
  if (rows[0]) return rows[0]

  // Lost the bind race to a concurrent request for the same seed — return its result.
  const retry = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_seed = $2",
    [sub, tournamentSeed],
  )
  return retry.rows[0]
}

/** Every bound tournament pool for a player, most recent first. */
export async function listBoundTournamentPools(sub) {
  const { rows } = await query(
    `SELECT * FROM sealed_pools
     WHERE sub = $1 AND kind = 'tournament' AND tournament_seed IS NOT NULL
     ORDER BY bound_at DESC`,
    [sub],
  )
  return rows
}

/** A single pool by id, scoped to its owner (never resolve a pool by id alone). */
export async function getPoolById(sub, id) {
  const { rows } = await query('SELECT * FROM sealed_pools WHERE id = $1 AND sub = $2', [id, sub])
  return rows[0] ?? null
}

/**
 * The pool currently linked to a given decks-api deck id, scoped to its owner. Used by
 * altered-core-decks-api's SealedFormatValidator to check pool membership for a deck
 * outside the BGA request flow (e.g. a third-party deckbuilder editing the deck through
 * decks-api's own generic save endpoint, which never carries a `tournamentSeed`) — the
 * deck id is something decks-api always has, regardless of caller, so this is a simpler
 * and more robust lookup key than threading `tournamentSeed` through every call site.
 * `deck_id` is stamped here by updateDeckSummary() as the frontend syncs the deck (see
 * TournamentPoolView.jsx), essentially immediately after the deck is first created —
 * well before any real validation (a BGA game load, or a non-draft save) can occur.
 */
export async function getPoolByDeckId(sub, deckId) {
  const { rows } = await query(
    'SELECT * FROM sealed_pools WHERE sub = $1 AND deck_id = $2 ORDER BY bound_at DESC NULLS LAST, created_at DESC LIMIT 1',
    [sub, deckId],
  )
  return rows[0] ?? null
}

/** Keeps the cached deck summary in sync as the frontend edits the deck (throttled). */
export async function updateDeckSummary(poolId, { deckId, name, heroRef, faction, cardQuantity }) {
  const { rows } = await query(
    `UPDATE sealed_pools
     SET deck_id = $2, deck_name = $3, deck_hero_ref = $4, deck_faction = $5, deck_card_quantity = $6
     WHERE id = $1
     RETURNING *`,
    [poolId, deckId, name ?? null, heroRef ?? null, faction ?? null, cardQuantity ?? null],
  )
  return rows[0] ?? null
}
