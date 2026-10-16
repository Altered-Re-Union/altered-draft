// Data access for user-created tournaments (docs/tournaments/user-tournaments-spec.md §4, §7).
// Server-side only. Status is never stored: see tournamentRules.js's tournamentStatus().
import { query } from './db.js'
import { tournamentStatus } from './tournamentRules.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function createTournament({ name, description, bgaUrl, bgaTournamentId, startsAt, endsAt, organizerSub, organizerName, config }) {
  try {
    const { rows } = await query(
      `INSERT INTO tournaments
         (name, description, bga_url, bga_tournament_id, starts_at, ends_at, organizer_sub, organizer_name, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
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

export async function getTournamentByBgaId(bgaId) {
  const { rows } = await query('SELECT * FROM tournaments WHERE bga_tournament_id = $1', [String(bgaId)])
  return rows[0] ?? null
}

// "Open" = neither cancelled nor ended (manually, or by a reached ends_at).
const OPEN_SQL = 'cancelled_at IS NULL AND ended_at IS NULL AND (ends_at IS NULL OR ends_at > now())'

/** @param {'open'|'upcoming'|'ongoing'|'all'} status */
export async function listTournaments(status = 'open') {
  const where = status === 'all' ? 'TRUE'
    : status === 'upcoming' ? `${OPEN_SQL} AND starts_at > now()`
    : status === 'ongoing' ? `${OPEN_SQL} AND starts_at <= now()`
    : OPEN_SQL
  const { rows } = await query(`SELECT * FROM tournaments WHERE ${where} ORDER BY starts_at ASC, created_at ASC`)
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
  const lock = requireUnlocked ? 'AND NOT EXISTS (SELECT 1 FROM sealed_pools WHERE tournament_ref = $1)' : ''
  let rows
  try {
    ({ rows } = await query(
      `UPDATE tournaments SET ${sets.join(', ')} WHERE id = $1 ${lock} RETURNING *`,
      params,
    ))
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('a tournament already exists for this BGA tournament')
      err.code = 'bga_tournament_taken'
      throw err
    }
    throw e
  }
  // The altered-draft name is authoritative: attached pools carry it as tournament_name,
  // which every deck name derives from (TournamentPoolView sync, ensureDeck's reconcile).
  if (rows[0] && Object.prototype.hasOwnProperty.call(fields, 'name')) {
    await query('UPDATE sealed_pools SET tournament_name = $2 WHERE tournament_ref = $1', [id, rows[0].name])
  }
  return rows[0] ?? null
}

/** @returns {Promise<'deleted'|'has_pools'|'not_found'>} */
export async function deleteTournamentIfNoPools(id) {
  const { rows } = await query(
    'DELETE FROM tournaments WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM sealed_pools WHERE tournament_ref = $1) RETURNING id',
    [id],
  )
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
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...extras,
  }
}
