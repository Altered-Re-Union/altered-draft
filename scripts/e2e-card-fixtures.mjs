#!/usr/bin/env node
// Dev-only: refreshes the e2e card fixtures (tests/e2e/fixtures/cards/<SET>/<SET>_EN.json)
// from the community card DB. Keeps only the B printings (what fetchSet keeps anyway) and the
// fields normalizeCard (src/lib/cardData.js) reads, minified. Not shipped in the image.
//
//   node scripts/e2e-card-fixtures.mjs [SET...]     default: CYCLONE EOLE FUGUE
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'https://raw.githubusercontent.com/PolluxTroy0/Altered-TCG-Card-Database/main/SETS'
const ELEMENTS = ['MAIN_COST', 'RECALL_COST', 'FOREST_POWER', 'MOUNTAIN_POWER', 'OCEAN_POWER']

function trim(card) {
  const elements = {}
  for (const key of ELEMENTS) if (card.elements?.[key] != null) elements[key] = card.elements[key]
  return {
    reference: card.reference,
    name: card.name,
    mainFaction: { reference: card.mainFaction?.reference, name: card.mainFaction?.name },
    rarity: { reference: card.rarity?.reference },
    cardType: { reference: card.cardType?.reference },
    elements,
  }
}

const sets = process.argv.slice(2).length ? process.argv.slice(2) : ['CYCLONE', 'EOLE', 'FUGUE']
for (const set of sets) {
  const res = await fetch(`${SOURCE}/${set}/${set}_EN.json`)
  if (!res.ok) throw new Error(`${set}: HTTP ${res.status}`)
  const raw = await res.json()
  const cards = raw.filter(c => /^ALT_[A-Z]+_B_/.test(c.reference ?? '')).map(trim)
  const out = path.join(ROOT, 'tests/e2e/fixtures/cards', set, `${set}_EN.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const json = JSON.stringify(cards)
  fs.writeFileSync(out, json)
  console.log(`${set}: kept ${cards.length} cards, ${Math.round(json.length / 1024)} KB`)
}
