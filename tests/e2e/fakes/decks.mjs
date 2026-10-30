// Fake Re:Union decks-api: in-memory decks owned by the token's `sub`, the hydra list shape
// and the merge-patch PATCH contract of the real one (application/json PATCH → 415, which
// the app's server code relies on). Never calls back into altered-draft and never rejects
// a deck — sealed-deck validation is the integration suite's job.
import express from 'express'
import { randomUUID } from 'node:crypto'

const PATCHABLE = ['name', 'isDraft', 'isPublic', 'format', 'deckCards']

export function createDecksApi({ authenticate }) {
  let decks = new Map() // id → { owner, deck }
  let requests = []

  const router = express.Router()

  router.use('/api/decks', (req, res, next) => {
    const persona = authenticate(req)
    requests.push({ method: req.method, path: `/api/decks${req.path === '/' ? '' : req.path}`, sub: persona?.sub ?? null, at: new Date().toISOString() })
    if (!persona) return res.status(401).json({ error: 'unauthorized' })
    req.persona = persona
    next()
  })

  const owned = (req, id) => {
    const entry = decks.get(id)
    return entry && entry.owner === req.persona.sub ? entry : null
  }

  router.get('/api/decks', (req, res) => {
    const needle = String(req.query.name ?? '').toLowerCase()
    const member = [...decks.values()]
      .filter(e => e.owner === req.persona.sub && e.deck.name.toLowerCase().includes(needle))
      .map(e => e.deck)
      .sort((a, b) => a.name.localeCompare(b.name))
    res.json({ 'hydra:member': member, 'hydra:totalItems': member.length })
  })

  router.post('/api/decks', (req, res) => {
    const body = req.body || {}
    const now = new Date().toISOString()
    const deck = {
      id: randomUUID(), name: body.name ?? '', format: body.format ?? 'standard', isDraft: body.isDraft ?? true,
      isPublic: body.isPublic ?? false, deckCards: body.deckCards ?? [], createdAt: now, updatedAt: now,
    }
    decks.set(deck.id, { owner: req.persona.sub, deck })
    res.status(201).json(deck)
  })

  router.get('/api/decks/:id', (req, res) => {
    const entry = owned(req, req.params.id)
    if (!entry) return res.status(404).json({ error: 'not_found' })
    res.json(entry.deck)
  })

  router.patch('/api/decks/:id', (req, res) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/merge-patch+json')) {
      return res.status(415).json({ error: 'unsupported_media_type' })
    }
    const entry = owned(req, req.params.id)
    if (!entry) return res.status(404).json({ error: 'not_found' })
    for (const key of PATCHABLE) if (req.body && key in req.body) entry.deck[key] = req.body[key]
    entry.deck.updatedAt = new Date().toISOString()
    res.json(entry.deck)
  })

  router.delete('/api/decks/:id', (req, res) => {
    if (!owned(req, req.params.id)) return res.status(404).json({ error: 'not_found' })
    decks.delete(req.params.id)
    res.status(204).end()
  })

  return {
    router,
    decksOf: sub => [...decks.values()].filter(e => e.owner === sub).map(e => e.deck),
    get requests() { return requests },
    reset() { decks = new Map(); requests = [] },
  }
}
