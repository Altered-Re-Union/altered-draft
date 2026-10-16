import { createClient } from '@supabase/supabase-js'

// Only ever used for Realtime now (see src/lib/realtime.js) — CRUD goes through our
// own api/rooms/* endpoints (src/lib/roomStore.js) regardless of deployment target.
//
// The URL/anon key differ per deployment (a real Supabase project's Realtime on
// Vercel, or our self-hosted `supabase/realtime` tenant on Docker) and the frontend is
// a static bundle built ONCE and shared across environments (no VITE_*-at-build-time
// values baked in — see build/Dockerfile), so they can't be read from import.meta.env.
// Instead they're fetched at runtime from /api/realtime-config (api/realtime-config.js),
// which reads the container's actual env vars server-side. Config and client are
// resolved lazily and cached — every caller awaits the same promise.
let configPromise = null
let clientPromise = null

/** @returns {Promise<{ url: string, anonKey: string }>} empty strings when unconfigured */
export function getRealtimeConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/realtime-config')
      .then(res => res.json())
      .catch(() => ({}))
      .then(({ url, anonKey } = {}) => ({ url: url || '', anonKey: anonKey || '' }))
  }
  return configPromise
}

export function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = getRealtimeConfig().then(({ url, anonKey }) => {
      if (!url || !anonKey) {
        console.warn('Realtime config missing (api/realtime-config returned no url/anonKey) — falling back to polling room updates.')
      }
      return createClient(url || 'http://localhost', anonKey || 'missing')
    })
  }
  return clientPromise
}
