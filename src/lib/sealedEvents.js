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
//       "evenFactions": true,
//       "heroesInPool": false
//     }
//   }
// Adding/adjusting an event = edit this file + git push (Vercel redeploy).
//
// `heroesInPool` — either heroes are drafted into the pool like any other card
// (true, the default when omitted), or they're excluded from the random pool
// entirely and EVERY hero of the set is instead added to the pool afterward, not as
// a possible drafted card but just guaranteed present (see
// api/_lib/tournamentPool.js's regeneratePoolCounts). Set 6 sealed uses `false`: any
// hero should be legal without needing a special "any set-N hero" exemption on the
// consuming side (e.g. altered-core-decks-api's format validators) — a hero is just
// another pool ref like everything else.

/**
 * Returns the event active at `date` (server time — never trust a client-supplied
 * clock here), or null if none. Both /api/sealed-seed and /api/validate-deck call
 * this independently at request time: since every real validate-deck call happens
 * during a BGA game — always inside the padded interval — it re-finds the SAME event
 * and recomputes the SAME seed, with nothing to pass between the two calls.
 * @param {Date} [date]
 * @returns {{eventKey: string, name: string, starts_at: string, ends_at: string, setCode: string, uniqueCount: number, evenFactions: boolean, heroesInPool?: boolean} | null}
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
