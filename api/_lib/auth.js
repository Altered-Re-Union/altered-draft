// Shared auth helpers for the tournament endpoints. The access token is opaque to us — we
// verify it against Keycloak's userinfo endpoint (the same call the frontend makes in
// src/lib/reunion.js's fetchProfile) rather than validating signatures ourselves, so a
// `sub` is only ever trusted once Keycloak vouches for it. Roles are read from the
// token's payload ONLY after that check: userinfo accepting the exact same token string
// is what makes its claims trustworthy.
import { endpoints } from '../../src/lib/endpoints.js'

const USERINFO = `${endpoints().keycloakIssuer}/protocol/openid-connect/userinfo`

export function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

/** The JWT payload, decoded without verification. `{}` for anything malformed. */
export function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token).split('.')
    if (!payload) return {}
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Moderators: a Keycloak realm role (TOURNAMENT_MODERATOR_ROLE) and/or allowlisted subs. */
export function moderatorConfig(env = process.env) {
  const role = (env.TOURNAMENT_MODERATOR_ROLE || '').trim() || null
  const subs = (env.TOURNAMENT_MODERATORS || '').split(',').map(s => s.trim()).filter(Boolean)
  return { role, subs }
}

export function isModerator({ sub, roles = [] }, cfg = moderatorConfig()) {
  if (cfg.role && roles.includes(cfg.role)) return true
  return cfg.subs.includes(sub)
}

async function userinfo(req) {
  const token = bearerToken(req)
  if (!token) {
    console.log(`verify: no bearer token on ${req.method} ${req.url}`)
    return null
  }
  try {
    const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      console.log(`verify: userinfo returned ${res.status} on ${req.method} ${req.url}`)
      return null
    }
    const data = await res.json()
    return data?.sub ? { token, data } : null
  } catch (e) {
    console.log(`verify: userinfo call threw "${e?.message}" on ${req.method} ${req.url}`)
    return null
  }
}

/** Returns the verified Keycloak `sub` for this request's Bearer token, or null. */
export async function verifySub(req) {
  const u = await userinfo(req)
  return u?.data.sub ?? null
}

/** Verified identity + display name + realm roles (+ the moderator flag), or null. */
export async function verifyUser(req) {
  const u = await userinfo(req)
  if (!u) return null
  const payload = decodeJwtPayload(u.token)
  const roles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : []
  const sub = u.data.sub
  return {
    sub,
    name: u.data.pseudo || u.data.preferred_username || u.data.name || 'Player',
    roles,
    isModerator: isModerator({ sub, roles }),
  }
}
