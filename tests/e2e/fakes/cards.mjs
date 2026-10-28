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
      const card = synthesizeUnique(String(req.query.reference))
      return res.json({ member: card ? [card] : [] })
    }
    // Rooms' "add random uniques" (out of scope): must answer, never crash.
    res.json({ member: [] })
  })
  return { router }
}
