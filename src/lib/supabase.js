import { createClient } from '@supabase/supabase-js'

// Only ever used for Realtime now (see src/lib/realtime.js) — CRUD goes through our
// own api/rooms/* endpoints (src/lib/roomStore.js) regardless of deployment target.
//
// The URL/anon key differ per deployment (a real Supabase project's Realtime on
// Vercel, or our self-hosted `supabase/realtime` tenant on Docker) and the frontend is
// a static bundle built ONCE and shared across environments (no VITE_*-at-build-time
// values baked in — see build/Dockerfile), so they can't be read from import.meta.env.
// Instead they're fetched at runtime from /api/realtime-config (api/realtime-config.js),
// which reads the container's actual env vars server-side.
//
// Only a successful answer is cached: a failed request (network blip, 5xx) is retried by
// the next caller instead of pinning the whole session to the polling fallback.
let configPromise = null
let clientPromise = null

/**
 * @returns {Promise<{ url: string, anonKey: string, ok: boolean }>} `ok: false` when the
 *   request failed (retry later); `ok: true` with empty strings when Realtime is simply
 *   not configured (local dev).
 */
export function getRealtimeConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/realtime-config')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(({ url, anonKey } = {}) => ({ url: url || '', anonKey: anonKey || '', ok: true }))
      .catch(() => {
        configPromise = null
        return { url: '', anonKey: '', ok: false }
      })
  }
  return configPromise
}

/** Resolves to null when Realtime isn't (or couldn't be) configured. */
export function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = getRealtimeConfig().then(({ url, anonKey }) => {
      if (url && anonKey) return createClient(url, anonKey)
      clientPromise = null // not configured yet — let a later call try again
      return null
    })
  }
  return clientPromise
}
