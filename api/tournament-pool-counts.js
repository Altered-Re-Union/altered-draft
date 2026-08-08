// Vercel serverless function — called by altered-core-decks-api's AlteredDraftSealedPoolClient
// for pool-membership validation (both at normal deck-save time and at BGA deck-content
// fetch time — see ROADMAP.md "Set 6 preview"). Resolves the same pool
// api/tournament-bga-decklist.js would (lazily binding `tournamentId` if present and
// not yet bound for this player), but returns just the card counts (plus the pool `id`)
// — decks-api runs its own hero/faction/count/pool-membership checks locally
// (SealedFormatValidator), this endpoint only needs to hand it the pool to check against.
// `id` lets decks-api remember which bound pool a sealed deck belongs to (see its Deck
// entity's `poolId`) and re-fetch it later via GET /api/tournament-pool?id=... for
// requests that don't carry a `tournamentId` (e.g. a third-party deckbuilder editing
// the deck through decks-api's generic save endpoint).
import { verifySub } from './_lib/auth.js'
import { getOrCreateNormalPool, bindTournamentId } from '../src/lib/poolStore.js'
import { regeneratePoolCounts } from './_lib/tournamentPool.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const tournamentId = (req.query?.tournamentId ?? new URL(req.url, 'http://x').searchParams.get('tournamentId') ?? '').trim()

  const pool = tournamentId
    ? await bindTournamentId(sub, tournamentId)
    : await getOrCreateNormalPool(sub)

  const cards = await regeneratePoolCounts(sub, pool)
  return res.status(200).json({ id: pool.id, cards })
}
