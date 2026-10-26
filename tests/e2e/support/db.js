// SQL access to the e2e Postgres, for resets and for the assertions the recette itself
// makes in SQL. Own pool, never the app's.
import pg from 'pg'
import { DATABASE_URL } from './env.js'

let pool = null

function getPool() {
  pool ??= new pg.Pool({ connectionString: DATABASE_URL, ssl: false, max: 2 })
  return pool
}

export function query(text, params) {
  return getPool().query(text, params)
}

export async function resetDb() {
  await query('TRUNCATE sealed_pool_games, sealed_pools, tournaments, draft_rooms')
}

export async function closeDb() {
  if (!pool) return
  const p = pool
  pool = null
  await p.end()
}
