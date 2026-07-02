import { UNIQUES_EN } from './uniquesData.js'

const BASE_URL = 'https://raw.githubusercontent.com/PolluxTroy0/Altered-TCG-Card-Database/main/SETS'

// Card images: the community CDN (cdn.alteredcore.org) — the ONLY working host since Altered
// disabled public access to BOTH its S3 buckets (altered-prod-eu AND altered-dev now return
// 403 "AllAccessDisabled") and retired api.altered.gg (DNS gone). Web-optimized .webp keyed by
// the card reference — deterministic, no per-card hash: /cards/<lang>/<SET>/<REF>.webp
// (CORS: Access-Control-Allow-Origin: *). The old `imagePath` field in the community DB and
// the cards API both point at the now-dead buckets, so we IGNORE it and build the URL here.
const IMG_HOST = 'https://cdn.alteredcore.org/cards'
const IMG_LANG = { EN: 'en', FR: 'fr', ES: 'es', DE: 'de', IT: 'it' }

// Build a card image URL from its reference. Uniques (…_U_<serial>) aren't on the CDN, but a
// unique shares the illustration of its base RARE printing, so fall back to that (…_R1).
export function cardImageUrl(reference, lang = 'EN') {
  if (!reference) return null
  const set = reference.split('_')[1]
  if (!set) return null
  const lc = IMG_LANG[lang] ?? 'en'
  const ref = isUniqueRef(reference) ? reference.replace(/_U_\d+$/, '_R1') : reference
  return `${IMG_HOST}/${lc}/${set}/${ref}.webp`
}

const cache = {}

export async function fetchSet(setCode, lang = 'EN') {
  const key = `${setCode}_${lang}`
  if (cache[key]) return cache[key]

  const url = `${BASE_URL}/${setCode}/${setCode}_${lang}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch set ${setCode} (${lang}): ${res.status}`)

  const json = await res.json()
  const raw = Array.isArray(json) ? json : (json['hydra:member'] || [])
  const cards = raw.map(r => normalizeCard(r, lang)).filter(isStandardPrinting)
  cache[key] = cards
  return cards
}

// Reference format: ALT_<SET>_<PRINT>_<FACTION>_<NUM>_<RARITY...>
// <PRINT> is the printing variant: 'B' = the actual booster set card,
// 'A' = alternate-art reprint, 'P' = promo. 'A'/'P' are the SAME gameplay
// card as their 'B' twin, just different art. We keep only 'B' so each card
// has exactly one canonical printing in the pool/packs/stats (every 'A' has a
// 'B' twin; the only 'P'-only entries are promo cards that aren't in boosters).
function isStandardPrinting(card) {
  return (card.reference.split('_')[2] === 'B')
}

export function isUniqueRef(ref) {
  return /_U_\d+$/.test(ref ?? '')
}

// Refs that `fetchSet` doesn't stock, so they must be pulled from the cards API by
// reference: uniques (`_U_`) plus non-booster printings — promo (`_P_`), alt-art
// (`_A_`), or promo/OP set codes — which can be a promo-ONLY card with no standard
// booster (`_B_`) equivalent (e.g. "Sofia, First Outpost" = ALT_BISE_P_BR_64_C).
export function needsCardApi(ref) {
  if (isUniqueRef(ref)) return true
  const parts = (ref ?? '').split('_')
  return parts[0] === 'ALT' && parts.length >= 3 && parts[2] !== 'B'
}

// Cube refs may list non-standard printings — alternate-art (`_A_`), promo (`_P_`),
// or promo / organized-play set codes like `DUSTEROP` (= DUSTER OP). These are the SAME
// gameplay card as the standard booster (`B`) printing, but `fetchSet` only stocks `B`
// cards from the canonical sets, so a pasted cube listing them would never resolve.
// Canonicalize to the `B` printing of the base set so they resolve from set data like any
// other card. Uniques are left as-is (resolved via fetchUnique); an unknown set with no
// known base is left untouched (it surfaces as unresolved).
export function canonicalCardRef(ref) {
  if (!ref || isUniqueRef(ref)) return ref
  const parts = ref.split('_')            // ALT, SET, PRINT, FAC, NUM, RARITY…
  if (parts.length < 6 || parts[0] !== 'ALT') return ref
  const setCode = parts[1]
  const known = SETS.map(s => s.code)
  // Exact known set wins; otherwise the longest known set that prefixes the (promo) set
  // code — DUSTEROP → DUSTER, while COREKS stays COREKS (it's a known set itself).
  const base = known.includes(setCode)
    ? setCode
    : known.filter(s => setCode.startsWith(s)).sort((a, b) => b.length - a.length)[0]
  if (!base) return ref
  if (base === setCode && parts[2] === 'B') return ref   // already standard
  parts[1] = base
  parts[2] = 'B'
  return parts.join('_')
}

const LOCALE = { EN: 'en-us', FR: 'fr-fr', ES: 'es-es', DE: 'de-de', IT: 'it-it' }
const uniqueCache = {}

// Unique cards (…_U_<serial>) don't exist in the community set files. The 24 cube
// uniques are bundled locally (data in uniquesData.js, images in /public/uniques) so
// the cube works offline / instantly in EN. Everything else (any other unique, or a
// non-EN locale) resolves live from cards.alteredcore.org — the community card API
// that REPLACES the retiring api.altered.gg, so this no longer depends on the dying
// API. Falls back to the bundled EN snapshot if the request fails.
export async function fetchUnique(reference, lang = 'EN') {
  const key = `${reference}_${lang}`
  if (uniqueCache[key]) return uniqueCache[key]
  const snapshot = UNIQUES_EN[reference]
  // EN: prefer the bundled snapshot (no network — future-proof).
  if (snapshot && lang === 'EN') {
    uniqueCache[key] = snapshot
    return snapshot
  }
  const loc = (LOCALE[lang] ?? 'en-us').slice(0, 2) // 'en','fr',… for the per-locale fields
  try {
    // Filter by reference (the /api/cards/<id> path expects a numeric id, not a ref).
    const res = await fetch(`https://cards.alteredcore.org/api/cards?reference=${encodeURIComponent(reference)}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`Failed to fetch unique ${reference}: ${res.status}`)
    const raw = (await res.json()).member?.[0]
    if (!raw) throw new Error(`Unique ${reference} not found`)
    const card = normalizeAlteredCore(raw, loc, lang)
    uniqueCache[key] = card
    return card
  } catch (err) {
    // API down / not found → fall back to the bundled EN snapshot if we have one.
    if (snapshot) { uniqueCache[key] = snapshot; return snapshot }
    throw err
  }
}

// Fetch many uniques; failures are skipped (the card simply won't appear).
export async function fetchUniques(references, lang = 'EN') {
  const out = []
  await Promise.all([...new Set(references)].map(async r => {
    try { out.push(await fetchUnique(r, lang)) } catch { /* skip */ }
  }))
  return out
}

// Pull a RANDOM pool of real uniques for a set — used by the optional "add random uniques
// to packs" mode. The cards API registers every unique ever opened (millions), so we ask
// it for a random page filtered to the set (`random=1` reshuffles each call). Returns
// normalized card objects (rarity 'U', real art + stats); [] on any failure so pack
// generation degrades gracefully to no-uniques. `setCode` is the internal set code
// (CORE/ALIZE/BISE/…), which the API exposes as `set.reference`.
export async function fetchRandomUniques(setCode, count = 50, lang = 'EN') {
  const loc = (LOCALE[lang] ?? 'en-us').slice(0, 2)
  try {
    const url = `https://cards.alteredcore.org/api/cards?rarity=UNIQUE&set.reference=${encodeURIComponent(setCode)}&random=1&itemsPerPage=${count}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`uniques ${setCode}: ${res.status}`)
    const members = (await res.json()).member ?? []
    const cards = members.map(m => normalizeAlteredCore(m, loc, lang)).filter(c => c.reference)
    for (const c of cards) uniqueCache[`${c.reference}_${lang}`] = c // warm the by-ref cache
    return cards
  } catch { return [] }
}

// Scan any value (object/array/string) for unique references (…_U_<serial>) it contains.
// Used by the draft/sealed/results pages to resolve uniques that were injected into packs
// (they aren't in set data or the cube ref list, so they must be fetched by reference).
export function uniqueRefsIn(value) {
  if (value == null) return []
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  const matches = str.match(/ALT_[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*?_U_\d+/g) ?? []
  return [...new Set(matches)]
}

// Strip #...# formatting markers used in Altered card text fields
function stripMarkers(val) {
  if (val == null) return null
  const n = Number(String(val).replace(/#/g, ''))
  return isNaN(n) ? null : n
}

function normalizeRarity(raw, refStr) {
  const ref = (raw?.reference ?? '').toUpperCase()
  if (ref === 'UNIQUE') return 'U'
  if (ref === 'EXALTED') return 'EX'  // treated as rare in pack generation (set 5+)
  if (ref === 'RARE') return refStr.endsWith('_R2') ? 'R2' : 'R1'
  if (ref === 'UNCOMMON') return 'R2'
  // Also handle _E suffix in reference string (Exalted shorthand)
  if (refStr.endsWith('_E')) return 'EX'
  return 'C'
}

// COREKS has its own dataset — no remapping needed
export function apiSetCode(code) {
  return code
}

function normalizeCard(raw, lang = 'EN') {
  const refStr = raw.reference ?? ''
  return {
    reference: refStr,
    name: raw.name,
    faction: raw.mainFaction?.reference ?? raw.faction?.reference ?? 'XX',
    factionName: raw.mainFaction?.name ?? raw.faction?.name ?? 'Unknown',
    rarity: normalizeRarity(raw.rarity, refStr),
    imagePath: cardImageUrl(refStr, lang),
    cardType: raw.cardType?.reference ?? '',
    mainCost: stripMarkers(raw.elements?.MAIN_COST),
    recallCost: stripMarkers(raw.elements?.RECALL_COST),
    forestPower: stripMarkers(raw.elements?.FOREST_POWER),
    mountainPower: stripMarkers(raw.elements?.MOUNTAIN_POWER),
    oceanPower: stripMarkers(raw.elements?.OCEAN_POWER),
  }
}

// Map a card from cards.alteredcore.org into our normalized shape. Its JSON differs
// from the old API: name/imagePath are per-locale objects, faction/cardType/rarity are
// nested, and powers are flat integers (no #…# markers). Its `imagePath` points at the
// now-dead S3 buckets, so we ignore it and build the image URL from the reference
// (community CDN) via cardImageUrl instead.
function normalizeAlteredCore(raw, loc = 'en', lang = 'EN') {
  const refStr = raw.reference ?? ''
  const pick = obj => obj == null ? null
    : typeof obj === 'string' ? obj
    : (obj[loc] ?? obj.en ?? Object.values(obj)[0] ?? null)
  return {
    reference: refStr,
    name: pick(raw.name),
    faction: raw.faction?.code ?? 'XX',
    factionName: raw.faction?.name ?? 'Unknown',
    rarity: normalizeRarity(raw.rarity, refStr),
    imagePath: cardImageUrl(refStr, lang),
    cardType: raw.cardType?.reference ?? '',
    mainCost: raw.mainCost ?? null,
    recallCost: raw.recallCost ?? null,
    forestPower: raw.forestPower ?? null,
    mountainPower: raw.mountainPower ?? null,
    oceanPower: raw.oceanPower ?? null,
  }
}

export const SETS = [
  { code: 'CORE',    name: 'Beyond the Gates',     color: '#1a4a6e' },
  { code: 'COREKS',  name: 'Beyond the Gates KS',  color: '#1a3a5e', hidden: true },
  { code: 'ALIZE',   name: 'Trial by Frost',        color: '#2a5a7a' },
  { code: 'BISE',    name: 'Whisper from the Maze', color: '#3a3a6e' },
  { code: 'CYCLONE', name: 'Skybound Odyssey',       color: '#1a5a4a' },
  { code: 'DUSTER',  name: 'Seeds of Unity',         color: '#4a4a1a' },
  { code: 'EOLE',    name: 'Roots of Corruption',    color: '#4a2a1a' },
  { code: 'FUGUE',   name: 'Neverending Journey',    color: '#2a1a4a' },
]

// Short display names for use in UI (codes → friendly abbreviation)
// CORE and COREKS are merged under BTG
export const SET_ABBREV = {
  CORE:    'BTG',
  COREKS:  'BTG',
  ALIZE:   'TBF',
  BISE:    'WTM',
  CYCLONE: 'SKY',
  DUSTER:  'SDU',
  EOLE:    'ROC',
  FUGUE:   'NEJ',
}

export const SET_FULL_NAMES = {
  BTG: 'Beyond the Gates',
  TBF: 'Trial by Frost',
  WTM: 'Whisper from the Maze',
  SKY: 'Skybound Odyssey',
  SDU: 'Seeds of Unity',
  ROC: 'Roots of Corruption',
  NEJ: 'Neverending Journey',
}

// Canonical icon per abbreviation (BTG maps to CORE icon)
export const SET_ABBREV_ICON_CODE = {
  BTG: 'CORE',
  TBF: 'ALIZE',
  WTM: 'BISE',
  SKY: 'CYCLONE',
  SDU: 'DUSTER',
  ROC: 'EOLE',
  NEJ: 'FUGUE',
}

export const FACTIONS = ['AX', 'BR', 'LY', 'MU', 'OR', 'YZ']

export const FACTION_COLORS = {
  AX: 'text-ax bg-ax/10 border-ax/40',
  BR: 'text-br bg-br/10 border-br/40',
  LY: 'text-ly bg-ly/10 border-ly/40',
  MU: 'text-mu bg-mu/10 border-mu/40',
  OR: 'text-or bg-or/10 border-or/40',
  YZ: 'text-yz bg-yz/10 border-yz/40',
}

export const FACTION_NAMES = {
  AX: 'Axiom',
  BR: 'Bravos',
  LY: 'Lyra',
  MU: 'Muna',
  OR: 'Ordis',
  YZ: 'Yzmir',
}
