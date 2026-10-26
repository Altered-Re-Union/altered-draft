// The one fake process of the e2e stack (port 8091): every external service the app talks
// to, path-prefixed per service, plus /__control endpoints the tests drive. An unknown path
// is a logged 404 — a missing route must be loud, never a silent fallback.
import express from 'express'
import { fileURLToPath } from 'node:url'
import { CLIENT_ID, CLIENT_SECRET, KEYCLOAK_ISSUER } from '../support/env.js'
import { PASSWORD, PERSONAS } from '../support/personas.js'
import { createKeycloak } from './keycloak.mjs'

export function createFakeServer() {
  const keycloak = createKeycloak({ issuer: KEYCLOAK_ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, personas: PERSONAS, password: PASSWORD })
  const app = express()

  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*')
    if (req.method !== 'OPTIONS') return next()
    res.set('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*')
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.status(204).end()
  })
  app.use(express.urlencoded({ extended: false }))
  app.use(express.json({ type: ['application/json', 'application/merge-patch+json'] }))

  app.use('/realms/players', keycloak.router)

  app.get('/__control/health', (req, res) => res.json({ ok: true }))
  app.post('/__control/session', (req, res) => {
    const user = req.body?.user
    if (!PERSONAS[user]) return res.status(404).json({ error: 'unknown_user' })
    res.json(keycloak.mintSession(user))
  })
  app.post('/__control/revoke', (req, res) => {
    keycloak.revoke(req.body?.user)
    res.status(204).end()
  })
  app.post('/__control/reset', (req, res) => {
    keycloak.reset()
    res.status(204).end()
  })

  app.use((req, res) => {
    console.error('[fake] 404', req.method, req.originalUrl)
    res.status(404).json({ error: 'not_found' })
  })

  return { app, keycloak }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8091)
  createFakeServer().app.listen(port, () => console.log(`fake services listening on :${port}`))
}
