// PATCH { hidden } — hides (true) or shows again (false) a declared tournament in the
// caller's hub lists (the "Ongoing" tab folds the hidden ones, for an organizer who forgot
// to close theirs). Per player, display only, any status, with or without a pool.
import { verifyUser } from '../../_lib/auth.js'
import { jsonBody } from '../../_lib/request.js'
import { getTournament, setTournamentHidden } from '../../../src/lib/tournamentStore.js'

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const { hidden } = jsonBody(req)
  if (typeof hidden !== 'boolean') return res.status(400).json({ error: 'invalid_request' })

  const row = await getTournament(req.query?.id)
  if (!row) return res.status(404).json({ error: 'not_found' })

  await setTournamentHidden(user.sub, row.id, hidden)
  return res.status(200).json({ id: row.id, hidden })
}
