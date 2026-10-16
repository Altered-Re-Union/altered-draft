// Realtime transport for room updates — isolated here so the CRUD side (roomStore.js)
// and the page components never need to know which Realtime backend is in play. See
// ROADMAP.md "Realtime": Vercel deployments point this at a Supabase project's own
// hosted Realtime; self-hosted (Docker) deployments point it at our own self-hosted
// `supabase/realtime` instance instead — same open-source client/protocol either way
// (see src/lib/supabase.js for how the URL/anon key are resolved per deployment), so
// this file has exactly one implementation, not two.
//
// When no Realtime is configured at all (local dev — see Makefile), it falls back to
// polling the room through the same API, so pages that only move on an update (the
// host leaving the lobby, picks passing round the table) still work.
import { getRealtimeConfig, getSupabaseClient } from './supabase.js'
import { getRoom } from './roomStore.js'

const POLL_INTERVAL_MS = 1500

/**
 * @param {string} code - room code
 * @param {(state: object) => void} onUpdate
 * @param {(status: 'subscribed' | 'error') => void} [onStatusChange]
 * @returns {() => void} unsubscribe — safe to call even before the client has resolved
 */
export function subscribeToRoomRealtime(code, onUpdate, onStatusChange) {
  let client = null
  let channel = null
  let pollTimer = null
  let cancelled = false

  getRealtimeConfig().then(({ url, anonKey }) => {
    if (cancelled) return
    if (!url || !anonKey) {
      pollRoom(code, onUpdate, onStatusChange, () => cancelled, timer => { pollTimer = timer })
      return
    }
    getSupabaseClient().then(supabase => {
      if (cancelled) return
      client = supabase
      channel = supabase
        .channel(`draft-${code}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'draft_rooms', filter: `id=eq.${code}` },
          payload => onUpdate(payload.new.state))
        .on('system', {}, ev => {
          if (ev.event === 'CHANNEL_ERROR' || ev.event === 'CLOSED') onStatusChange?.('error')
          if (ev.event === 'SUBSCRIBED') onStatusChange?.('subscribed')
        })
        .subscribe()
    })
  })

  return () => {
    cancelled = true
    clearTimeout(pollTimer)
    if (client && channel) client.removeChannel(channel)
  }
}

// Re-reads the room every POLL_INTERVAL_MS and reports it only when it changed, like a
// Realtime UPDATE would. Chained timeouts (not setInterval) so slow requests never overlap.
function pollRoom(code, onUpdate, onStatusChange, isCancelled, setTimer) {
  let last = null
  onStatusChange?.('subscribed')

  async function tick() {
    const { data } = await getRoom(code)
    if (isCancelled()) return
    if (data?.state) {
      const serialized = JSON.stringify(data.state)
      // The first read is only a baseline: pages already load the room themselves.
      if (last !== null && serialized !== last) onUpdate(data.state)
      last = serialized
    }
    setTimer(setTimeout(tick, POLL_INTERVAL_MS))
  }
  tick()
}
