// Vercel serverless function — the player's single casual (non-tournament) sealed pool.
// See ROADMAP.md "Set 6 preview". GET gets-or-creates it; POST resets it (30-minute
// cooldown between resets, enforced in poolStore.js).
import { verifySub } from './_lib/auth.js'
import { getOrCreateNormalPool, resetNormalPool } from '../src/lib/poolStore.js'
import { regeneratePoolCounts, poolResponse } from './_lib/tournamentPool.js'

export default async function handler(req, res) {
  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  if (req.method === 'GET') {
    const pool = await getOrCreateNormalPool(sub)
    const cards = await regeneratePoolCounts(sub, pool)
    return res.status(200).json(poolResponse(pool, cards))
  }

  if (req.method === 'POST') {
    const result = await resetNormalPool(sub)
    if ('cooldownRemainingMs' in result) {
      return res.status(429).json({ error: 'cooldown', remainingMs: result.cooldownRemainingMs })
    }
    const cards = await regeneratePoolCounts(sub, result.pool)
    return res.status(200).json(poolResponse(result.pool, cards))
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'method_not_allowed' })
}
