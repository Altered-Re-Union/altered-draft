// Runtime config for the Realtime client (src/lib/supabase.js). The frontend is a
// static SPA bundle built ONCE (see build/Dockerfile — no VITE_* build args), and the
// SAME image is deployed to both preprod and prod, so anything that differs per
// environment (the Realtime URL/anon key) can't be baked in at build time — it has to
// be read from the container's runtime env and handed to the browser over the wire.
//
// Two deployment targets, one endpoint:
//   - Vercel + a real Supabase project: VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are
//     already set as project env vars and visible here at function-runtime too (not
//     just inlined into the client build) — used as-is.
//   - Self-hosted Docker + our own `supabase/realtime` sidecar (see ROADMAP.md
//     "Realtime"): REALTIME_URL is this same app's own public origin (Traefik routes
//     /realtime/v1/* on that host to the sidecar — see AlteredOps' docker-compose.yml).
//     There is no separately-stored anon key: it's an HS256 JWT {role:"anon"} signed
//     with REALTIME_API_JWT_SECRET, the same secret the sidecar was seeded with (its
//     SEED_SELF_HOST tenant's jwt_secret IS that value, just AES-encrypted at rest) —
//     computed here on every request instead of minted once and stored, since it's
//     cheap and keeps one fewer secret in sync across two places.
import { createHmac } from 'node:crypto'

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function signAnonJwt(secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { role: 'anon', iss: 'altered-draft', iat: now, exp: now + 60 * 60 * 24 * 365 * 10 }
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`
  const signature = createHmac('sha256', secret).update(signingInput).digest()
  return `${signingInput}.${base64url(signature)}`
}

export default function handler(req, res) {
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return res.status(200).json({ url: process.env.VITE_SUPABASE_URL, anonKey: process.env.VITE_SUPABASE_ANON_KEY })
  }
  const url = process.env.REALTIME_URL || ''
  const anonKey = process.env.REALTIME_API_JWT_SECRET ? signAnonJwt(process.env.REALTIME_API_JWT_SECRET) : ''
  res.status(200).json({ url, anonKey })
}
