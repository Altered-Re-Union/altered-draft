// Vercel serverless function — lists the player's bound tournament pools, most recent
// first (button 3, "modifier mes decks sur les tournois en cours"). See ROADMAP.md
// "Set 6 preview". Lightweight summaries only — fetch api/tournament-pool.js?id=... for
// a specific pool's full card list. `pending` is the player's preparation pool for their
// next undeclared tournament when one exists (read only: the hub's CTA changes its label).
import { verifySub } from './_lib/auth.js'
import { listBoundTournamentPools, getPreparationPool, countGamesPlayed } from '../src/lib/poolStore.js'
import { tournamentStatus } from '../src/lib/tournamentRules.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const [pools, pending] = await Promise.all([listBoundTournamentPools(sub), getPreparationPool(sub)])
  const withGamesPlayed = await Promise.all(pools.map(async p => ({
    id: p.id,
    setCode: p.set_code,
    tournamentId: p.tournament_id,
    tournamentName: p.tournament_name,
    boundAt: p.bound_at,
    gamesPlayed: await countGamesPlayed(p.id),
    tournament: p.tournament_ref
      ? {
          id: p.tournament_ref,
          name: p.t_name,
          startsAt: p.t_starts_at,
          status: tournamentStatus({ starts_at: p.t_starts_at, ends_at: p.t_ends_at, cancelled_at: p.t_cancelled_at, ended_at: p.t_ended_at }),
        }
      : null,
    deck: p.deck_id
      ? { id: p.deck_id, name: p.deck_name, cardQuantity: p.deck_card_quantity }
      : null,
  })))
  return res.status(200).json({
    pools: withGamesPlayed,
    pending: pending
      ? { id: pending.id, deck: pending.deck_id ? { id: pending.deck_id, name: pending.deck_name, cardQuantity: pending.deck_card_quantity } : null }
      : null,
  })
}
