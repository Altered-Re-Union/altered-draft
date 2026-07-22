// Vercel serverless function — validates a submitted tournament-sealed deck against
// the SAME deterministic pool `/api/sealed-seed` issued. See ROADMAP.md "Set 6 preview".
//
// Regenerates the pool server-side from `sub` + the currently-active event window (no
// event id travels in the request body — every real call happens during a BGA game,
// itself inside the padded interval, so the same lookup re-finds the same event and
// recomputes the same seed as generation time). Checks deckCards ⊆ pool (respecting
// quantities) plus the app's own deckbuild legality (Sealed.jsx: ≥30 total cards
// including hero, ≤3 factions, ≤1 hero — no separate copy-limit rule exists in the
// app today, so none is enforced here either, to stay consistent with what players see).
import crypto from 'node:crypto'
import { verifySub } from './_lib/auth.js'
import { findActiveEvent } from '../src/lib/sealedEvents.js'
import { regeneratePoolCounts } from './_lib/tournamentPool.js'
import { fetchSet } from '../src/lib/cardData.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const sub = await verifySub(req)
  if (!sub) return res.status(401).json({ error: 'unauthorized' })

  const event = findActiveEvent()
  // Shouldn't happen given the 1h padding on both sides of every configured event,
  // unless the event config is misconfigured or this is called well outside a tournament.
  if (!event) return res.status(409).json({ error: 'no_active_event' })

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
  const deckCards = Array.isArray(body.deckCards) ? body.deckCards : null
  if (!deckCards || !deckCards.length) return res.status(400).json({ error: 'invalid_request' })

  const [poolCounts, cards] = await Promise.all([
    regeneratePoolCounts(sub, event),
    fetchSet(event.setCode),
  ])
  const cardByRef = {}
  for (const c of cards) cardByRef[c.reference] = c

  const reasons = []
  let totalCount = 0
  let heroCount = 0
  const factionsUsed = new Set()

  for (const entry of deckCards) {
    const ref = String(entry?.cardReference ?? '').toUpperCase()
    const qty = Math.max(1, parseInt(entry?.quantity, 10) || 1)
    const avail = poolCounts[ref] ?? 0
    if (qty > avail) {
      reasons.push(avail === 0 ? `${ref} is not in your pool.` : `${ref}: only ${avail} in your pool, deck has ${qty}.`)
      continue
    }
    totalCount += qty
    const card = cardByRef[ref]
    if (card?.cardType === 'HERO') heroCount += qty
    if (card?.faction) factionsUsed.add(card.faction)
  }

  if (totalCount < 30) reasons.push(`Deck has ${totalCount} cards, needs at least 30.`)
  if (heroCount > 1) reasons.push(`Deck has ${heroCount} heroes, at most 1 allowed.`)
  if (factionsUsed.size > 3) reasons.push(`Deck spans ${factionsUsed.size} factions, at most 3 allowed.`)

  const valid = reasons.length === 0
  const deckHash = crypto.createHash('sha256').update(JSON.stringify(deckCards)).digest('hex')
  const attestation = signAttestation({
    sub,
    event: event.eventKey,
    deckHash,
    valid,
    iat: Math.floor(Date.now() / 1000),
  })

  return res.status(200).json({ valid, sub, reasons, attestation })
}

function signAttestation(payload) {
  const secret = process.env.SEALED_ATTESTATION_SECRET
  if (!secret) return null // misconfigured deploy — validity result is still returned, just unsigned
  const sig = crypto.createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url')
}

function safeParse(s) { try { return JSON.parse(s || '{}') } catch { return {} } }
