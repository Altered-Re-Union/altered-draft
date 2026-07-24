// CRUD access to draft/sealed rooms, via our own api/rooms/* endpoints instead of
// Supabase's PostgREST directly — works identically regardless of deployment target
// (Vercel+Supabase's own Postgres, or self-hosted Docker+Postgres). See ROADMAP.md
// "Realtime" for why: the realtime *subscription* side still varies by environment
// (subscribeToRoom below), but reads/writes are now unified through one API.
//
// Return shapes deliberately mirror what supabase-js returned, so call sites written
// against `{ data, error }` need minimal changes.
import { subscribeToRoomRealtime } from './realtime.js'

export async function getRoom(code) {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`)
    if (res.status === 404) return { data: null, error: null }
    if (!res.ok) return { data: null, error: new Error(`HTTP ${res.status}`) }
    const body = await res.json()
    return { data: { state: body.state }, error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}

export async function insertRoom(code, state) {
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: code, state }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: new Error(body.error || `HTTP ${res.status}`) }
    }
    return { error: null }
  } catch (err) {
    return { error: err }
  }
}

/** Unconditional update — used by Lobby's "start the draft/sealed" writes. */
export async function updateRoom(code, state) {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { error: new Error(body.error || `HTTP ${res.status}`) }
    }
    return { error: null }
  } catch (err) {
    return { error: err }
  }
}

/**
 * Optimistic-concurrency update: only commits if the room's current state->>version
 * still equals expectedVersion. Returns `data: [{id: code}]` on success or `data: []`
 * on a version conflict — mirrors the old `.eq('state->>version', v).select('id')`
 * pattern so `if (data && data.length > 0)` call sites are unchanged.
 */
export async function updateRoomIfVersion(code, state, expectedVersion) {
  try {
    const res = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, expectedVersion }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { data: null, error: new Error(body.error || `HTTP ${res.status}`) }
    }
    const body = await res.json()
    return { data: body.updated ? [{ id: code }] : [], error: null }
  } catch (err) {
    return { data: null, error: err }
  }
}

/**
 * Subscribes to live updates for a room. `onUpdate(state)` fires on every change;
 * `onStatusChange('subscribed' | 'error')` mirrors the old CHANNEL_ERROR/CLOSED/SUBSCRIBED
 * system events (used to drive the "reconnecting…" banner). Returns an unsubscribe fn.
 * See src/lib/realtime.js for the actual transport (self-hosted or Supabase-hosted).
 */
export function subscribeToRoom(code, onUpdate, onStatusChange) {
  return subscribeToRoomRealtime(code, onUpdate, onStatusChange)
}
