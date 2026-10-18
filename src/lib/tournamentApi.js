import { getAccessToken } from './reunion.js'

// Frontend client for the new tournament sealed endpoints (api/tournament-*.js).
// See ROADMAP.md "Set 6 preview". Requires a Re:Union session — every call throws if
// logged out, same convention as decks.js — except the public tournament reads
// (listTournaments, getTournament), which work anonymously.

async function authHeaders() {
  const token = await getAccessToken()
  if (!token) throw new Error('Not signed in to Re:Union. Reconnect your account.')
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

// Public endpoints accept an optional bearer (it only adds the `viewer` block): attach
// one when a session exists, never fail when logged out.
async function optionalAuthHeaders() {
  try {
    const token = await getAccessToken()
    return token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' }
  } catch {
    return { Accept: 'application/json' }
  }
}

async function handle(res) {
  if (res.status === 204) return {}
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

// ---- User-created tournaments (api/tournaments/*) ---------------------------------

/** @param {'open'|'upcoming'|'ongoing'|'all'} status */
export async function listTournaments(status = 'open') {
  const res = await fetch(`/api/tournaments?status=${encodeURIComponent(status)}`, { headers: await optionalAuthHeaders() })
  return handle(res)
}

/** The tournaments the caller organizes, every status. Requires a session. */
export async function listMyTournaments() {
  const res = await fetch('/api/tournaments?mine=1', { headers: await authHeaders() })
  return handle(res)
}

/** The live declaration of a BGA tournament id (whatever its status), or null. Public. */
export async function findTournamentByBgaId(bgaId) {
  const res = await fetch(`/api/tournaments?bgaId=${encodeURIComponent(bgaId)}`, { headers: await optionalAuthHeaders() })
  return (await handle(res)).tournaments?.[0] ?? null
}

export async function getTournament(id) {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}`, { headers: await optionalAuthHeaders() })
  return handle(res)
}

export async function createTournament(body) {
  const res = await fetch('/api/tournaments', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle(res)
}

/** Partial update, or `{ action: 'cancel'|'restore'|'close'|'reopen' }`. */
export async function updateTournament(id, body) {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle(res)
}

export async function deleteTournament(id) {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() })
  return handle(res)
}

/** Get-or-create the caller's pool for a tournament. 409 `tournament_closed` when creation is no longer allowed. */
export async function fetchTournamentPool(id) {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}/pool`, { headers: await authHeaders() })
  return handle(res)
}
