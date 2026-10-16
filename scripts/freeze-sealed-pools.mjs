#!/usr/bin/env node
// One-shot (idempotent): stores the regenerated cards/boosters/config on every legacy
// sealed_pools row that has none, so no pool depends on the upstream set file's order
// anymore (docs/tournaments/user-tournaments-spec.md §10). Needs DATABASE_URL and network
// access to the card data. Run once after the lot-1 migration:
//   node --env-file=.env scripts/freeze-sealed-pools.mjs
import { fileURLToPath } from 'node:url'
import { query, getPool } from '../src/lib/db.js'
import { regeneratePool } from '../api/_lib/tournamentPool.js'
import { configFromLegacyFormat } from '../src/lib/tournamentConfig.js'

export async function freezeSealedPools({ regenerate = regeneratePool, log = console.log } = {}) {
  const { rows } = await query('SELECT * FROM sealed_pools WHERE cards IS NULL ORDER BY created_at')
  let frozen = 0
  let failed = 0
  for (const row of rows) {
    try {
      const { counts, boosters } = await regenerate(row.sub, row)
      await query(
        'UPDATE sealed_pools SET cards = $2, boosters = $3, config = $4 WHERE id = $1 AND cards IS NULL',
        [row.id, JSON.stringify(counts), JSON.stringify(boosters), JSON.stringify(configFromLegacyFormat(row))],
      )
      frozen++
    } catch (e) {
      failed++
      log(`pool ${row.id} (${row.kind}, ${row.set_code}): ${e?.message}`)
    }
  }
  log(`frozen ${frozen}/${rows.length} pools (${failed} failed)`)
  return { total: rows.length, frozen, failed }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  freezeSealedPools()
    .then(({ failed }) => getPool().end().then(() => process.exit(failed ? 1 : 0)))
    .catch(e => { console.error(e); process.exit(1) })
}
