import events from './data/sealedEvents.json'

// Tournament event windows, committed to the repo (no external calendar API, no admin
// UI — see ROADMAP.md "Set 6 preview"). Each interval is meant to span the REAL BGA
// tournament with 1h padding on both sides: `starts_at` = 1h before the tournament's
// actual start (that hour is the deck-building window), `ends_at` = 1h after the
// tournament's actual end (so every in-tournament validate-deck call — one per BGA
// game — lands safely inside the interval). Shape:
//   {
//     "<eventKey>": {
//       "name": "Set 6 Prerelease — Wave 1",
//       "starts_at": "2026-08-01T09:00:00Z",   // ISO, always UTC
//       "ends_at":   "2026-08-01T17:00:00Z",
//       "setCode": "EOLE",
//       "uniqueCount": 3,
//       "evenFactions": true
//     }
//   }
// Adding/adjusting an event = edit this file + git push (Vercel redeploy).

/**
 * Returns the event active at `date` (server time — never trust a client-supplied
 * clock here), or null if none. Both /api/sealed-seed and /api/validate-deck call
 * this independently at request time: since every real validate-deck call happens
 * during a BGA game — always inside the padded interval — it re-finds the SAME event
 * and recomputes the SAME seed, with nothing to pass between the two calls.
 * @param {Date} [date]
 * @returns {{eventKey: string, name: string, starts_at: string, ends_at: string, setCode: string, uniqueCount: number, evenFactions: boolean} | null}
 */
export function findActiveEvent(date = new Date()) {
  const t = date.getTime()
  for (const [eventKey, event] of Object.entries(events)) {
    const start = Date.parse(event.starts_at)
    const end = Date.parse(event.ends_at)
    if (Number.isFinite(start) && Number.isFinite(end) && t >= start && t <= end) {
      return { eventKey, ...event }
    }
  }
  return null
}
