import { getAccessToken } from './reunion.js'

// Frontend client for the new tournament sealed endpoints (api/tournament-*.js).
// See ROADMAP.md "Set 6 preview". Requires a Re:Union session — every call throws if
// logged out, same convention as decks.js.

async function authHeaders() {
  const token = await getAccessToken()
  if (!token) throw new Error('Not signed in to Re:Union. Reconnect your account.')
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

async function handle(res) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed (HTTP ${res.status}).`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export async function fetchNormalPool() {
  const res = await fetch('/api/tournament-normal-pool', { headers: await authHeaders() })
  return handle(res)
}

/** Throws with `.status === 429` and `.data.remainingMs` if the cooldown hasn't elapsed. */
export async function resetNormalPool() {
  const res = await fetch('/api/tournament-normal-pool', { method: 'POST', headers: await authHeaders() })
  return handle(res)
}

export async function fetchPrepPool() {
  const res = await fetch('/api/tournament-prep-pool', { headers: await authHeaders() })
  return handle(res)
}

export async function fetchBoundPools() {
  const res = await fetch('/api/tournament-bound-pools', { headers: await authHeaders() })
  return handle(res)
}

export async function fetchPoolById(id) {
  const res = await fetch(`/api/tournament-pool?id=${encodeURIComponent(id)}`, { headers: await authHeaders() })
  return handle(res)
}

/** Resolves a decks-api deck id to the caller's own sealed pool. 404s (via `handle`) if the
 * deck doesn't exist, isn't linked to any pool, or belongs to someone else. */
export async function fetchPoolByDeckId(deckId) {
  const res = await fetch(`/api/tournament-pool-by-deck?deckId=${encodeURIComponent(deckId)}`, { headers: await authHeaders() })
  return handle(res)
}

export async function syncPoolDeck(id, { deckId, name, heroRef, faction, cardQuantity }) {
  const res = await fetch(`/api/tournament-pool?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ deckId, name, heroRef, faction, cardQuantity }),
  })
  return handle(res)
}
