// Stored sealed-pool helpers shared by the tournament pool specs.
import { expect } from '@playwright/test'
import { PERSONAS } from './personas.js'

// Set code of a card reference (`ALT_<SET>_…`).
export const setOf = ref => ref.split('_')[1]

// The pool of `who` on `tournamentId`, as stored (exactly one row expected).
export async function storedPool(db, tournamentId, who) {
  const { rows } = await db.query('SELECT set_code, created_by, boosters, cards, cube_slot FROM sealed_pools WHERE tournament_ref = $1 AND sub = $2', [tournamentId, PERSONAS[who].sub])
  expect(rows).toHaveLength(1)
  return rows[0]
}

// { SET: number of refs of that set }.
export function countBySet(refs) {
  const counts = {}
  for (const ref of refs) counts[setOf(ref)] = (counts[setOf(ref)] ?? 0) + 1
  return counts
}
