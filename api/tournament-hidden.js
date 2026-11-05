// Vercel serverless function — PATCH { bgaTournamentId, hidden } hides (true) or shows
// again (false) a BGA tournament in the caller's hub: it folds out of "Ongoing" and
// "My ongoing tournaments", and its pool folds out of "My pools". Keyed by the BGA id so
// legacy pools (no declared tournament) can be hidden too. Per player, display only:
// binding, validation and the BGA lookups never read it. Any BGA id is accepted (hiding
// an id the caller has nothing on is harmless and invisible).
import { verifySub } from './_lib/auth.js'
import { jsonBody } from './_lib/request.js'
import { setTournamentHidden } from '../src/lib/tournamentStore.js'

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const { bgaTournamentId, hidden } = jsonBody(req)
  // Not forced numeric: legacy pools keep whatever id BGA sent at bind time.
  if (typeof bgaTournamentId !== 'string' || !bgaTournamentId.trim() || bgaTournamentId.length > 64 || typeof hidden !== 'boolean') {
    return res.status(400).json({ error: 'invalid_request' })
  }

  await setTournamentHidden(sub, bgaTournamentId, hidden)
  return res.status(200).json({ bgaTournamentId, hidden })
}
