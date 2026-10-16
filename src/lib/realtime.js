// Realtime transport for room updates — isolated here so the CRUD side (roomStore.js)
// and the page components never need to know which Realtime backend is in play. See
// ROADMAP.md "Realtime": Vercel deployments point this at a Supabase project's own
// hosted Realtime; self-hosted (Docker) deployments point it at our own self-hosted
// `supabase/realtime` instance instead — same open-source client/protocol either way
// (see src/lib/supabase.js for how the URL/anon key are resolved per deployment), so
// this file has exactly one implementation, not two.
//
// Without a usable Realtime config it falls back to polling the room through the API
// (`fetchRoom`, injected by roomStore.js to avoid a circular import), so pages that only
// move on an update (the host leaving the lobby, picks passing round the table) still
// work:
//   - not configured at all (local dev — see Makefile): poll for the whole subscription;
//   - config request failed (network blip): poll meanwhile and retry the config, then
//     switch to Realtime as soon as it answers.
import { getRealtimeConfig, getSupabaseClient } from './supabase.js'

const POLL_INTERVAL_MS = 1500
const CONFIG_RETRY_MS = 15000

/**
 * @param {string} code - room code
 * @param {(state: object) => void} onUpdate
 * @param {(status: 'subscribed' | 'error') => void} [onStatusChange]
 * @param {(code: string) => Promise<{ data: { state: object } | null }>} fetchRoom - polling fallback
 * @returns {() => void} unsubscribe — safe to call even before the client has resolved
 */
export function subscribeToRoomRealtime(code, onUpdate, onStatusChange, fetchRoom) {
  let client = null
  let channel = null
  let stopPolling = null
  let retryTimer = null
  let cancelled = false

  function connect() {
    getRealtimeConfig().then(async ({ url, anonKey, ok }) => {
      if (cancelled) return
      if (!url || !anonKey) {
        if (!stopPolling) stopPolling = pollRoom(code, onUpdate, onStatusChange, fetchRoom)
        if (!ok) retryTimer = setTimeout(connect, CONFIG_RETRY_MS)
        return
      }
      const supabase = await getSupabaseClient()
      if (cancelled || !supabase) return
      stopPolling?.()
      stopPolling = null
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
  }
  connect()

  return () => {
    cancelled = true
    clearTimeout(retryTimer)
    stopPolling?.()
    if (client && channel) client.removeChannel(channel)
  }
}

// Re-reads the room every POLL_INTERVAL_MS and reports it whenever it differs from the
// last reported state — including the first read, so an update landing between the
// page's own initial load and this subscription is never lost. Chained timeouts (not
// setInterval) so slow requests never overlap. Returns a stop function.
function pollRoom(code, onUpdate, onStatusChange, fetchRoom) {
  let last = null
  let timer = null
  let stopped = false
  onStatusChange?.('subscribed')

  async function tick() {
    const { data } = await fetchRoom(code)
    if (stopped) return
    if (data?.state) {
      const serialized = JSON.stringify(data.state)
      if (serialized !== last) onUpdate(data.state)
      last = serialized
    }
    timer = setTimeout(tick, POLL_INTERVAL_MS)
  }
  tick()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
