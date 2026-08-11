import { describe, it, expect } from 'vitest'
import { pickDeterministicUniques } from './uniqueFactionRanges.js'
import { mulberry32 } from './prng.js'
import CORE from './data/factionRanges/CORE.json' with { type: 'json' }

const REF_RE = /^ALT_CORE_B_([A-Z0-9_]+)_U_(\d+)$/

describe('pickDeterministicUniques', () => {
  it('returns [] for an unknown set code', () => {
    expect(pickDeterministicUniques('NOT_A_SET', mulberry32(1), { uniqueCount: 5 })).toEqual([])
  })

  it('returns [] when uniqueCount is 0 or negative', () => {
    expect(pickDeterministicUniques('CORE', mulberry32(1), { uniqueCount: 0 })).toEqual([])
    expect(pickDeterministicUniques('CORE', mulberry32(1), { uniqueCount: -3 })).toEqual([])
  })

  it('is fully deterministic: the same seed produces the same refs, in the same order', () => {
    const a = pickDeterministicUniques('CORE', mulberry32(777), { uniqueCount: 10 })
    const b = pickDeterministicUniques('CORE', mulberry32(777), { uniqueCount: 10 })
    expect(a).toEqual(b)
  })

  it('different seeds produce different draws', () => {
    const a = pickDeterministicUniques('CORE', mulberry32(1), { uniqueCount: 10 })
    const b = pickDeterministicUniques('CORE', mulberry32(2), { uniqueCount: 10 })
    expect(a).not.toEqual(b)
  })

  it('produces well-formed, non-repeating refs matching a real family+serial from the CORE table', () => {
    const refs = pickDeterministicUniques('CORE', mulberry32(42), { uniqueCount: 15 })
    expect(refs).toHaveLength(15)
    expect(new Set(refs).size).toBe(15) // no duplicate serials

    for (const ref of refs) {
      const m = ref.match(REF_RE)
      expect(m).not.toBeNull()
      const [, family, serialStr] = m
      const serial = Number(serialStr)
      expect(CORE).toHaveProperty(family)
      // The serial must fall inside SOME window of SOME faction for that family.
      const windows = Object.values(CORE[family]).flat()
      const inRange = windows.some(([s, e]) => serial >= s && serial <= e)
      expect(inRange).toBe(true)
    }
  })

  it('evenFactions spreads targets round-robin across all 6 factions (2 full laps at count=12)', () => {
    const refs = pickDeterministicUniques('CORE', mulberry32(99), { uniqueCount: 12, evenFactions: true })
    expect(refs).toHaveLength(12)

    const factionCounts = {}
    for (const ref of refs) {
      const [, family, serialStr] = ref.match(REF_RE)
      const serial = Number(serialStr)
      const factions = CORE[family]
      // Recover which faction's window the serial landed in — with evenFactions, candidates
      // were restricted to a single target faction, so exactly one faction's windows match.
      const matches = Object.entries(factions).filter(([, windows]) => windows.some(([s, e]) => serial >= s && serial <= e))
      expect(matches).toHaveLength(1)
      const [faction] = matches[0]
      factionCounts[faction] = (factionCounts[faction] ?? 0) + 1
    }

    expect(Object.keys(factionCounts).sort()).toEqual(['AX', 'BR', 'LY', 'MU', 'OR', 'YZ'])
    expect(Object.values(factionCounts).every(v => v === 2)).toBe(true)
  })
})
