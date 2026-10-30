// Data access for user-created tournaments (docs/tournaments/user-tournaments-spec.md §4, §7).
// Server-side only. Status is never stored: see tournamentRules.js's tournamentStatus().
import { query, withTransaction } from './db.js'
import { tournamentStatus } from './tournamentRules.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Pools bound to the tournament's BGA id with no declared tournament (players already
// playing it with the generic format) are ADOPTED in the same statement as the INSERT /
// the link change: attached, renamed to the altered-draft name. The caller imposes their
// format on the tournament beforehand (spec §6, "declared after the fact").
// adopted_at marks them so a moderator's detach releases them instead of deleting them.
// A pool still attached to a DETACHED declaration of that BGA id (only possible through a
// race with the detach) is taken over the same way.
const ADOPT_LEGACY = (src) => `adopted AS (
       UPDATE sealed_pools p SET tournament_ref = ${src}.id, tournament_name = ${src}.name, adopted_at = now()
       FROM ${src}
       WHERE p.kind = 'tournament' AND p.tournament_id = ${src}.bga_tournament_id
         AND (p.tournament_ref IS NULL OR p.tournament_ref IN (SELECT id FROM tournaments WHERE detached_at IS NOT NULL))
       RETURNING 1
     )`

export async function createTournament({ name, description, bgaUrl, bgaTournamentId, startsAt, endsAt, organizerSub, organizerName, config }) {
  try {
    const { rows } = await query(
      `WITH t AS (
         INSERT INTO tournaments
           (name, description, bga_url, bga_tournament_id, starts_at, ends_at, organizer_sub, organizer_name, config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *
       ), ${ADOPT_LEGACY('t')}
       SELECT t.*, (SELECT count(*)::int FROM adopted) AS adopted_pools FROM t`,
      [name, description ?? '', bgaUrl, bgaTournamentId, startsAt, endsAt ?? null, organizerSub, organizerName, JSON.stringify(config)],
    )
    return rows[0]
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('a tournament already exists for this BGA tournament')
      err.code = 'bga_tournament_taken'
      throw err
    }
    throw e
  }
}

export async function getTournament(id) {
  if (!UUID_RE.test(String(id ?? ''))) return null
  const { rows } = await query('SELECT * FROM tournaments WHERE id = $1', [id])
  return rows[0] ?? null
}

/** The live (not detached) declaration of a BGA tournament — what the BGA path resolves to. */
export async function getTournamentByBgaId(bgaId) {
  const { rows } = await query('SELECT * FROM tournaments WHERE bga_tournament_id = $1 AND detached_at IS NULL', [String(bgaId)])
  return rows[0] ?? null
}

// "Open" = neither detached, cancelled nor ended (manually, or by a reached ends_at).
const OPEN_SQL = 'detached_at IS NULL AND cancelled_at IS NULL AND ended_at IS NULL AND (ends_at IS NULL OR ends_at > now())'

/** @param {'open'|'upcoming'|'ongoing'|'all'} status */
export async function listTournaments(status = 'open') {
  const where = status === 'all' ? 'TRUE'
    : status === 'upcoming' ? `${OPEN_SQL} AND starts_at > now()`
    : status === 'ongoing' ? `${OPEN_SQL} AND starts_at <= now()`
    : OPEN_SQL
  const { rows } = await query(`SELECT * FROM tournaments WHERE ${where} ORDER BY starts_at ASC, created_at ASC`)
  return rows
}

/** Every tournament `sub` organizes, whatever its status (detached included), most recent start first. */
export async function listTournamentsByOrganizer(sub) {
  const { rows } = await query('SELECT * FROM tournaments WHERE organizer_sub = $1 ORDER BY starts_at DESC, created_at DESC', [sub])
  return rows
}

export async function countOpenTournaments(sub) {
  const { rows } = await query(
    `SELECT count(*)::int AS count FROM tournaments WHERE organizer_sub = $1 AND ${OPEN_SQL}`,
    [sub],
  )
  return rows[0]?.count ?? 0
}

export async function countPoolsForTournament(id) {
  const { rows } = await query('SELECT count(*)::int AS count FROM sealed_pools WHERE tournament_ref = $1', [id])
  return rows[0]?.count ?? 0
}

const COLUMN_OF = {
  name: 'name',
  description: 'description',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  bgaUrl: 'bga_url',
  bgaTournamentId: 'bga_tournament_id',
  config: 'config',
  cancelledAt: 'cancelled_at',
  endedAt: 'ended_at',
}

/**
 * Partial update. With `requireUnlocked`, the UPDATE is conditioned on "no pool exists"
 * in the same statement, so a config/link change can't race a first pool creation.
 * @returns {Promise<object|null>} the updated row, or null when nothing matched
 */
export async function updateTournament(id, fields, { requireUnlocked = false } = {}) {
  const sets = ['updated_at = now()']
  const params = [id]
  for (const [key, column] of Object.entries(COLUMN_OF)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
    params.push(key === 'config' ? JSON.stringify(fields[key]) : fields[key])
    sets.push(`${column} = $${params.length}`)
  }
  // A link change also adopts the legacy pools of the new BGA id (see ADOPT_LEGACY).
  const adopt = Object.prototype.hasOwnProperty.call(fields, 'bgaTournamentId')
  const sql = adopt
    ? `WITH u AS (UPDATE tournaments SET ${sets.join(', ')} WHERE id = $1 RETURNING *), ${ADOPT_LEGACY('u')}
       SELECT u.*, (SELECT count(*)::int FROM adopted) AS adopted_pools FROM u`
    : `UPDATE tournaments SET ${sets.join(', ')} WHERE id = $1 RETURNING *`

  const run = async q => {
    // With requireUnlocked, lock the row FIRST, then check for pools in a later statement:
    // a first pool being inserted holds FOR SHARE on this row (poolStore.insertPool), so
    // either it committed and this check sees it, or it waits and then re-checks the new
    // config and refuses to insert. One statement with NOT EXISTS could not see it.
    if (requireUnlocked) {
      const locked = await q('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [id])
      if (!locked.rows[0]) return null
      const pools = await q('SELECT 1 FROM sealed_pools WHERE tournament_ref = $1 LIMIT 1', [id])
      if (pools.rows[0]) return null
    }
    const { rows } = await q(sql, params)
    // The altered-draft name is authoritative: attached pools carry it as tournament_name,
    // which every deck name derives from (TournamentPoolView sync, ensureDeck's reconcile).
    if (rows[0] && Object.prototype.hasOwnProperty.call(fields, 'name')) {
      await q('UPDATE sealed_pools SET tournament_name = $2 WHERE tournament_ref = $1', [id, rows[0].name])
    }
    return rows[0] ?? null
  }
  try {
    return requireUnlocked ? await withTransaction(run) : await run(query)
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('a tournament already exists for this BGA tournament')
      err.code = 'bga_tournament_taken'
      throw err
    }
    throw e
  }
}

/**
 * Moderator-only (spec §2, "squatting"). In one transaction, after locking the row (a pool
 * being inserted holds FOR SHARE on it, so it either committed before or sees the detach
 * and refuses): the pools it ADOPTED (players who were already playing that BGA
 * tournament) are released — back to unattached pools bound to that BGA id, adopted again
 * by the real organizer's declaration with their own format — and the pools created FOR
 * this declaration are deleted (their games cascade). The row stays as a trace; its BGA id
 * is free again (partial unique index) and the BGA path no longer resolves to it. Decks of
 * deleted pools are left orphaned on decks-api.
 * @returns {Promise<object|null>} the detached row with `deleted_pools` / `released_pools`, or null if not found / already detached
 */
export async function detachTournament(id) {
  return withTransaction(async q => {
    const locked = await q('SELECT id FROM tournaments WHERE id = $1 AND detached_at IS NULL FOR UPDATE', [id])
    if (!locked.rows[0]) return null
    const released = await q('UPDATE sealed_pools SET tournament_ref = NULL, adopted_at = NULL WHERE tournament_ref = $1 AND adopted_at IS NOT NULL', [id])
    const deleted = await q('DELETE FROM sealed_pools WHERE tournament_ref = $1', [id])
    const { rows } = await q('UPDATE tournaments SET detached_at = now(), updated_at = now() WHERE id = $1 RETURNING *', [id])
    return { ...rows[0], deleted_pools: deleted.rowCount, released_pools: released.rowCount }
  })
}

/** @returns {Promise<'deleted'|'has_pools'|'not_found'>} */
export async function deleteTournamentIfNoPools(id) {
  let rows
  try {
    ({ rows } = await query(
      'DELETE FROM tournaments WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM sealed_pools WHERE tournament_ref = $1) RETURNING id',
      [id],
    ))
  } catch (e) {
    // A first pool committed while this DELETE waited on the row: the FK refuses.
    if (e.code === '23503') return 'has_pools'
    throw e
  }
  if (rows[0]) return 'deleted'
  return (await getTournament(id)) ? 'has_pools' : 'not_found'
}

const iso = d => (d ? new Date(d).toISOString() : null)

/** API shape (spec §7). `extras` carries poolCount / locked / viewer / poolsByOrigin from the handler. */
export function toTournamentJson(row, extras = {}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    format: row.format,
    bgaUrl: row.bga_url,
    bgaTournamentId: row.bga_tournament_id,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    status: tournamentStatus(row),
    organizer: { name: row.organizer_name },
    config: row.config,
    cancelledAt: iso(row.cancelled_at),
    endedAt: iso(row.ended_at),
    detachedAt: iso(row.detached_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...extras,
  }
}
