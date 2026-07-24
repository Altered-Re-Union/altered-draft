// Postgres connection for the Set 6 preview tournament state (sealed-pools-schema.sql)
// and draft/sealed room state (draft-rooms-schema.sql). Server-side only (Vercel
// functions / api/*.js, or the Express server on the self-hosted Docker deployment —
// see server/index.js); never imported from browser-bundled code.
//
// Small pool size: each Vercel serverless instance runs its own Node process, so a
// large per-instance pool just multiplies connections across instances for no benefit —
// keep it small and let the DB-side pooler (if any) handle fan-out across instances.
import pg from 'pg'

let pool

function resolveSsl(connectionString) {
  // Explicit override (AlteredOps' docker-compose.yml sets DATABASE_SSL=false) takes
  // priority — the self-hosted Postgres container talks to the app over the Docker
  // network's own `postgres` hostname, which is neither localhost nor a managed host
  // requiring SSL, so the hostname-sniffing heuristic below can't tell it apart from a
  // real remote DB and would otherwise force SSL against a server that has none
  // configured at all ("The server does not support SSL connections").
  if (process.env.DATABASE_SSL === 'false') return false
  if (process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false }
  return /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false }
}

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not configured')
    pool = new pg.Pool({
      connectionString,
      max: 5,
      ssl: resolveSsl(connectionString),
    })
  }
  return pool
}

export function query(text, params) {
  return getPool().query(text, params)
}
