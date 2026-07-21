// Vercel serverless function — issues a pool seed for the tournament sealed mode.
// See ROADMAP.md "Set 6 preview" for the full anti-cheat design.
//
// Checks `now()` against the committed event config (src/lib/data/sealedEvents.json):
// inside an event's [starts_at, ends_at] window → a DETERMINISTIC seed bound to the
// verified Re:Union identity + that event, so relaunching never gives a different pool.
// Outside every window (including before an event starts) → a plain random seed, i.e.
// normal casual sealed — which also means there is no way to see the real tournament
// pool before the window opens.
import { verifySub } from './_lib/auth.js'
import { findActiveEvent } from '../src/lib/sealedEvents.js'
import { hashSeed } from '../src/lib/prng.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const event = findActiveEvent()
  if (!event) {
    const seed = Math.floor(Math.random() * 0xffffffff)
    return res.status(200).json({ seed, mode: 'casual' })
  }

  const seed = hashSeed(`${sub}|${event.starts_at}|${event.ends_at}`)
  return res.status(200).json({
    seed,
    mode: 'tournament',
    event: {
      eventKey: event.eventKey,
      name: event.name,
      setCode: event.setCode,
      uniqueCount: event.uniqueCount ?? 0,
      evenFactions: !!event.evenFactions,
    },
  })
}
