// The caller's pool for a declared tournament: get-or-create (spec §3.2, §6, §7).
// Creation is refused once the tournament is cancelled or ended; an EXISTING pool is
// always returned so players keep editing their deck.
import { verifyUser } from '../../_lib/auth.js'
import { getTournament } from '../../../src/lib/tournamentStore.js'
import { tournamentStatus, OPEN_STATUSES } from '../../../src/lib/tournamentRules.js'
import { getPoolForTournament, getOrCreateTournamentPool, countGamesPlayed } from '../../../src/lib/poolStore.js'
import { loadPool, poolResponse } from '../../_lib/tournamentPool.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const row = await getTournament(req.query?.id)
  if (!row) return res.status(404).json({ error: 'not_found' })

  const status = tournamentStatus(row)
  let pool = await getPoolForTournament(user.sub, row.id)
  if (!pool) {
    if (!OPEN_STATUSES.includes(status)) return res.status(409).json({ error: 'tournament_closed', status })
    try {
      pool = await getOrCreateTournamentPool(user.sub, row, { createdBy: 'page' })
    } catch (e) {
      // Detached / deleted between our read and the insert, or a lost race we couldn't settle.
      if (e.code === 'tournament_unavailable') return res.status(409).json({ error: 'tournament_closed', status: 'detached' })
      if (e.code === 'pool_unavailable') return res.status(409).json({ error: 'pool_unavailable' })
      throw e
    }
  }

  const { counts, boosters } = await loadPool(user.sub, pool)
  const gamesPlayed = await countGamesPlayed(pool.id)
  return res.status(200).json(poolResponse(pool, counts, boosters, gamesPlayed, {
    tournament: { id: row.id, name: row.name, status },
  }))
}
