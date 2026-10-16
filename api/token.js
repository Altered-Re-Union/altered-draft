// Vercel serverless function: exchanges an OIDC authorization code (or refreshes) at
// Keycloak using the CONFIDENTIAL client secret — which must never reach the browser.
// Public config comes from src/lib/endpoints.js (prod defaults, env-overridable); the secret
// only from env (KEYCLOAK_CLIENT_SECRET, set in the Vercel project, never in git). Same-origin with the SPA, so no CORS handling.
//
// BFF hardening: the REFRESH token is never returned to the browser — it's stored in an
// httpOnly, Secure, SameSite=Strict cookie scoped to this endpoint, so XSS can't read it.
// The browser only ever holds the short-lived access token (in memory). A separate,
// non-sensitive readable cookie (`reunion_auth=1`) just hints the SPA that a session
// exists so it knows to attempt a refresh.
import { endpoints } from '../src/lib/endpoints.js'

const { keycloakIssuer, keycloakClientId } = endpoints()
const TOKEN_ENDPOINT = `${keycloakIssuer}/protocol/openid-connect/token`
const RT_COOKIE = 'reunion_rt'     // httpOnly refresh token (Path=/api/token)
const HINT_COOKIE = 'reunion_auth' // readable "has session" hint (Path=/)

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  const secret = process.env.KEYCLOAK_CLIENT_SECRET
  if (!secret) return res.status(500).json({ error: 'server_misconfigured' })

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})

  // Logout: just clear our cookies. The Keycloak SSO session persists, so reconnecting
  // is one click (full RP-initiated logout can be added later if wanted).
  if (body.grant === 'logout') {
    clearAuthCookies(res)
    return res.status(200).json({ ok: true })
  }

  const form = new URLSearchParams()
  form.set('client_id', keycloakClientId)
  form.set('client_secret', secret)

  if (body.grant === 'authorization_code') {
    const { code, code_verifier, redirect_uri } = body
    if (!code || !code_verifier || !redirect_uri) return res.status(400).json({ error: 'invalid_request' })
    form.set('grant_type', 'authorization_code')
    form.set('code', code)
    form.set('code_verifier', code_verifier)
    form.set('redirect_uri', redirect_uri)
  } else if (body.grant === 'refresh_token') {
    // The refresh token is NEVER sent by the browser — read it from the httpOnly cookie.
    const rt = readCookie(req, RT_COOKIE)
    if (!rt) return res.status(401).json({ error: 'no_session' })
    form.set('grant_type', 'refresh_token')
    form.set('refresh_token', rt)
  } else {
    return res.status(400).json({ error: 'unsupported_grant' })
  }

  try {
    const r = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    })
    const data = await r.json()
    if (!r.ok) {
      // A failed refresh means the session is dead — clear cookies so the client logs out cleanly.
      if (body.grant === 'refresh_token') clearAuthCookies(res)
      return res.status(r.status).json({ error: data.error || 'token_error', error_description: data.error_description })
    }
    // Persist the (rotated) refresh token httpOnly; hand the client only the access/id tokens.
    if (data.refresh_token) setAuthCookies(res, data.refresh_token, data.refresh_expires_in)
    return res.status(200).json({
      access_token: data.access_token,
      expires_in: data.expires_in,
      id_token: data.id_token,
      token_type: data.token_type,
    })
  } catch {
    return res.status(502).json({ error: 'token_exchange_failed' })
  }
}

// ---- cookies ----
function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}
function setAuthCookies(res, refreshToken, refreshExpiresIn) {
  const maxAge = Math.max(60, Number(refreshExpiresIn) || 1800)
  res.setHeader('Set-Cookie', [
    `${RT_COOKIE}=${encodeURIComponent(refreshToken)}; HttpOnly; Secure; SameSite=Strict; Path=/api/token; Max-Age=${maxAge}`,
    `${HINT_COOKIE}=1; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
  ])
}
function clearAuthCookies(res) {
  res.setHeader('Set-Cookie', [
    `${RT_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/token; Max-Age=0`,
    `${HINT_COOKIE}=; Secure; SameSite=Strict; Path=/; Max-Age=0`,
  ])
}
function safeParse(s) { try { return JSON.parse(s || '{}') } catch { return {} } }
