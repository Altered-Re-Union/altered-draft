// Vercel serverless function — creates a draft/sealed room. Replaces the direct
// `supabase.from('draft_rooms').insert(...)` call so the frontend talks to our own
// Postgres regardless of deployment target (Vercel+Supabase's own Postgres, or
// self-hosted Docker+Postgres — see ROADMAP.md "Realtime"). No auth: the room code
// itself is the access control, same model as the original Supabase RLS policies
// ("sufficient for a room-code-gated app").
import { query } from '../../src/lib/db.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
  const { id, state } = body
  if (!id || typeof id !== 'string' || !state) {
    return res.status(400).json({ error: 'invalid_request' })
  }

  try {
    await query('INSERT INTO draft_rooms (id, state) VALUES ($1, $2)', [id, JSON.stringify(state)])
    return res.status(201).json({ id })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'room_already_exists' })
    console.error(err)
    return res.status(500).json({ error: 'internal_error' })
  }
}

function safeParse(s) { try { return JSON.parse(s || '{}') } catch { return {} } }
