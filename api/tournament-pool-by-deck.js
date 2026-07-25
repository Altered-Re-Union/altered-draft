// Vercel serverless function — called by altered-core-decks-api's AlteredDraftSealedPoolClient
// for pool-membership validation, keyed by decks-api's own deck id rather than a
// `tournamentSeed`. See ROADMAP.md "Set 6 preview". This is what makes sealed
// validation work uniformly for every decks-api call site (BGA deck-content, a normal
// deck save, a third-party deckbuilder editing the deck) without decks-api needing to
// know or forward `tournamentSeed` at all — binding itself already happens elsewhere
// (api/tournament-bga-decklist.js, on the BGA deck-LIST call) and `deck_id` is stamped
// onto the pool row by the frontend's throttled sync (see TournamentPoolView.jsx),
// so by the time any real validation happens the link is already in place.
import { verifySub } from './_lib/auth.js'
import { getPoolByDeckId } from '../src/lib/poolStore.js'
import { regeneratePoolCounts, poolResponse } from './_lib/tournamentPool.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const deckId = (req.query?.deckId ?? new URL(req.url, 'http://x').searchParams.get('deckId') ?? '').trim()
  if (!deckId) return res.status(400).json({ error: 'invalid_request' })

  const pool = await getPoolByDeckId(sub, deckId)
  if (!pool) return res.status(404).json({ error: 'not_found' })

  const cards = await regeneratePoolCounts(sub, pool)
  return res.status(200).json(poolResponse(pool, cards))
}