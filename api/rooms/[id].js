// Vercel serverless function — get/update a single draft/sealed room by code. See
// api/rooms/index.js's header comment for why this replaces direct Supabase calls.
//
// PATCH body: { state } for an unconditional update (Lobby's "start the draft" writes),
// or { state, expectedVersion } for the optimistic-concurrency compare-and-swap Draft.jsx's
// doPick/doWinstonAction rely on (only commits if the row's current state->>version still
// equals expectedVersion — mirrors the old `.eq('state->>version', expectedVersion)` +
// `.select('id')` pattern: `updated` tells the caller whether the write actually landed).
import { query } from '../../src/lib/db.js'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'missing_id' })

  if (req.method === 'GET') {
    const { rows } = await query('SELECT state FROM draft_rooms WHERE id = $1', [id])
    if (!rows[0]) return res.status(404).json({ error: 'not_found' })
    return res.status(200).json({ state: rows[0].state })
  }

  if (req.method === 'PATCH') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
    const { state, expectedVersion } = body
    if (!state) return res.status(400).json({ error: 'invalid_request' })

    const { rows } = expectedVersion === undefined || expectedVersion === null
      ? await query('UPDATE draft_rooms SET state = $1 WHERE id = $2 RETURNING id', [JSON.stringify(state), id])
      : await query(
          "UPDATE draft_rooms SET state = $1 WHERE id = $2 AND state->>'version' = $3 RETURNING id",
          [JSON.stringify(state), id, String(expectedVersion)],
        )

    return res.status(200).json({ updated: rows.length > 0 })
  }

  res.setHeader('Allow', 'GET, PATCH')
  return res.status(405).json({ error: 'method_not_allowed' })
}

function safeParse(s) { try { return JSON.parse(s || '{}') } catch { return {} } }
