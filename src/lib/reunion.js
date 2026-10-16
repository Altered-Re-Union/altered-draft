// Re:Union (Keycloak OIDC) client — Authorization Code + PKCE against a CONFIDENTIAL
// client. The code↔token exchange runs server-side in /api/token (which holds the
// secret); everything here is browser-side. Login is optional/additive — the app works
// fully without it.
//
// Token handling (BFF hardening): the REFRESH token never touches JS — it lives only in
// an httpOnly cookie managed by /api/token. The browser keeps just the short-lived
// ACCESS token in memory (below), refreshing it through the cookie when near expiry or
// on a fresh page load. A readable `reunion_auth` hint cookie tells us a session exists.
//
// Issuer + client id come from src/lib/endpoints.js (prod by default, overridable at
// runtime through /api/config), so the same bundle can target prod or a local Keycloak.
import { endpoints } from './endpoints.js'

const SCOPES = 'openid profile'

const PKCE_KEY = 'reunion_pkce'    // transient during the redirect dance
const HINT_COOKIE = 'reunion_auth' // readable "has session" hint set by /api/token

const redirectUri = () => `${window.location.origin}/auth/callback`

// ---- PKCE + state helpers (Web Crypto) ----
function base64url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function randomString(len = 64) {
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}
async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

// ---- in-memory access token (NOT persisted; the refresh token lives in an httpOnly cookie) ----
let session = null // { access_token, id_token, expires_at } | null

function storeFromResponse(data) {
  session = {
    access_token: data.access_token,
    id_token: data.id_token,
    expires_at: Date.now() + (data.expires_in ?? 60) * 1000,
  }
  return session
}
export function clearTokens() { session = null }

// True when a session likely exists: an in-memory token, or the readable hint cookie set
// by /api/token (the httpOnly refresh token itself is invisible to JS by design).
export function isLoggedIn() {
  if (session) return true
  return document.cookie.split(';').some(c => c.trim().startsWith(`${HINT_COOKIE}=`))
}

// ---- public API ----
export async function login(returnPath) {
  const verifier = randomString(64)
  const state = randomString(16)
  const challenge = await challengeFor(verifier)
  const { keycloakIssuer, keycloakClientId } = endpoints()
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({
    verifier, state, returnPath: returnPath ?? (location.pathname + location.search),
  }))
  const p = new URLSearchParams({
    client_id: keycloakClientId,
    response_type: 'code',
    scope: SCOPES,
    redirect_uri: redirectUri(),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })
  window.location.assign(`${keycloakIssuer}/protocol/openid-connect/auth?${p.toString()}`)
}

export async function handleCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const err = params.get('error')
  let pkce = null
  try { pkce = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null') } catch { /* ignore */ }
  sessionStorage.removeItem(PKCE_KEY)
  if (err) throw new Error(params.get('error_description') || err)
  if (!code || !pkce || state !== pkce.state) throw new Error('Invalid login response.')

  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant: 'authorization_code', code, code_verifier: pkce.verifier, redirect_uri: redirectUri() }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error_description || data.error || 'Sign-in failed.')
  storeFromResponse(data) // the refresh token was set as an httpOnly cookie by the function
  return pkce.returnPath || '/'
}

// Exchange the httpOnly refresh-token cookie for a fresh access token. No token is sent
// from JS — the function reads it from the cookie. Returns the new session or null.
async function refresh() {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant: 'refresh_token' }),
  })
  if (!res.ok) { clearTokens(); return null }
  return storeFromResponse(await res.json())
}

// Returns a valid access token (refreshing via the cookie if needed), or null. Also
// covers fresh page loads, where the in-memory token is gone but the cookie persists.
export async function getAccessToken() {
  if (session && Date.now() < session.expires_at - 30_000) return session.access_token
  if (!isLoggedIn()) return null
  const t = await refresh()
  return t?.access_token ?? null
}

export async function fetchProfile() {
  const token = await getAccessToken()
  if (!token) return null
  try {
    const res = await fetch(`${endpoints().keycloakIssuer}/protocol/openid-connect/userinfo`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return null
    const u = await res.json()
    return { pseudo: u.pseudo || u.preferred_username || u.name || 'Player', sub: u.sub }
  } catch { return null }
}

// Soft logout: drop the in-memory token + readable hint immediately for snappy UI, and
// ask the function to clear the httpOnly refresh cookie. The Keycloak SSO session
// persists, so reconnecting is one click.
export async function logout() {
  clearTokens()
  document.cookie = `${HINT_COOKIE}=; Max-Age=0; Path=/`
  try {
    await fetch('/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant: 'logout' }),
    })
  } catch { /* ignore */ }
}
