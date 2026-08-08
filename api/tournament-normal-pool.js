// Vercel serverless function — the player's single casual (non-tournament) sealed pool.
// See ROADMAP.md "Set 6 preview". GET gets-or-creates it; POST resets it (30-minute
// cooldown between resets, enforced in poolStore.js).
import { verifySub } from './_lib/auth.js'
import { getOrCreateNormalPool, resetNormalPool, countGamesPlayed } from '../src/lib/poolStore.js'
import { regeneratePool, poolResponse } from './_lib/tournamentPool.js'

const DECKS_API = 'https://decks.alteredcore.org/api/decks'

// Best-effort: a reset pool can never validate its old deck again anyway (deck_id is
// already cleared), so a failed delete here just leaves an orphaned deck behind rather
// than breaking the reset itself.
async function deleteDeck(deckId, auth) {
  try {
    await fetch(`${DECKS_API}/${encodeURIComponent(deckId)}`, { method: 'DELETE', headers: { Authorization: auth } })
  } catch {
    // ignored — see comment above
  }
}

export default async function handler(req, res) {
  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  if (req.method === 'GET') {
    const pool = await getOrCreateNormalPool(sub)
    const { counts, boosters } = await regeneratePool(sub, pool)
    const gamesPlayed = await countGamesPlayed(pool.id)
    return res.status(200).json(poolResponse(pool, counts, boosters, gamesPlayed))
  }

  if (req.method === 'POST') {
    const result = await resetNormalPool(sub)
    if ('cooldownRemainingMs' in result) {
      return res.status(429).json({ error: 'cooldown', remainingMs: result.cooldownRemainingMs })
    }
    if (result.previousDeckId) {
      await deleteDeck(result.previousDeckId, req.headers.authorization)
    }
    const { counts, boosters } = await regeneratePool(sub, result.pool)
    const gamesPlayed = await countGamesPlayed(result.pool.id)
    return res.status(200).json(poolResponse(result.pool, counts, boosters, gamesPlayed))
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'method_not_allowed' })
}
