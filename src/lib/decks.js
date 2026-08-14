import { getAccessToken } from './reunion.js'

// Frontend client for the Re:Union decks API, via our same-origin Vercel proxy
// (`/api/decks…`) — the real API has no browser CORS. Every call carries the user's
// bearer token. See api/decks/* for the proxy.

async function authHeaders() {
  const token = await getAccessToken()
  if (!token) throw new Error('Not signed in to Re:Union. Reconnect your account.')
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' }
}

// A 401/403 from the decks API almost always means the access token expired or was
// revoked — surface a reconnect hint rather than a bare status code.
function authError(status) {
  return status === 401 || status === 403
    ? 'Your Re:Union session expired. Reconnect and try again.'
    : null
}

// The authenticated user's decks (summaries). Fetches the whole list (the API paginates
// at 20/page by default) sorted by name, and unwraps the various envelope shapes.
// Each summary carries: id, name, format, isDraft, isPublic, createdAt… (no card list —
// that's only on the per-deck detail endpoint).
// Attaches `.status` to the thrown error (mirrors tournamentApi.js's `handle()`) so callers
// can branch on e.g. a 404 (deck deleted server-side) without parsing the message string.
function statusError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

export async function listDecks(params = {}) {
  const qs = new URLSearchParams({ itemsPerPage: '1000', 'order[name]': 'asc', ...params }).toString()
  const res = await fetch(`/api/decks?${qs}`, { headers: await authHeaders() })
  if (!res.ok) throw statusError(res.status, authError(res.status) || `Could not load your decks (HTTP ${res.status}).`)
  const data = await res.json()
  for (const key of ['member', 'hydra:member', 'items', 'decks', 'data']) {
    if (Array.isArray(data?.[key])) return data[key]
  }
  return Array.isArray(data) ? data : []
}

// Full deck detail (incl. deckCards) for one id.
export async function getDeck(id) {
  const res = await fetch(`/api/decks/${encodeURIComponent(id)}`, { headers: await authHeaders() })
  if (!res.ok) throw statusError(res.status, authError(res.status) || `Could not load that deck (HTTP ${res.status}).`)
  return res.json()
}

// Create one deck. Returns the API payload ({ id, ... }). Defaults to the API's
// permissive `sandbox` format (valid enum: standard|nuc|singleton|singleton_nuc|sandbox)
// so drafted/opened cards aren't rejected for collection/legality.
export async function createDeck({ name, deckCards, isDraft = false, format = 'sandbox', isPublic = false }) {
  if (!deckCards?.length) throw new Error('Nothing to save. The card list is empty.')
  const res = await fetch('/api/decks', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    // name max length is 150 per the API schema; trim to stay within it.
    body: JSON.stringify({ name: String(name ?? '').slice(0, 150), format, isPublic, isDraft, deckCards }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw statusError(res.status, authError(res.status) || data.message || data.detail || data.error || `Save failed (HTTP ${res.status}).`)
  }
  return data
}

// Update one of the user's decks (name/deckCards/etc). Returns the API payload.
// Throws with `.status === 404` if the deck no longer exists (e.g. deleted from
// deckbuilder.alteredcore.org) — callers syncing against a remembered deck id should
// recreate rather than repeat this same failure on every future edit.
export async function updateDeck(id, { name, deckCards, isDraft, format }) {
  const body = {}
  if (name !== undefined) body.name = String(name ?? '').slice(0, 150)
  if (deckCards !== undefined) body.deckCards = deckCards
  if (isDraft !== undefined) body.isDraft = isDraft
  if (format !== undefined) body.format = format

  const res = await fetch(`/api/decks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw statusError(res.status, authError(res.status) || data.message || data.detail || data.error || `Update failed (HTTP ${res.status}).`)
  }
  return data
}

// Group a ref array → [{ cardReference, quantity }] (the deckCards shape). Only keeps
// valid ALT_ references and clamps quantity to the API's 1–99 range.
export function toDeckCards(refs) {
  const counts = {}
  for (const ref of refs) {
    if (typeof ref === 'string' && ref.startsWith('ALT_')) counts[ref] = (counts[ref] ?? 0) + 1
  }
  return Object.entries(counts).map(([cardReference, quantity]) => ({
    cardReference,
    quantity: Math.max(1, Math.min(quantity, 99)),
  }))
}

// Expand a deck's API `deckCards` (or `cards`) into a flat ref list (ref repeated by qty).
export function deckCardsToRefs(deck) {
  const cards = deck?.deckCards ?? deck?.cards ?? []
  const refs = []
  for (const c of cards) {
    const ref = String(c.cardReference ?? c.reference ?? '').toUpperCase()
    const qty = Math.max(1, parseInt(c.quantity ?? 1, 10) || 1)
    if (ref) for (let i = 0; i < qty; i++) refs.push(ref)
  }
  return refs
}
