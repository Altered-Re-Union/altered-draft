// Vercel serverless function — returns the caller's tournament sealed pool (as
// ref -> count) plus the active event's window, for trusted server-to-server callers
// that need to cache the pool themselves (e.g. altered-core-decks-api's Set 6 sealed
// deck format, which caches this until `event.ends_at` rather than calling
// /api/validate-deck on every save). See ROADMAP.md "Set 6 preview".
//
// Same trust model as /api/validate-deck: identity comes only from the verified
// Bearer token's `sub`, so a caller can only ever fetch their OWN pool — this exposes
// nothing the player couldn't already see in their own sealed UI.
import { verifySub } from './_lib/auth.js'
import { findActiveEvent } from '../src/lib/sealedEvents.js'
import { regeneratePoolCounts } from './_lib/tournamentPool.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const event = findActiveEvent()
  if (!event) return res.status(409).json({ error: 'no_active_event' })

  const pool = await regeneratePoolCounts(sub, event)
  return res.status(200).json({
    pool,
    event: {
      eventKey: event.eventKey,
      name: event.name,
      setCode: event.setCode,
      ends_at: event.ends_at,
    },
  })
}
