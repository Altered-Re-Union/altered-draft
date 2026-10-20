// Vercel proxy: forwards the logged-in user's Bearer token to the Re:Union decks API
// (which sends no browser CORS, so direct frontend calls are blocked). GET = list the
// user's decks, POST = create a deck. The user's access token is the credential here —
// the Keycloak client secret is NOT used. Fixed upstream host (not an open proxy).
import { endpoints } from '../../src/lib/endpoints.js'

const DECKS_API = `${endpoints().decksApiUrl}/api/decks`

export default async function handler(req, res) {
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'missing_authorization' })

  if (req.method === 'GET') {
    // Forward the client's query string (pagination/order/filters: itemsPerPage, order[name],
    // name, format, isDraft…). Fixed upstream host — only the query is pass-through.
    const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''
    return forward(res, DECKS_API + qs, { headers: { Authorization: auth, Accept: 'application/json' } })
  }
  if (req.method === 'POST') {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
    return forward(res, DECKS_API, {
      method: 'POST',
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
    })
  }
  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'method_not_allowed' })
}

async function forward(res, url, init) {
  try {
    const r = await fetch(url, init)
    const text = await r.text()
    res.status(r.status)
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json')
    return res.send(text)
  } catch {
    return res.status(502).json({ error: 'upstream_unreachable' })
  }
}
