// Fake cards.alteredcore.org: synthesises a unique from its reference, in the shape
// normalizeAlteredCore (src/lib/cardData.js) reads. The faction comes from the same
// faction-range windows pickDeterministicUniques draws from, so a faction check against
// this fake is a check against real data, not an echo.
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT_DIR } from '../support/env.js'

const FACTION_NAMES = { AX: 'Axiom', BR: 'Bravos', LY: 'Lyra', MU: 'Muna', OR: 'Ordis', YZ: 'Yzmir' }
const UNIQUE_REF = /^ALT_([A-Z]+)_B_([A-Z]{2})_(\d+)_U_(\d+)$/
const rangesCache = new Map()
const FIXTURES_DIR = path.join(ROOT_DIR, 'tests/e2e/fixtures/cards')
let fixtureIndex = null // reference -> trimmed fixture card, loaded once

function fixtureCard(ref) {
  if (!fixtureIndex) {
    fixtureIndex = new Map()
    for (const set of fs.readdirSync(FIXTURES_DIR, { withFileTypes: true })) {
      if (!set.isDirectory()) continue
      const file = path.join(FIXTURES_DIR, set.name, `${set.name}_EN.json`)
      if (!fs.existsSync(file)) continue
      for (const card of JSON.parse(fs.readFileSync(file, 'utf8'))) fixtureIndex.set(card.reference, card)
    }
  }
  return fixtureIndex.get(ref) ?? null
}

const num = v => (v == null ? null : Number(String(v).replace(/#/g, '')))

// A non-unique card answered from the fixture files, in the same shape as synthesizeUnique.
export function cardByReference(ref) {
  const card = fixtureCard(ref)
  if (!card) return null
  const code = card.mainFaction.reference
  const el = card.elements ?? {}
  return {
    reference: ref,
    name: { en: card.name },
    faction: { code, name: card.mainFaction.name ?? FACTION_NAMES[code] },
    rarity: { reference: card.rarity.reference },
    cardType: { reference: card.cardType.reference },
    mainCost: num(el.MAIN_COST), recallCost: num(el.RECALL_COST),
    forestPower: num(el.FOREST_POWER), mountainPower: num(el.MOUNTAIN_POWER), oceanPower: num(el.OCEAN_POWER),
    imagePath: '',
  }
}

function rangesOf(set, rangesDir) {
  const file = path.resolve(ROOT_DIR, rangesDir, `${set}.json`)
  if (!rangesCache.has(file)) rangesCache.set(file, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)
  return rangesCache.get(file)
}

export function factionOfUnique(ref, rangesDir = 'src/lib/data/factionRanges') {
  const m = UNIQUE_REF.exec(String(ref))
  if (!m) return null
  const [, set, fam, num, serialStr] = m
  const windows = rangesOf(set, rangesDir)?.[`${fam}_${num}`]
  if (!windows) return null
  const serial = Number(serialStr)
  for (const [faction, ranges] of Object.entries(windows)) {
    if (ranges.some(([lo, hi]) => serial >= lo && serial <= hi)) return faction
  }
  return null
}

export function synthesizeUnique(ref) {
  const code = factionOfUnique(ref)
  if (!code) return null
  const [, , fam, num, serial] = UNIQUE_REF.exec(ref)
  return {
    reference: ref,
    name: { en: `Unique ${fam}_${num} #${serial}` },
    faction: { code, name: FACTION_NAMES[code] },
    rarity: { reference: 'UNIQUE' },
    cardType: { reference: 'CHARACTER' },
    mainCost: 3, recallCost: 2, forestPower: 1, mountainPower: 1, oceanPower: 1,
    imagePath: '',
  }
}

export function createCardsApi() {
  const router = express.Router()
  router.get('/api/cards', (req, res) => {
    if (req.query.reference) {
      const ref = String(req.query.reference)
      const card = UNIQUE_REF.test(ref) ? synthesizeUnique(ref) : cardByReference(ref)
      return res.json({ member: card ? [card] : [] })
    }
    // Rooms' "add random uniques" (out of scope): must answer, never crash.
    res.json({ member: [] })
  })
  return { router }
}
