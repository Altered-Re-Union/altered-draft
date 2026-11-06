#!/usr/bin/env node
// Dev-only: refreshes the e2e card fixtures (tests/e2e/fixtures/cards/<SET>/<SET>_EN.json)
// from the community card DB. Keeps only the B printings (what fetchSet keeps anyway) and the
// fields normalizeCard (src/lib/cardData.js) reads, minified. Not shipped in the image.
//
//   node scripts/e2e-card-fixtures.mjs [SET...]     default: CYCLONE EOLE FUGUE
//   node scripts/e2e-card-fixtures.mjs --cube all-commons [--keep REF ...]   the cube's other sets
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

const FULL_SETS = ['CYCLONE', 'EOLE', 'FUGUE']

// argv: [SET...] | --cube <id> [--keep REF ...]
const args = process.argv.slice(2)
let cubeId = null
const keep = []
const positional = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--cube') cubeId = args[++i]
  else if (args[i] === '--keep') { while (args[i + 1] && !args[i + 1].startsWith('--')) keep.push(args[++i]) }
  else positional.push(args[i])
}

async function fetchSet(set) {
  const res = await fetch(`${SOURCE}/${set}/${set}_EN.json`)
  if (!res.ok) throw new Error(`${set}: HTTP ${res.status}`)
  return res.json()
}

function write(set, cards) {
  const out = path.join(ROOT, 'tests/e2e/fixtures/cards', set, `${set}_EN.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const json = JSON.stringify(cards)
  fs.writeFileSync(out, json)
  console.log(`${set}: kept ${cards.length} cards, ${Math.round(json.length / 1024)} KB`)
}

if (cubeId) {
  // A community cube's sets other than the full ones: only the cube's refs (every printing,
  // the B filter is dropped: the promo-only ALT_BISE_P_BR_64_C lives in BISE) plus --keep.
  const { COMMUNITY_CUBES } = await import('../src/lib/cubes.js')
  const cube = COMMUNITY_CUBES.find(c => c.id === cubeId)
  if (!cube) throw new Error(`unknown cube ${cubeId}`)
  const wanted = new Set([...cube.refs, ...(cube.heroes ?? []), ...keep])
  const bySet = new Map()
  for (const ref of wanted) {
    const set = ref.split('_')[1]
    if (FULL_SETS.includes(set)) continue
    if (!bySet.has(set)) bySet.set(set, new Set())
    bySet.get(set).add(ref)
  }
  for (const [set, refs] of bySet) {
    const raw = await fetchSet(set)
    const cards = raw.filter(c => refs.has(c.reference)).map(trim)
    const found = new Set(cards.map(c => c.reference))
    const missing = [...refs].filter(r => !found.has(r))
    if (missing.length) console.warn(`${set}: ${missing.length} refs not in the source: ${missing.join(' ')}`)
    write(set, cards)
  }
} else {
  const sets = positional.length ? positional : FULL_SETS
  for (const set of sets) {
    const raw = await fetchSet(set)
    write(set, raw.filter(c => /^ALT_[A-Z]+_B_/.test(c.reference ?? '')).map(trim))
  }
}
