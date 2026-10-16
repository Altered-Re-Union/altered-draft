// Data-access layer for the Set 6 preview tournament state (sealed-pools-schema.sql).
// See ROADMAP.md "Set 6 preview" for the design this implements: a "normal" pool (one
// per player, resettable with a cooldown), a "tournament" pool that starts pending
// (tournament_id null) and gets bound exactly once (lazily, on first BGA lookup for a
// given tournament), after which a fresh pending one becomes mintable again.
//
// Pool contents are generated once by poolBuilder.js and stored on the row (cards +
// boosters). Rows created before storage existed keep being regenerated from their
// snapshot columns via buildPoolSeedString() (see api/_lib/tournamentPool.js loadPool).
import crypto from 'node:crypto'
import { query } from './db.js'
import { buildPool, buildPoolSeedString } from './poolBuilder.js'
import { configFromLegacyFormat, legacyColumnsFromConfig } from './tournamentConfig.js'
import { getTournamentByBgaId } from './tournamentStore.js'
// Re-exported: api/_lib/tournamentPool.js and the freeze script import it from here.
export { buildPoolSeedString }

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

/**
 * Generates the pool FIRST (poolBuilder), then inserts it in one statement. A card-data
 * failure throws before anything is written; a lost insert race (ON CONFLICT DO NOTHING)
 * returns null and the caller re-selects the winner. `tournament` (a tournaments row)
 * attaches the pool to a declared tournament: tournament_ref + tournament_id (its BGA id)
 * + tournament_name (the altered-draft name) + bound_at are all set at creation.
 */
async function insertPool(sub, kind, { config, tournament = null, createdBy = 'page' }) {
  const nonce = newNonce()
  const built = await buildPool(sub, { config, nonce })
  const cols = legacyColumnsFromConfig(config)
  const conflictClause = kind === 'normal'
    ? "ON CONFLICT (sub) WHERE kind = 'normal' DO NOTHING"
    : tournament
      ? 'ON CONFLICT (sub, tournament_ref) WHERE tournament_ref IS NOT NULL DO NOTHING'
      : "ON CONFLICT (sub) WHERE kind = 'tournament' AND tournament_id IS NULL DO NOTHING"
  const { rows } = await query(
    `INSERT INTO sealed_pools
       (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce,
        config, cards, boosters, created_by, tournament_ref, tournament_id, tournament_name, bound_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ${conflictClause}
     RETURNING *`,
    [
      sub, kind, cols.set_code, cols.unique_count, cols.even_factions, cols.heroes_in_pool, cols.guaranteed_uniques, nonce,
      JSON.stringify(config), JSON.stringify(built.cards), JSON.stringify(built.boosters), createdBy,
      tournament?.id ?? null, tournament?.bga_tournament_id ?? null, tournament?.name ?? null, tournament ? new Date() : null,
    ],
  )
  return rows[0] ?? null
}

/** The player's single normal-mode pool, creating it (from the active format) if absent. */
export async function getOrCreateNormalPool(sub, { createdBy = 'page' } = {}) {
  const { rows } = await query("SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'normal'", [sub])
  if (rows[0]) return rows[0]

  const format = await getActiveFormat()
  if (!format) throw new Error('no active competitive format configured')

  const inserted = await insertPool(sub, 'normal', { config: configFromLegacyFormat(format), createdBy })
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

  const config = configFromLegacyFormat(format)
  const nonce = newNonce()
  const built = await buildPool(sub, { config, nonce })
  const cols = legacyColumnsFromConfig(config)
  const { rows } = await query(
    `UPDATE sealed_pools
     SET nonce = $2, set_code = $3, unique_count = $4, even_factions = $5, heroes_in_pool = $6,
         guaranteed_uniques = $7, config = $8, cards = $9, boosters = $10,
         reset_at = now(), deck_id = NULL, deck_name = NULL, deck_hero_ref = NULL,
         deck_faction = NULL, deck_card_quantity = NULL
     WHERE id = $1
     RETURNING *`,
    [pool.id, nonce, cols.set_code, cols.unique_count, cols.even_factions, cols.heroes_in_pool, cols.guaranteed_uniques,
     JSON.stringify(config), JSON.stringify(built.cards), JSON.stringify(built.boosters)],
  )
  return { pool: rows[0], previousDeckId: pool.deck_id ?? null }
}

/** The player's single pending (not yet bound, not attached) tournament pool, creating it if absent. */
export async function getOrCreatePreparationPool(sub, { createdBy = 'page' } = {}) {
  const { rows } = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_id IS NULL",
    [sub],
  )
  if (rows[0]) return rows[0]

  const format = await getActiveFormat()
  if (!format) throw new Error('no active competitive format configured')

  const inserted = await insertPool(sub, 'tournament', { config: configFromLegacyFormat(format), createdBy })
  if (inserted) return inserted
  const retry = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_id IS NULL",
    [sub],
  )
  return retry.rows[0]
}

/** The caller's pool for a declared tournament, owner-scoped. */
export async function getPoolForTournament(sub, tournamentId) {
  const { rows } = await query('SELECT * FROM sealed_pools WHERE sub = $1 AND tournament_ref = $2', [sub, tournamentId])
  return rows[0] ?? null
}

/**
 * Get-or-create the player's pool for a declared tournament (spec §6). Order:
 *  1. an existing attached pool;
 *  2. a LEGACY pool already bound to the tournament's BGA id (the tournament was declared
 *     after BGA started binding) — adopted, never replaced: its deck is already in play;
 *  3. a fresh stored pool from the tournament's config.
 * Two unique indexes guard creation ((sub, tournament_ref) and (sub, tournament_id)); a
 * race can surface as ON CONFLICT DO NOTHING or as a 23505 from the other index. Both
 * mean "someone else's row won" — re-select it.
 */
export async function getOrCreateTournamentPool(sub, tournament, { createdBy = 'page' } = {}) {
  const existing = await getPoolForTournament(sub, tournament.id)
  if (existing) return existing

  const legacy = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_ref IS NULL AND tournament_id = $2",
    [sub, tournament.bga_tournament_id],
  )
  if (legacy.rows[0]) {
    const { rows } = await query(
      'UPDATE sealed_pools SET tournament_ref = $2 WHERE id = $1 AND tournament_ref IS NULL RETURNING *',
      [legacy.rows[0].id, tournament.id],
    )
    return rows[0] ?? getPoolForTournament(sub, tournament.id)
  }

  try {
    const inserted = await insertPool(sub, 'tournament', { config: tournament.config, tournament, createdBy })
    if (inserted) return inserted
  } catch (e) {
    if (e.code !== '23505') throw e
  }
  return getPoolForTournament(sub, tournament.id)
}

/**
 * Binds `tournamentId` to the player's currently-pending preparation pool (first call for
 * a given (sub, tournamentId) pair only — idempotent on repeat calls, which is the normal
 * case since every BGA game inside the same tournament re-triggers this). Frees a new
 * preparation pool to be minted right after, since this row no longer matches the
 * "pending" partial index once bound. `tournamentName` is informative only and is
 * refreshed on every call (unlike tournamentId, it isn't a one-shot commitment).
 */
export async function bindTournamentId(sub, tournamentId, tournamentName) {
  const already = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_id = $2",
    [sub, tournamentId],
  )
  if (already.rows[0]) {
    // Pools of a DECLARED tournament keep the altered-draft name; only legacy-bound rows
    // take BGA's (informative) name, refreshed on every call as before.
    if (tournamentName && !already.rows[0].tournament_ref) {
      const { rows } = await query(
        'UPDATE sealed_pools SET tournament_name = $2 WHERE id = $1 RETURNING *',
        [already.rows[0].id, tournamentName],
      )
      return rows[0]
    }
    return already.rows[0]
  }

  // A declared tournament for this BGA id (whatever its status — if BGA is playing it,
  // every player must get the same config) creates the player's pool from ITS config.
  const tournament = await getTournamentByBgaId(tournamentId)
  if (tournament) return getOrCreateTournamentPool(sub, tournament, { createdBy: 'bga' })

  const pending = await getOrCreatePreparationPool(sub, { createdBy: 'bga' })

  const { rows } = await query(
    `UPDATE sealed_pools SET tournament_id = $2, tournament_name = $3, bound_at = now()
     WHERE id = $1 AND tournament_id IS NULL
     RETURNING *`,
    [pending.id, tournamentId, tournamentName ?? null],
  )
  if (rows[0]) return rows[0]

  // Lost the bind race to a concurrent request for the same tournament — return its result.
  const retry = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_id = $2",
    [sub, tournamentId],
  )
  return retry.rows[0]
}

/** Every bound tournament pool for a player (legacy-bound and declared), most recent first. */
export async function listBoundTournamentPools(sub) {
  const { rows } = await query(
    `SELECT p.*,
            t.name AS t_name, t.starts_at AS t_starts_at, t.ends_at AS t_ends_at,
            t.cancelled_at AS t_cancelled_at, t.ended_at AS t_ended_at
     FROM sealed_pools p
     LEFT JOIN tournaments t ON t.id = p.tournament_ref
     WHERE p.sub = $1 AND p.kind = 'tournament' AND p.tournament_id IS NOT NULL
     ORDER BY p.bound_at DESC`,
    [sub],
  )
  return rows
}

/** Records that `gameId` has been played against `poolId` (deduped, see schema). */
export async function recordGamePlayed(poolId, gameId) {
  await query(
    'INSERT INTO sealed_pool_games (pool_id, game_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [poolId, gameId],
  )
}

/** Count of distinct games played against a pool. */
export async function countGamesPlayed(poolId) {
  const { rows } = await query(
    'SELECT count(*)::int AS count FROM sealed_pool_games WHERE pool_id = $1',
    [poolId],
  )
  return rows[0]?.count ?? 0
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
 * decks-api's own generic save endpoint, which never carries a `tournamentId`) — the
 * deck id is something decks-api always has, regardless of caller, so this is a simpler
 * and more robust lookup key than threading `tournamentId` through every call site.
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

/** Pool count per tournament id, for the public list. Missing ids are absent (treat as 0). */
export async function countPoolsByTournament(ids) {
  if (!ids.length) return {}
  const { rows } = await query(
    'SELECT tournament_ref, count(*)::int AS count FROM sealed_pools WHERE tournament_ref = ANY($1) GROUP BY tournament_ref',
    [ids],
  )
  return Object.fromEntries(rows.map(r => [r.tournament_ref, r.count]))
}

/** How a tournament's pools were created — 'bga' = minted by a BGA deck-list call. */
export async function countPoolsByOrigin(tournamentId) {
  const { rows } = await query(
    'SELECT created_by, count(*)::int AS count FROM sealed_pools WHERE tournament_ref = $1 GROUP BY created_by',
    [tournamentId],
  )
  const out = { page: 0, bga: 0, legacy: 0 }
  for (const r of rows) out[r.created_by ?? 'legacy'] = (out[r.created_by ?? 'legacy'] ?? 0) + r.count
  return out
}

/** The caller's pools for several tournaments at once (list view): id + deck summary. */
export async function poolSummariesForTournaments(sub, ids) {
  if (!ids.length) return {}
  const { rows } = await query(
    'SELECT id, tournament_ref, deck_name, deck_card_quantity FROM sealed_pools WHERE sub = $1 AND tournament_ref = ANY($2)',
    [sub, ids],
  )
  return Object.fromEntries(rows.map(r => [r.tournament_ref, { id: r.id, deckName: r.deck_name, deckCardQuantity: r.deck_card_quantity }]))
}
