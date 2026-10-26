// Fake Keycloak (realm `players`): just enough OIDC for src/lib/reunion.js, api/token.js and
// api/_lib/auth.js to run unchanged — authorization code + PKCE, refresh rotation, password
// grant, userinfo. Tokens are real HS256 JWTs (the app decodes the payload for roles, it never
// checks the signature). Everything lives in memory and dies with reset().
import express from 'express'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'

const SIGNING_KEY = 'e2e-fake-keycloak'
const ACCESS_TTL = 300
const REFRESH_TTL = 1800

export const b64url = input => Buffer.from(input).toString('base64url')

export function signJwt(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', SIGNING_KEY).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

export function decodeJwt(token) {
  return JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'))
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function createKeycloak({ issuer, clientId, clientSecret, personas, password }) {
  const codes = new Map()         // code → { user, redirectUri, challenge }
  const accessTokens = new Map()  // token → { user, sid }
  const refreshTokens = new Map() // token → { user, sid }
  const sessions = new Map()      // sid → user

  function issueTokens(user, sid = randomUUID()) {
    const persona = personas[user]
    const iat = Math.floor(Date.now() / 1000)
    const access = signJwt({
      iss: issuer, sub: persona.sub, sid, typ: 'Bearer', azp: clientId, jti: randomUUID(),
      preferred_username: persona.username, pseudo: persona.name, name: persona.name, email: persona.email,
      realm_access: { roles: persona.roles }, scope: 'openid profile', iat, exp: iat + ACCESS_TTL,
    })
    const refresh = signJwt({ iss: issuer, sub: persona.sub, sid, typ: 'Refresh', jti: randomUUID(), iat, exp: iat + REFRESH_TTL })
    sessions.set(sid, user)
    accessTokens.set(access, { user, sid })
    refreshTokens.set(refresh, { user, sid })
    return {
      access_token: access, expires_in: ACCESS_TTL, refresh_token: refresh, refresh_expires_in: REFRESH_TTL,
      id_token: access, token_type: 'Bearer', scope: 'openid profile', session_state: sid,
    }
  }

  function alive(entry) {
    return entry && sessions.get(entry.sid) === entry.user ? entry : null
  }

  function lookupAccess(token) {
    const entry = alive(accessTokens.get(token))
    return entry ? personas[entry.user] : null
  }

  function revoke(user) {
    for (const [sid, owner] of sessions) if (owner === user) sessions.delete(sid)
  }

  function reset() {
    codes.clear()
    accessTokens.clear()
    refreshTokens.clear()
    sessions.clear()
  }

  function mintSession(user) {
    return { refresh_token: issueTokens(user).refresh_token }
  }

  const router = express.Router()

  router.get('/protocol/openid-connect/auth', (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, user } = req.query
    if (client_id !== clientId || !redirect_uri || !state || !code_challenge || code_challenge_method !== 'S256') {
      return res.status(400).json({ error: 'invalid_request' })
    }
    if (user) {
      if (!personas[user]) return res.status(400).json({ error: 'unknown_user' })
      const code = randomBytes(16).toString('hex')
      codes.set(code, { user, redirectUri: redirect_uri, challenge: code_challenge })
      const target = new URL(redirect_uri)
      target.searchParams.set('code', code)
      target.searchParams.set('state', state)
      return res.redirect(302, target.toString())
    }
    const links = Object.keys(personas).map(name => {
      const url = new URL(req.originalUrl, issuer)
      url.searchParams.set('user', name)
      return `<li><a href="${escapeHtml(url.pathname + url.search)}">${escapeHtml(name)}</a></li>`
    }).join('')
    res.type('html').send(`<!doctype html><title>Sign in</title><h1>Sign in</h1><ul>${links}</ul>`)
  })

  router.post('/protocol/openid-connect/token', (req, res) => {
    const body = req.body || {}
    if (body.grant_type === 'authorization_code') {
      if (body.client_id !== clientId || body.client_secret !== clientSecret) return res.status(401).json({ error: 'unauthorized_client' })
      const entry = codes.get(body.code)
      if (!entry) return res.status(400).json({ error: 'invalid_grant', error_description: 'Code not valid' })
      codes.delete(body.code)
      if (entry.redirectUri !== body.redirect_uri) return res.status(400).json({ error: 'invalid_grant', error_description: 'Incorrect redirect_uri' })
      const computed = createHash('sha256').update(String(body.code_verifier || '')).digest('base64url')
      if (computed !== entry.challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' })
      return res.json(issueTokens(entry.user))
    }
    if (body.grant_type === 'refresh_token') {
      // Rotates, but the old refresh token stays valid until its session dies: the realm runs
      // with revokeRefreshToken = false (AlteredAuth realm export), and the app relies on it —
      // two refreshes racing on a page load both present the same cookie.
      const entry = alive(refreshTokens.get(body.refresh_token))
      if (!entry) return res.status(400).json({ error: 'invalid_grant', error_description: 'Token is not active' })
      return res.json(issueTokens(entry.user, entry.sid))
    }
    if (body.grant_type === 'password') {
      const user = Object.keys(personas).find(name => personas[name].username === body.username)
      if (!user || body.password !== password) return res.status(401).json({ error: 'invalid_grant', error_description: 'Invalid user credentials' })
      return res.json(issueTokens(user))
    }
    res.status(400).json({ error: 'unsupported_grant_type' })
  })

  function cors(res) {
    res.set('Access-Control-Allow-Origin', '*')
    res.set('Access-Control-Allow-Headers', 'Authorization')
  }

  router.options('/protocol/openid-connect/userinfo', (req, res) => {
    cors(res)
    res.status(204).end()
  })

  router.get('/protocol/openid-connect/userinfo', (req, res) => {
    cors(res)
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
    const persona = match && lookupAccess(match[1])
    if (!persona) return res.status(401).json({ error: 'invalid_token' })
    res.json({
      sub: persona.sub, preferred_username: persona.username, pseudo: persona.name, name: persona.name,
      email: persona.email, email_verified: true,
    })
  })

  return { router, mintSession, revoke, reset, lookupAccess }
}
