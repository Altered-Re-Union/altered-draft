// Vercel serverless function — a single bound tournament pool by id (button 3's detail
// view), scoped to its owner. GET returns the full card list + deck; POST updates the
// cached deck summary as the frontend's throttled decks-api sync progresses. See
// ROADMAP.md "Set 6 preview".
import { verifySub } from './_lib/auth.js'
import { getPoolById, updateDeckSummary, countGamesPlayed } from '../src/lib/poolStore.js'
import { regeneratePool, poolResponse } from './_lib/tournamentPool.js'

export default async function handler(req, res) {
  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const id = req.query?.id ?? new URL(req.url, 'http://x').searchParams.get('id')
  if (!id) return res.status(400).json({ error: 'invalid_request' })

  const pool = await getPoolById(sub, id)
  if (!pool) return res.status(404).json({ error: 'not_found' })

  if (req.method === 'GET') {
    const { counts, boosters } = await regeneratePool(sub, pool)
    const gamesPlayed = await countGamesPlayed(pool.id)
    return res.status(200).json(poolResponse(pool, counts, boosters, gamesPlayed))
  }

  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
    const updated = await updateDeckSummary(pool.id, {
      deckId: body.deckId,
      name: body.name,
      heroRef: body.heroRef,
      faction: body.faction,
      cardQuantity: body.cardQuantity,
    })
    // Include boosters so the frontend's `pool` state keeps its pack view after a deck sync.
    const { counts, boosters } = await regeneratePool(sub, updated)
    const gamesPlayed = await countGamesPlayed(updated.id)
    return res.status(200).json(poolResponse(updated, counts, boosters, gamesPlayed))
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'method_not_allowed' })
}

function safeParse(s) { try { return JSON.parse(s || '{}') } catch { return {} } }
