import { FACTIONS, SETS } from './cardData.js'

// Every draw in this module takes an injectable `rng` (`() => float in [0,1)`),
// defaulting to Math.random for normal/casual use. Tournament mode passes a seeded
// PRNG (see prng.js) instead, so the exact same draws — in the exact same order —
// reproduce identically for both pool generation and later deck validation.
export function shuffle(arr, rng = Math.random) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Split `n` cards between sets in proportion to `weights` ({ SET: weight }), exactly:
 * floor of each share, then the leftover cards go to the largest remainders. Remainder
 * ties are broken by shuffling the tied sets with `rng`. Keys are iterated in SETS order
 * (codes unknown to SETS after them, in insertion order) so the result does not depend
 * on the key order of `weights`. Every key is present in the result, zero included.
 * @returns {{[set: string]: number}}
 */
export function quotas(weights, n, rng = Math.random) {
  const rank = code => { const i = SETS.findIndex(s => s.code === code); return i === -1 ? SETS.length : i }
  const keys = Object.keys(weights)
    .map((code, order) => ({ code, order }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.order - b.order)
    .map(k => k.code)
  const total = keys.reduce((sum, k) => sum + weights[k], 0)
  const rows = keys.map(code => {
    const exact = total > 0 ? (n * weights[code]) / total : 0
    const base = Math.floor(exact)
    return { code, base, rem: exact - base }
  })
  let remaining = n - rows.reduce((sum, r) => sum + r.base, 0)
  // Group by remainder (desc), shuffle each tie group, then hand out the +1s in that order.
  const groups = new Map()
  for (const r of rows) {
    const key = r.rem.toFixed(9)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }
  const ordered = [...groups.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .flatMap(([, group]) => shuffle(group, rng))
  for (const r of ordered) {
    if (remaining <= 0) break
    r.base += 1
    remaining -= 1
  }
  return Object.fromEntries(rows.map(r => [r.code, r.base]))
}

function pickRandom(pool, rng = Math.random) {
  if (!pool.length) return null
  return pool[Math.floor(rng() * pool.length)]
}

/**
 * Generate all packs for a draft session.
 * @param {object[]} allCards - normalized card objects from fetchSet
 * @param {number} playerCount
 * @param {number} packsPerPlayer - typically 4
 * @returns {string[][]} array of packs, each pack is an array of card references
 */
function deduplicateByNameFaction(cards) {
  const seen = new Set()
  return cards.filter(c => {
    const key = `${c.name}__${c.faction}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Split a card list into the four draft pools (deduped, tokens excluded). */
function splitPools(allCards, includeHeroes) {
  const isDraftable = c => c.cardType !== 'TOKEN'
  const heroes  = includeHeroes
    ? deduplicateByNameFaction(allCards.filter(c => isDraftable(c) && c.cardType === 'HERO' && c.rarity !== 'U'))
    : []
  const commons = deduplicateByNameFaction(allCards.filter(c => isDraftable(c) && c.rarity === 'C' && c.cardType !== 'HERO'))
  const rares   = deduplicateByNameFaction(allCards.filter(c => isDraftable(c) && (c.rarity === 'R1' || c.rarity === 'R2' || c.rarity === 'EX')))
  const uniques = deduplicateByNameFaction(allCards.filter(c => isDraftable(c) && c.rarity === 'U'))
  return { heroes, commons, rares, uniques }
}

export function generateAllPacks(allCards, playerCount, packsPerPlayer = 4, options = {}) {
  const { includeHeroes = true, cubeMode = false, uniquePool = [], randomUniqueRate = 0, rng = Math.random } = options
  const { heroes, commons, rares, uniques } = splitPools(allCards, includeHeroes)

  const totalPacks = playerCount * packsPerPlayer

  if (cubeMode) {
    return generateCubePacks(heroes, commons, rares, uniques, totalPacks, includeHeroes, rng)
  }

  // "Add random uniques" mode draws the unique slot from an injected real-unique pool
  // (standard sets carry no uniques in the card data, so `uniques` is otherwise empty).
  const useUniques = randomUniqueRate > 0 && uniquePool.length ? uniquePool : uniques
  const usedUniques = new Set() // shared across packs so no unique serial repeats
  const packs = []
  for (let i = 0; i < totalPacks; i++) {
    packs.push(generateOnePack(heroes, commons, rares, useUniques, i, randomUniqueRate, rng, usedUniques))
  }
  return packs
}

/**
 * Chaos / mixed-booster draft: build single-set boosters per set according to
 * the requested counts, then shuffle ALL boosters together so they are dealt
 * out at random. Each booster follows normal composition (its own set only).
 * @param {Object<string, object[]>} cardsBySet - { setCode: normalized cards }
 * @param {Object<string, number>} packMix - { setCode: number of boosters }
 * @returns {string[][]} flat, shuffled array of packs
 */
export function generateChaosPacks(cardsBySet, packMix, options = {}) {
  const { includeHeroes = true, uniquesBySet = {}, randomUniqueRate = 0, rng = Math.random } = options
  const allPacks = []
  const usedUniques = new Set() // shared across every booster so no unique serial repeats
  for (const [setCode, count] of Object.entries(packMix)) {
    if (!count || count < 1) continue
    const cards = cardsBySet[setCode] ?? []
    if (!cards.length) continue
    const { heroes, commons, rares, uniques } = splitPools(cards, includeHeroes)
    const useUniques = randomUniqueRate > 0 && uniquesBySet[setCode]?.length ? uniquesBySet[setCode] : uniques
    for (let i = 0; i < count; i++) {
      allPacks.push(generateOnePack(heroes, commons, rares, useUniques, i, randomUniqueRate, rng, usedUniques))
    }
  }
  return shuffle(allPacks, rng)
}

/**
 * Structured multi-set draft (the "all players receive the same packs" mode): every
 * player drafts the SAME single-set boosters. `perPlayerMix` = how many packs of each
 * set ONE player gets (sum must = 4 → one set per round). Each round, ALL seats open
 * that round's set, so every player experiences an identical, set-pure draft. Returns
 * a flat array laid out BY ROUND (round r → indices r*playerCount … r*playerCount +
 * playerCount-1) to match buildInitialState's round layout. Boosters use normal
 * single-set composition (like generateChaosPacks) and are drawn randomly per pack, so
 * two seats' packs of the same set differ — they're just statistically equivalent.
 * @param {Object<string, object[]>} cardsBySet - { setCode: normalized cards }
 * @param {Object<string, number>} perPlayerMix - { setCode: packs per player }, sum = 4
 * @param {number} playerCount
 */
export function generateStructuredPacks(cardsBySet, perPlayerMix, playerCount, options = {}) {
  const { includeHeroes = true, uniquesBySet = {}, randomUniqueRate = 0, rng = Math.random } = options
  // Expand the per-player counts into one set per round: {CORE:2, BISE:2} → [CORE,CORE,BISE,BISE]
  const rounds = []
  for (const [setCode, count] of Object.entries(perPlayerMix)) {
    for (let i = 0; i < (count || 0); i++) rounds.push(setCode)
  }
  const poolsBySet = {}
  const packs = []
  const usedUniques = new Set() // shared across every booster so no unique serial repeats
  let packIndex = 0
  for (const setCode of rounds) {
    if (!poolsBySet[setCode]) poolsBySet[setCode] = splitPools(cardsBySet[setCode] ?? [], includeHeroes)
    const { heroes, commons, rares, uniques } = poolsBySet[setCode]
    const useUniques = randomUniqueRate > 0 && uniquesBySet[setCode]?.length ? uniquesBySet[setCode] : uniques
    for (let s = 0; s < playerCount; s++) {
      packs.push(generateOnePack(heroes, commons, rares, useUniques, packIndex++, randomUniqueRate, rng, usedUniques))
    }
  }
  return packs
}

/**
 * Cube DRAFT from a multiset of card OBJECTS (preserves duplicate copies — a cube
 * may intentionally run multiple copies of a card, so we do NOT dedupe). Deals
 * equal-size packs (unequal packs deadlock the pass-and-pick rotation); heroes are
 * not included here (this cube drafts them separately). 4 players → 16 packs of 12.
 * @param {object[]} cardObjects - normalized cards, with duplicates preserved
 * @param {number} totalPacks - players × 4
 */
export function generateCubeDraftPacks(cardObjects, totalPacks) {
  if (totalPacks < 1) return []
  const commons = shuffle(cardObjects.filter(c => c.rarity === 'C'))
  const uniques = shuffle(cardObjects.filter(c => c.rarity === 'U'))
  const rares   = shuffle(cardObjects.filter(c => c.rarity !== 'C' && c.rarity !== 'U')) // R1/R2/EX

  const perPack = Math.min(13, Math.floor(cardObjects.length / totalPacks))
  const totalSlots = perPack * totalPacks

  // Spread `count` items as evenly as possible across the packs (capped at `cap`).
  const spread = (count, cap) => {
    const use = Math.min(count, cap)
    const base = Math.floor(use / totalPacks), extra = use % totalPacks
    return Array.from({ length: totalPacks }, (_, i) => base + (i < extra ? 1 : 0))
  }
  // 1 (or more) unique per pack at the end, commons toward the front, rares fill
  // the middle. Counts are derived so every pack is exactly `perPack` cards (unequal
  // packs deadlock the pass rotation) and the rare pool always covers the remainder.
  const uCount = spread(uniques.length, totalSlots)
  const usedU = uCount.reduce((a, b) => a + b, 0)
  const cCount = spread(commons.length, totalSlots - usedU)

  let ci = 0, ri = 0, ui = 0
  const packs = []
  for (let i = 0; i < totalPacks; i++) {
    const nC = cCount[i], nU = uCount[i], nR = perPack - nC - nU
    const pack = []
    for (let k = 0; k < nC && ci < commons.length; k++) pack.push(commons[ci++].reference) // commons first
    for (let k = 0; k < nR && ri < rares.length;  k++) pack.push(rares[ri++].reference)    // rares middle
    for (let k = 0; k < nU && ui < uniques.length; k++) pack.push(uniques[ui++].reference)  // unique(s) last
    packs.push(pack)
  }
  return packs
}

/**
 * Cube DRAFT with a FIXED per-booster rarity recipe `{ commons, rares, uniques }`
 * (e.g. LuigiNico's: 3 commons + 8 rares + 1 unique = 12 cards). Every pack is the
 * same size (required by the pass rotation). Pools are drawn without replacement so
 * the cube's intentional duplicate rares are preserved; when a pool is exhausted it
 * is reshuffled and drawn again — so a scarce pool (the 27 commons) RECYCLES across
 * boosters to always hit the target. A card never repeats within a single booster.
 * Heroes are not included (drafted manually).
 * @param {object[]} cardObjects - normalized cards, duplicates preserved
 * @param {number} totalPacks - players × 4
 * @param {{commons:number, rares:number, uniques:number}} recipe
 */
export function generateCubeRecipePacks(cardObjects, totalPacks, recipe) {
  if (totalPacks < 1) return []
  const { commons = 0, rares = 0, uniques = 0 } = recipe
  const pools = {
    C: cardObjects.filter(c => c.rarity === 'C'),
    U: cardObjects.filter(c => c.rarity === 'U'),
    R: cardObjects.filter(c => c.rarity !== 'C' && c.rarity !== 'U'), // R1/R2/EX
  }
  // Returns draw(n): n distinct-by-ref refs, popped without replacement; the bag is
  // reshuffled from the full pool once emptied (that's how commons recycle).
  const makeDrawer = pool => {
    const cap = new Set(pool.map(c => c.reference)).size
    let bag = []
    return n => {
      const take = Math.min(n, cap)
      const out = [], used = new Set()
      while (out.length < take) {
        if (!bag.length) bag = shuffle(pool)
        let idx = bag.findIndex(c => !used.has(c.reference))
        if (idx === -1) { bag = shuffle(pool); idx = bag.findIndex(c => !used.has(c.reference)); if (idx === -1) break }
        const [c] = bag.splice(idx, 1)
        used.add(c.reference); out.push(c.reference)
      }
      return out
    }
  }
  const drawC = makeDrawer(pools.C), drawR = makeDrawer(pools.R), drawU = makeDrawer(pools.U)
  const packs = []
  for (let i = 0; i < totalPacks; i++) {
    packs.push([...drawC(commons), ...drawR(rares), ...drawU(uniques)])
  }
  return packs
}

/**
 * Deal one hero into each booster's FIRST slot, drawn from `heroRefs`. Used by
 * built-in hero-draft cube SEALED, which has no hero-draft phase: every booster
 * instead opens a hero the player can keep (like a real Altered booster). Heroes
 * are shuffled per call (so each player gets their own order) and assigned distinct
 * until the pool is exhausted, then repeated. Returns NEW packs (input untouched);
 * a no-op when heroRefs is empty, so non-hero-draft cubes are unaffected.
 * @param {string[][]} packs - packs of card references
 * @param {string[]} heroRefs - hero references to deal from
 */
export function dealHeroSlots(packs, heroRefs) {
  if (!heroRefs?.length) return packs
  const bag = shuffle([...new Set(heroRefs)])
  return packs.map((pack, i) => [bag[i % bag.length], ...pack])
}

/**
 * Cube mode: each card appears at most once across ALL packs, and EVERY pack is
 * the same size (critical — unequal packs deadlock the pass-and-pick rotation).
 *
 * The pool is curated and arbitrarily sized, so we don't force a fixed
 * common/rare structure (that depletes pools unevenly and breaks the draft).
 * Instead: deal 1 hero per pack when there are enough heroes for every pack,
 * then fill each pack with an equal number of body cards (commons/rares/uniques
 * shuffled together). Leftover cards are simply not used this draft.
 */
function generateCubePacks(heroes, commons, rares, uniques, totalPacks, includeHeroes, rng = Math.random) {
  if (totalPacks < 1) return []
  const heroPool = shuffle(includeHeroes ? heroes : [], rng)
  // Only dedicate a hero slot if there's one for every pack (keeps packs equal).
  const dedicatedHeroes = heroPool.length >= totalPacks
  const body = shuffle([
    ...(dedicatedHeroes ? [] : heroPool), // not enough heroes to slot → draft them as body
    ...commons, ...rares, ...uniques,
  ], rng)

  const heroPerPack = dedicatedHeroes ? 1 : 0
  // Cap pack size at 13 for huge cubes; otherwise split the body evenly.
  const bodyPerPack = Math.min(13 - heroPerPack, Math.floor(body.length / totalPacks))

  const packs = []
  let hIdx = 0, bIdx = 0
  for (let i = 0; i < totalPacks; i++) {
    const pack = []
    if (heroPerPack) pack.push(heroPool[hIdx++].reference)
    for (let s = 0; s < bodyPerPack; s++) pack.push(body[bIdx++].reference)
    packs.push(pack)
  }
  return packs
}

function generateOnePack(heroes, commons, rares, uniques, packIndex, randomUniqueRate = 0, rng = Math.random, usedUniques = new Set()) {
  const pack = []

  // 1 hero (only if heroes pool is non-empty)
  if (heroes.length) {
    const hero = pickRandom(heroes, rng)
    if (hero) pack.push(hero.reference)
  }

  // 8 commons: 1 per faction + 3 paired draws
  const commonsByFaction = {}
  for (const f of FACTIONS) {
    commonsByFaction[f] = commons.filter(c => c.faction === f)
  }

  const usedRefs = new Set(pack)

  // 9 commons: 1 per faction (6) + 3 paired draws (3) = 9
  for (const f of FACTIONS) {
    const pool = commonsByFaction[f].filter(c => !usedRefs.has(c.reference))
    const card = pickRandom(pool.length ? pool : commonsByFaction[f], rng)
    if (card) {
      pack.push(card.reference)
      usedRefs.add(card.reference)
    }
  }

  // 3 paired common draws
  const pairs = [['AX', 'BR'], ['LY', 'MU'], ['OR', 'YZ']]
  for (const [f1, f2] of pairs) {
    const faction = rng() < 0.5 ? f1 : f2
    const pool = commonsByFaction[faction].filter(c => !usedRefs.has(c.reference))
    const card = pickRandom(pool.length ? pool : commonsByFaction[faction], rng)
    if (card) {
      pack.push(card.reference)
      usedRefs.add(card.reference)
    }
  }

  // 3 rares — the LAST slot can become a unique. Default: deterministic 1-in-8 packs
  // (used by cube data that actually carries uniques). "Add random uniques" mode
  // (randomUniqueRate > 0) instead gives EACH pack an independent chance (1/6) of its
  // last slot being a real injected unique. If the pool can't supply a rare/unique for
  // a slot (e.g. an all-commons cube has none), backfill it with another unused common
  // so every booster stays full size (9 + 3 = 12 body cards).
  const uniquePack = randomUniqueRate > 0
    ? (uniques.length > 0 && rng() < randomUniqueRate)
    : (packIndex % 8 === 7)
  const shuffledRares = shuffle(rares, rng)
  const fillerCommons = shuffle(commons, rng)
  let rareIdx = 0
  let fillerIdx = 0

  for (let slot = 0; slot < 3; slot++) {
    if (slot === 2 && uniquePack && uniques.length) {
      // usedUniques is shared across ALL boosters in this pool, so a given unique serial
      // can appear at most once total (the pool is a small fetched sample, so drawing with
      // replacement per-pack could otherwise hand out the same unique twice).
      const uni = pickRandom(uniques.filter(c => !usedRefs.has(c.reference) && !usedUniques.has(c.reference)), rng)
      if (uni) {
        pack.push(uni.reference)
        usedRefs.add(uni.reference)
        usedUniques.add(uni.reference)
        continue
      }
    }
    while (rareIdx < shuffledRares.length && usedRefs.has(shuffledRares[rareIdx].reference)) {
      rareIdx++
    }
    if (rareIdx < shuffledRares.length) {
      pack.push(shuffledRares[rareIdx].reference)
      usedRefs.add(shuffledRares[rareIdx].reference)
      rareIdx++
      continue
    }
    // No rare available for this slot — backfill with an unused common.
    while (fillerIdx < fillerCommons.length && usedRefs.has(fillerCommons[fillerIdx].reference)) {
      fillerIdx++
    }
    if (fillerIdx < fillerCommons.length) {
      pack.push(fillerCommons[fillerIdx].reference)
      usedRefs.add(fillerCommons[fillerIdx].reference)
      fillerIdx++
    }
  }

  return pack
}

/**
 * Swap pre-picked unique refs into rare slots of `packs`, in place. Every booster ends
 * with 3 rare slots from index `rareStart`; shuffle all (booster, rareSlot) positions
 * with the SAME rng and take as many as there are uniques, so which packs/slots get one
 * is itself deterministic.
 */
function swapUniquesIntoRareSlots(packs, uniqueRefs, rng, rareStart) {
  const slotPositions = []
  for (let p = 0; p < packs.length; p++) {
    for (let s = 0; s < 3; s++) slotPositions.push([p, rareStart + s])
  }
  const chosen = shuffle(slotPositions, rng).slice(0, uniqueRefs.length)
  chosen.forEach(([packIdx, slotIdx], i) => {
    packs[packIdx][slotIdx] = uniqueRefs[i]
  })
}

/**
 * Tournament-safe SEALED pool: `boosters` single-set packs (normal composition — 1
 * hero + 9 commons + 3 rares, no unique slot of their own) generated with a SEEDED
 * `rng`, then exactly `uniqueRefs.length` pre-picked unique refs (see
 * uniqueFactionRanges.js's pickDeterministicUniques — kept as a separate concern:
 * this function only handles slot mechanics, not which uniques to draw) are swapped
 * into deterministically-chosen rare slots across the whole pool. Both pool
 * generation (`/api/sealed-seed`) and deck validation (`/api/validate-deck`) call this
 * with the SAME rng + the SAME uniqueRefs to reproduce an identical pool.
 * @param {object[]} cards - normalized cards for ONE set (fetchSet output)
 * @param {() => number} rng - seeded PRNG (see prng.js)
 * @param {{boosters?: number, uniqueRefs?: string[], includeHeroes?: boolean}} options
 */
export function generateTournamentSealedPool(cards, rng, options = {}) {
  const { boosters = 7, uniqueRefs = [], includeHeroes = true } = options
  const { heroes, commons, rares } = splitPools(cards, includeHeroes)
  const packs = []
  for (let i = 0; i < boosters; i++) {
    packs.push(generateOnePack(heroes, commons, rares, [], i, 0, rng))
  }
  if (!uniqueRefs.length) return packs

  swapUniquesIntoRareSlots(packs, uniqueRefs, rng, (heroes.length ? 1 : 0) + 9)
  return packs
}

/**
 * Mono-faction SEALED pool over several weighted sets: `boosters` boosters (hero? + 9
 * commons + 3 rares) holding only cards whose `faction` is `faction`, set shares fixed
 * EXACTLY by `quotas` (per rarity), then `uniqueRefs` swapped into rare slots. Pure and
 * seeded: rng order is hero labels, common labels, rare labels, boosters in order, unique
 * swap. Pools are deduplicated by name within a set, never across sets (reprints stay
 * distinct). A slot whose set is exhausted falls back to the other sets, then stays empty.
 * @param {{[set: string]: object[]}} cardsBySet - fetchSet output per set
 * @param {() => number} rng
 * @param {{faction: string, weights: {[set: string]: number}, boosters?: number, uniqueRefs?: string[], includeHeroes?: boolean}} options
 * @returns {string[][]}
 */
export function generateFactionSealedPool(cardsBySet, rng, options) {
  const { faction, weights, boosters = 7, uniqueRefs = [], includeHeroes = true } = options
  const rank = code => { const i = SETS.findIndex(s => s.code === code); return i === -1 ? SETS.length : i }
  const codes = Object.keys(weights)
    .filter(c => weights[c] > 0 && cardsBySet[c])
    .map((code, order) => ({ code, order }))
    .sort((a, b) => rank(a.code) - rank(b.code) || a.order - b.order)
    .map(k => k.code)
  const pools = {}
  for (const code of codes) {
    pools[code] = splitPools(cardsBySet[code].filter(c => c.faction === faction), true)
  }

  // Shuffled list of `slots` set labels, only over sets that have a card of that rarity.
  const labelsFor = (kind, slots) => {
    const w = {}
    for (const code of codes) if (pools[code][kind].length) w[code] = weights[code]
    if (!Object.keys(w).length) return []
    const q = quotas(w, slots, rng)
    return shuffle(Object.keys(q).flatMap(code => Array(q[code]).fill(code)), rng)
  }
  const heroLabels = includeHeroes ? labelsFor('heroes', boosters) : []
  const commonLabels = labelsFor('commons', 9 * boosters)
  const rareLabels = labelsFor('rares', 3 * boosters)

  // One draw: slot's set first, else the other sets, never padding with another rarity.
  const draw = (kind, label, taken) => {
    const free = code => pools[code][kind].filter(c => !taken.has(c.reference))
    const own = label ? pickRandom(free(label), rng) : null
    if (own) return own
    return pickRandom(codes.filter(c => c !== label).flatMap(free), rng)
  }

  const usedHeroes = new Set()
  const packs = []
  for (let b = 0; b < boosters; b++) {
    const pack = []
    const taken = new Set()
    if (includeHeroes) {
      let hero = draw('heroes', heroLabels[b], usedHeroes)
      if (!hero) {
        usedHeroes.clear() // every hero of the faction was dealt: repeat
        hero = draw('heroes', heroLabels[b], usedHeroes)
      }
      if (hero) { usedHeroes.add(hero.reference); pack.push(hero.reference) }
    }
    for (let i = 0; i < 9; i++) {
      const c = draw('commons', commonLabels[b * 9 + i], taken)
      if (c) { taken.add(c.reference); pack.push(c.reference) }
    }
    for (let i = 0; i < 3; i++) {
      const r = draw('rares', rareLabels[b * 3 + i], taken)
      if (r) { taken.add(r.reference); pack.push(r.reference) }
    }
    packs.push(pack)
  }
  if (uniqueRefs.length) swapUniquesIntoRareSlots(packs, uniqueRefs, rng, (includeHeroes ? 1 : 0) + 9)
  return packs
}

/**
 * Generate packs from a custom card pool (raw reference list).
 */
export function generatePacksFromPool(references, playerCount, packsPerPlayer = 4) {
  const totalPacks = playerCount * packsPerPlayer
  const shuffled = shuffle(references)
  const packSize = 12
  const packs = []

  for (let i = 0; i < totalPacks; i++) {
    const start = (i * packSize) % shuffled.length
    const pack = []
    for (let j = 0; j < packSize; j++) {
      pack.push(shuffled[(start + j) % shuffled.length])
    }
    packs.push(pack)
  }

  return packs
}
