import { FACTIONS } from './cardData.js'
// `with { type: 'json' }`: required by plain Node's ESM loader (the AlteredOps Docker
// deployment runs `node server/index.js` directly, unlike Vercel/Vite which bundle and
// don't enforce this) — also understood by Vite/esbuild, so this works everywhere.
import CORE from './data/factionRanges/CORE.json' with { type: 'json' }
import COREKS from './data/factionRanges/COREKS.json' with { type: 'json' }
import ALIZE from './data/factionRanges/ALIZE.json' with { type: 'json' }
import BISE from './data/factionRanges/BISE.json' with { type: 'json' }
import CYCLONE from './data/factionRanges/CYCLONE.json' with { type: 'json' }
import DUSTER from './data/factionRanges/DUSTER.json' with { type: 'json' }
import EOLE from './data/factionRanges/EOLE.json' with { type: 'json' }

// Per-set data extracted from `faction_ranges_<SET>.csv` (real production data): for
// each `family_id` (a specific rare card slot), the serial range 1..N crafted total is
// split into non-contiguous windows between its home faction and exactly one
// out-of-faction (OOF) pairing — verified against every set (no gaps, no overlaps; a
// handful of CYCLONE families have only 1 faction, i.e. no OOF pairing at all, which
// is handled gracefully below). The OOF pairing is per-card, NOT a fixed axis (unlike
// the common-pack AX|BR / LY|MU / OR|YZ scheme), which is exactly why this table has
// to come from data. Verified live against cards.alteredcore.org: a serial's real
// `mainFaction` matches whichever window it falls in — ref = `ALT_<SET>_B_<family>_U_<serial>`.
// FUGUE has no CSV yet (unreleased at data-pull time).
const FACTION_RANGES_BY_SET = { CORE, COREKS, ALIZE, BISE, CYCLONE, DUSTER, EOLE }

function windowsTotal(windows) {
  return windows.reduce((sum, [s, e]) => sum + (e - s + 1), 0)
}

// Uniform draw of one serial across all of a faction's windows for a family, weighted
// by window size (so a family/faction with more crafted copies is proportionally more
// likely to come up — mirrors drawing from the real, uneven population of uniques).
function pickSerialInWindows(windows, rng) {
  const total = windowsTotal(windows)
  let idx = Math.floor(rng() * total)
  for (const [s, e] of windows) {
    const size = e - s + 1
    if (idx < size) return s + idx
    idx -= size
  }
  return windows[windows.length - 1][1] // unreachable in practice
}

// All (family, faction) pairs available for a set, optionally restricted to one target
// faction. Each candidate is weighted by its actual serial count.
function buildCandidates(rangesForSet, targetFaction) {
  const candidates = []
  for (const [family, factions] of Object.entries(rangesForSet)) {
    for (const [faction, windows] of Object.entries(factions)) {
      if (targetFaction && faction !== targetFaction) continue
      candidates.push({ family, faction, windows, weight: windowsTotal(windows) })
    }
  }
  return candidates
}

function pickWeighted(candidates, rng) {
  const total = candidates.reduce((s, c) => s + c.weight, 0)
  let idx = rng() * total
  for (const c of candidates) {
    if (idx < c.weight) return c
    idx -= c.weight
  }
  return candidates[candidates.length - 1]
}

function localShuffle(arr, rng) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Round-robins the 6 factions to build `count` targets, reshuffling each full lap —
// so with count > 6 (e.g. 12), every faction appears exactly twice, but WHICH factions
// get an extra copy on a partial final lap is still randomized (not just "first N").
function evenFactionTargets(rng, count) {
  const laps = Math.ceil(count / FACTIONS.length)
  const seq = []
  for (let lap = 0; lap < laps; lap++) seq.push(...localShuffle(FACTIONS, rng))
  return seq.slice(0, count)
}

/**
 * Deterministically draw `uniqueCount` unique card refs for `setCode`, using the
 * per-family faction-window tables above. Same `rng` (a seeded PRNG, see prng.js) in,
 * same refs out — both tournament pool generation and deck validation call this
 * identically, so the pool is always reproducible.
 * @param {string} setCode - e.g. 'EOLE'
 * @param {() => number} rng - `() => float in [0,1)`, e.g. from prng.js's seededRng()
 * @param {{uniqueCount?: number, evenFactions?: boolean}} options
 *   - evenFactions: true round-robins target factions (wraps past 6, e.g. {12, true} = 2/faction).
 *     false draws freely across the whole combinatorial space, faction unconstrained.
 * @returns {string[]} unique card references
 */
export function pickDeterministicUniques(setCode, rng, { uniqueCount = 0, evenFactions = false } = {}) {
  const rangesForSet = FACTION_RANGES_BY_SET[setCode]
  if (!rangesForSet || uniqueCount <= 0) return []

  const seen = new Set()
  const refs = []
  const targets = evenFactions ? evenFactionTargets(rng, uniqueCount) : Array(uniqueCount).fill(null)

  for (const target of targets) {
    const candidates = buildCandidates(rangesForSet, target)
    if (!candidates.length) continue
    // Retry on the (astronomically unlikely) chance of drawing a serial already picked.
    for (let attempt = 0; attempt < 10; attempt++) {
      const { family, faction, windows } = pickWeighted(candidates, rng)
      const serial = pickSerialInWindows(windows, rng)
      const ref = `ALT_${setCode}_B_${family}_U_${serial}`
      if (!seen.has(ref)) {
        seen.add(ref)
        refs.push(ref)
        break
      }
    }
  }
  return refs
}
