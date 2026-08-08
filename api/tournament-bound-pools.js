// Vercel serverless function — lists the player's bound tournament pools, most recent
// first (button 3, "modifier mes decks sur les tournois en cours"). See ROADMAP.md
// "Set 6 preview". Lightweight summaries only — fetch api/tournament-pool.js?id=... for
// a specific pool's full card list.
import { verifySub } from './_lib/auth.js'
import { listBoundTournamentPools, countGamesPlayed } from '../src/lib/poolStore.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const pools = await listBoundTournamentPools(sub)
  const withGamesPlayed = await Promise.all(pools.map(async p => ({
    id: p.id,
    setCode: p.set_code,
    tournamentId: p.tournament_id,
    tournamentName: p.tournament_name,
    boundAt: p.bound_at,
    gamesPlayed: await countGamesPlayed(p.id),
    deck: p.deck_id
      ? { id: p.deck_id, name: p.deck_name, cardQuantity: p.deck_card_quantity }
      : null,
  })))
  return res.status(200).json({ pools: withGamesPlayed })
}
