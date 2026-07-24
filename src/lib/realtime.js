// Realtime transport for room updates — isolated here so the CRUD side (roomStore.js)
// and the page components never need to know which Realtime backend is in play. See
// ROADMAP.md "Realtime": Vercel deployments point this at a Supabase project's own
// hosted Realtime; self-hosted (Docker) deployments point it at our own self-hosted
// `supabase/realtime` instance instead — same open-source client/protocol either way
// (see src/lib/supabase.js for how the URL/anon key are resolved per deployment), so
// this file has exactly one implementation, not two.
import { getSupabaseClient } from './supabase.js'

/**
 * @param {string} code - room code
 * @param {(state: object) => void} onUpdate
 * @param {(status: 'subscribed' | 'error') => void} [onStatusChange]
 * @returns {() => void} unsubscribe — safe to call even before the client has resolved
 */
export function subscribeToRoomRealtime(code, onUpdate, onStatusChange) {
  let client = null
  let channel = null
  let cancelled = false

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

  return () => {
    cancelled = true
    if (client && channel) client.removeChannel(channel)
  }
}
