// Vercel serverless function — the player's pending (not yet bound) tournament
// preparation pool. See ROADMAP.md "Set 6 preview". No reset here by design — locked
// until it gets bound to a real tournament (via api/tournament-bga-decklist.js).
import { verifySub } from './_lib/auth.js'
import { getOrCreatePreparationPool } from '../src/lib/poolStore.js'
import { regeneratePool, poolResponse } from './_lib/tournamentPool.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const pool = await getOrCreatePreparationPool(sub)
  const { counts, boosters } = await regeneratePool(sub, pool)
  return res.status(200).json(poolResponse(pool, counts, boosters))
}
