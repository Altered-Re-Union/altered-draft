// Vercel serverless function — PATCH { id, hidden } moves one of the caller's bound
// tournament pools into (hidden: true) or out of (hidden: false) the archive section of
// the hub's "My pools" tab. Display preference only: binding, validation and the BGA
// lookups never read it. Scoped to the caller's sub (404 otherwise).
import { verifySub } from './_lib/auth.js'
import { jsonBody } from './_lib/request.js'
import { setPoolHidden } from '../src/lib/poolStore.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req, res) {
  if (req.method !== 'PATCH') {
    res.setHeader('Allow', 'PATCH')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const { id, hidden } = jsonBody(req)
  if (typeof id !== 'string' || !UUID.test(id) || typeof hidden !== 'boolean') {
    return res.status(400).json({ error: 'invalid_request' })
  }

  const hiddenAt = await setPoolHidden(sub, id, hidden)
  if (hiddenAt === undefined) return res.status(404).json({ error: 'not_found' })
  return res.status(200).json({ id, hiddenAt })
}
