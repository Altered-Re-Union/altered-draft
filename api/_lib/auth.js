// Shared auth helper for tournament endpoints (sealed-seed, validate-deck). The
// access token is opaque to us — we verify it against Keycloak's userinfo endpoint
// (the same call the frontend makes in src/lib/reunion.js's fetchProfile) rather than
// decoding it ourselves, so `sub` is only ever trusted once Keycloak vouches for it.
const USERINFO = 'https://auth.altered.re/realms/players/protocol/openid-connect/userinfo'

export function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

/** Returns the verified Keycloak `sub` for this request's Bearer token, or null. */
export async function verifySub(req) {
  const token = bearerToken(req)
  if (!token) {
    console.log(`verifySub: no bearer token on ${req.method} ${req.url}`)
    return null
  }
  try {
    const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      console.log(`verifySub: userinfo returned ${res.status} on ${req.method} ${req.url}`)
      return null
    }
    const data = await res.json()
    return data.sub || null
  } catch (e) {
    console.log(`verifySub: userinfo call threw "${e?.message}" on ${req.method} ${req.url}`)
    return null
  }
}
