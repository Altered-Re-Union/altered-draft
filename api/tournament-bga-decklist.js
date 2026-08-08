// Vercel serverless function — called DIRECTLY by altered-bga-api (not decks-api) for
// the sealed-format deck-LIST call, bypassing decks-api entirely for this one. See
// ROADMAP.md "Set 6 preview". Returns the exact hydra:member/hydra:totalItems/hydra:view
// shape altered-core-decks-api's BgaDeckController::collection() normally returns, so
// altered-bga-api can relay it to BGA verbatim.
//
// `tournamentId` absent -> normal (casual) mode: the player's single normal pool.
// `tournamentId` present -> lazily binds it (+ `tournamentName`, informative only) to the
// player's pending preparation pool (idempotent — every game inside the same tournament
// re-triggers this and gets the same binding back) and returns THAT pool's deck.
// `gameId`, when present, records one play of this pool for the "games played with this
// deck" counter (see poolStore.js's recordGamePlayed/countGamesPlayed) -- a side effect
// only, it never changes this response's shape.
//
// Auth: altered-bga-api forwards whatever Authorization header BGA itself sent, same
// bearer-token verification as every other endpoint here.
import { verifySub } from './_lib/auth.js'
import { getOrCreateNormalPool, bindTournamentId, recordGamePlayed } from '../src/lib/poolStore.js'

function queryParam(req, name) {
  return (req.query?.[name] ?? new URL(req.url, 'http://x').searchParams.get(name) ?? '').trim()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const tournamentId = queryParam(req, 'tournamentId')
  const tournamentName = queryParam(req, 'tournamentName')
  const gameId = queryParam(req, 'gameId')

  const pool = tournamentId
    ? await bindTournamentId(sub, tournamentId, tournamentName || null)
    : await getOrCreateNormalPool(sub)

  if (gameId) {
    await recordGamePlayed(pool.id, gameId)
  }

  const member = pool.deck_id
    ? [{
        alterator: { reference: pool.deck_hero_ref },
        faction: { reference: pool.deck_faction },
        id: pool.deck_id,
        name: pool.deck_name,
        cardQuantity: pool.deck_card_quantity ?? 0,
        format: 'sealed',
      }]
    : []

  return res.status(200).json({
    'hydra:member': member,
    'hydra:totalItems': member.length,
    'hydra:view': { '@id': req.url, '@type': 'hydra:PartialCollectionView' },
  })
}
