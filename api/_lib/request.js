// Small request helpers shared by handlers that run both as Vercel functions and inside
// server/index.js's Express app: query params live in req.query on both (Express's
// routeWithParam bridges :id), and a JSON body is already parsed on both, except when a
// client sends it as a raw string.
export function queryParam(req, name) {
  const fromQuery = req.query?.[name]
  if (fromQuery != null) return String(fromQuery).trim()
  try {
    return (new URL(req.url, 'http://x').searchParams.get(name) ?? '').trim()
  } catch {
    return ''
  }
}

export function jsonBody(req) {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') } catch { return {} }
  }
  return typeof req.body === 'object' ? req.body : {}
}
