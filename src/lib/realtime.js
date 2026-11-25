// Realtime transport for room updates — isolated here so the CRUD side (roomStore.js)
// and the page components never need to know which Realtime backend is in play. See
// ROADMAP.md "Realtime": Vercel deployments point this at a Supabase project's own
// hosted Realtime; self-hosted (Docker) deployments point it at our own self-hosted
// `supabase/realtime` instance instead — same open-source client/protocol either way
// (see src/lib/supabase.js for how the URL/anon key are resolved per deployment), so
// this file has exactly one implementation, not two.
//
// Whenever Realtime is not delivering, it falls back to polling the room through the API
// (`fetchRoom`, injected by roomStore.js to avoid a circular import), so pages that only
// move on an update (the host leaving the lobby, picks passing round the table) still
// work:
//   - not configured at all (local dev — see Makefile): poll for the whole subscription;
//   - config request failed (network blip): poll meanwhile and retry the config, then
//     switch to Realtime as soon as it answers;
//   - configured but the channel fails (CHANNEL_ERROR / TIMED_OUT / CLOSED, a
//     postgres_changes error, or no SUBSCRIBED within SUBSCRIBE_TIMEOUT_MS): poll until
//     the channel reports SUBSCRIBED again. supabase-js keeps rejoining on its own.
//     Without this a broken Realtime froze every room until F5 (Nov 2026: Traefik sent
//     /realtime/v1/* to the app, the WebSocket never opened).
//
// Every state goes through one `report`, which drops a state identical to the last one
// reported, so switching transports never replays an update. On each SUBSCRIBED the room
// is read once more: an update written while the channel was down is not lost.
//
// `onStatusChange` means "updates are flowing": 'subscribed' when the channel is up or a
// poll read succeeded, 'error' when a poll read failed (the API itself is unreachable).
import { getRealtimeConfig, getSupabaseClient } from './supabase.js'

const POLL_INTERVAL_MS = 1500
const CONFIG_RETRY_MS = 15000
const SUBSCRIBE_TIMEOUT_MS = 10000
const CHANNEL_FAILURES = new Set(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])

/**
 * @param {string} code - room code
 * @param {(state: object) => void} onUpdate
 * @param {(status: 'subscribed' | 'error') => void} [onStatusChange]
 * @param {(code: string) => Promise<{ data: { state: object } | null, error?: unknown }>} fetchRoom - polling fallback
 * @returns {() => void} unsubscribe — safe to call even before the client has resolved
 */
export function subscribeToRoomRealtime(code, onUpdate, onStatusChange, fetchRoom) {
  let client = null
  let channel = null
  let stopPolling = null
  let retryTimer = null
  let subscribeTimer = null
  let cancelled = false
  let last = null
  let pushes = 0 // Realtime events received — lets a catch-up read know it's stale

  function report(state) {
    if (cancelled || !state) return
    const serialized = JSON.stringify(state)
    if (serialized === last) return
    last = serialized
    onUpdate(state)
  }

  function startPolling() {
    if (!stopPolling && !cancelled) stopPolling = pollRoom(code, report, onStatusChange, fetchRoom)
  }

  function stopPollingNow() {
    stopPolling?.()
    stopPolling = null
  }

  async function catchUp() {
    const seen = pushes
    try {
      const { data } = await fetchRoom(code)
      // A push that landed while this read was in flight is newer: never overwrite it.
      if (pushes === seen) report(data?.state)
    } catch { /* the channel is up; the next update will come through it */ }
  }

  function connect() {
    getRealtimeConfig().then(async ({ url, anonKey, ok }) => {
      if (cancelled) return
      if (!url || !anonKey) {
        startPolling()
        if (!ok) retryTimer = setTimeout(connect, CONFIG_RETRY_MS)
        return
      }
      const supabase = await getSupabaseClient()
      if (cancelled) return
      if (!supabase) { startPolling(); return }
      client = supabase
      // Polling (if any, from a failed config request) keeps running until the channel
      // is actually SUBSCRIBED — not merely created.
      subscribeTimer = setTimeout(startPolling, SUBSCRIBE_TIMEOUT_MS)
      channel = supabase
        .channel(`draft-${code}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'draft_rooms', filter: `id=eq.${code}` },
          payload => { pushes++; report(payload.new?.state) })
        .on('system', {}, ev => {
          // The channel can join while its postgres_changes binding fails server-side.
          if (ev?.extension === 'postgres_changes' && ev?.status === 'error') startPolling()
        })
        .subscribe(status => {
          if (cancelled) return
          if (status === 'SUBSCRIBED') {
            clearTimeout(subscribeTimer)
            stopPollingNow()
            onStatusChange?.('subscribed')
            catchUp()
          } else if (CHANNEL_FAILURES.has(status)) {
            clearTimeout(subscribeTimer)
            startPolling()
          }
        })
    })
  }
  connect()

  return () => {
    cancelled = true
    clearTimeout(retryTimer)
    clearTimeout(subscribeTimer)
    stopPollingNow()
    if (client && channel) client.removeChannel(channel)
  }
}

// Re-reads the room every POLL_INTERVAL_MS and hands each state to `report` (which drops
// unchanged ones) — including the first read, so an update landing before polling
// started is never lost. Chained timeouts (not setInterval) so slow requests never
// overlap; a failed read reports 'error' and keeps polling. Returns a stop function.
function pollRoom(code, report, onStatusChange, fetchRoom) {
  let timer = null
  let stopped = false

  async function tick() {
    let result = null
    try {
      result = await fetchRoom(code)
    } catch (error) {
      result = { data: null, error }
    }
    if (stopped) return
    if (result?.error) onStatusChange?.('error')
    else {
      onStatusChange?.('subscribed')
      report(result?.data?.state)
    }
    timer = setTimeout(tick, POLL_INTERVAL_MS)
  }
  tick()

  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
