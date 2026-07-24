// Postgres connection for the Set 6 preview tournament state (sealed-pools-schema.sql).
// Hosted by Re:Union — a plain connection string via DATABASE_URL, no ORM. Server-side
// only (Vercel functions / api/*.js); never imported from browser-bundled code.
//
// Small pool size: each Vercel serverless instance runs its own Node process, so a
// large per-instance pool just multiplies connections across instances for no benefit —
// keep it small and let the DB-side pooler (if any) handle fan-out across instances.
import pg from 'pg'

let pool

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is not configured')
    pool = new pg.Pool({
      connectionString,
      max: 5,
      ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? false : { rejectUnauthorized: false },
    })
  }
  return pool
}

export function query(text, params) {
  return getPool().query(text, params)
}
