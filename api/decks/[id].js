// Vercel proxy: GET full detail (incl. deckCards) for one of the user's Re:Union decks,
// or PATCH to update one (used by the tournament sealed pages' throttled deck sync —
// see ROADMAP.md "Set 6 preview"). Forwards the Bearer token server-side (the decks API
// has no browser CORS).
const BASE = 'https://decks.alteredcore.org/api/decks'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    res.setHeader('Allow', 'GET, PATCH')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  const auth = req.headers.authorization
  if (!auth) return res.status(401).json({ error: 'missing_authorization' })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'missing_id' })

  try {
    const isPatch = req.method === 'PATCH'
    const r = await fetch(`${BASE}/${encodeURIComponent(String(id))}`, {
      method: isPatch ? 'PATCH' : 'GET',
      headers: {
        Authorization: auth,
        Accept: 'application/json',
        ...(isPatch ? { 'Content-Type': 'application/merge-patch+json' } : {}),
      },
      body: isPatch ? JSON.stringify(req.body ?? {}) : undefined,
    })
    const text = await r.text()
    res.status(r.status)
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json')
    return res.send(text)
  } catch {
    return res.status(502).json({ error: 'upstream_unreachable' })
  }
}
