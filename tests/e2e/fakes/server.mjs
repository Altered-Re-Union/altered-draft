// The one fake process of the e2e stack (port 8091): every external service the app talks
// to, path-prefixed per service, plus /__control endpoints the tests drive. An unknown path
// is a logged 404 — a missing route must be loud, never a silent fallback.
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLIENT_ID, CLIENT_SECRET, KEYCLOAK_ISSUER, ROOT_DIR } from '../support/env.js'
import { PASSWORD, PERSONAS } from '../support/personas.js'
import { createCardsApi } from './cards.mjs'
import { createDecksApi } from './decks.mjs'
import { createKeycloak } from './keycloak.mjs'

const FIXTURES_DIR = path.join(ROOT_DIR, 'tests/e2e/fixtures/cards')
// 1×1 transparent PNG: every CDN asset (card art, icons, logos) renders as a dot.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

function bearer(req) {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
  return match ? match[1] : null
}

export function createFakeServer() {
  const keycloak = createKeycloak({ issuer: KEYCLOAK_ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, personas: PERSONAS, password: PASSWORD })
  const decks = createDecksApi({ authenticate: req => keycloak.lookupAccess(bearer(req)) })
  const cards = createCardsApi()
  const app = express()
  const unmatched = []

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
  app.use('/decks', decks.router)
  app.use('/cards', cards.router)

  app.get('/cdn/*path', (req, res) => {
    res.set('Cache-Control', 'public, max-age=31536000').type('image/png').send(PNG)
  })
  app.get('/carddb/:set/:file', (req, res, next) => {
    const { set, file } = req.params
    const full = path.join(FIXTURES_DIR, set, file)
    if (!/^[A-Z]+$/.test(set) || !new RegExp(`^${set}_[A-Z]{2}\\.json$`).test(file) || !fs.existsSync(full)) return next()
    res.sendFile(full)
  })
  app.get(['/deckbuilder/*path', '/reunion/*path'], (req, res) => res.type('text/plain').send('placeholder'))

  app.get('/__control/health', (req, res) => res.json({ ok: true }))
  // Only for the guard self-test (smoke.spec.js): a 5xx the guard must report.
  app.get('/__control/boom', (req, res) => res.status(500).json({ error: 'boom' }))
  app.post('/__control/session', (req, res) => {
    const user = req.body?.user
    if (!PERSONAS[user]) return res.status(404).json({ error: 'unknown_user' })
    res.json(keycloak.mintSession(user))
  })
  app.post('/__control/revoke', (req, res) => {
    keycloak.revoke(req.body?.user)
    res.status(204).end()
  })
  app.get('/__control/decks', (req, res) => {
    const persona = PERSONAS[req.query.user]
    if (!persona) return res.status(404).json({ error: 'unknown_user' })
    res.json(decks.decksOf(persona.sub))
  })
  app.get('/__control/requests', (req, res) => res.json(decks.requests))
  // The 404s below since the last drain: the guard fixture drains before and after each test
  // and fails it on any, so a route the app needs but the fakes lack never goes unnoticed.
  app.post('/__control/unmatched/drain', (req, res) => res.json(unmatched.splice(0)))
  app.post('/__control/reset', (req, res) => {
    keycloak.reset()
    decks.reset()
    res.status(204).end()
  })

  app.use((req, res) => {
    console.error('[fake] 404', req.method, req.originalUrl)
    unmatched.push(`${req.method} ${req.originalUrl}`)
    res.status(404).json({ error: 'not_found' })
  })

  return { app, keycloak, decks }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8091)
  createFakeServer().app.listen(port, () => console.log(`fake services listening on :${port}`))
}
