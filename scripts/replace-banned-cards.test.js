import { describe, it, expect } from 'vitest'
import { planReplacements } from './replace-banned-cards.mjs'

const card = (reference, faction, rarity, cardType = 'PERMANENT') => ({ reference, name: reference, faction, rarity, cardType })

// Lyra Festival (banned): C and R1 are Lyra, R2 is Muna.
const CORE = [
  card('ALT_CORE_B_LY_29_C', 'LY', 'C'),
  card('ALT_CORE_B_LY_29_R1', 'LY', 'R1'),
  card('ALT_CORE_B_LY_29_R2', 'MU', 'R2'),
  card('ALT_CORE_B_LY_10_C', 'LY', 'C'),
  card('ALT_CORE_B_LY_11_C', 'LY', 'C'),
  card('ALT_CORE_B_LY_10_R1', 'LY', 'R1'),
  card('ALT_CORE_B_AX_12_R2', 'LY', 'R2'), // an out-of-faction rare whose real faction is Lyra
  card('ALT_CORE_B_MU_13_R1', 'MU', 'R1'),
  card('ALT_CORE_B_LY_14_R2', 'MU', 'R2'),
  card('ALT_CORE_B_MU_15_C', 'MU', 'C'),
  card('ALT_CORE_B_LY_01_C', 'LY', 'C', 'HERO'),
  card('ALT_CORE_B_BR_06_C', 'LY', 'C'), // banned family: never a replacement
]
const cardsBySet = { CORE }
const LY_COMMONS = ['ALT_CORE_B_LY_10_C', 'ALT_CORE_B_LY_11_C']
const LY_RARES = ['ALT_CORE_B_LY_10_R1', 'ALT_CORE_B_AX_12_R2']
const MU_RARES = ['ALT_CORE_B_MU_13_R1', 'ALT_CORE_B_LY_14_R2']

const pool = (id, boosters, extra = {}) => {
  const cards = {}
  for (const ref of [...boosters.flat(), ...Object.keys(extra).flatMap(r => Array(extra[r]).fill(r))]) cards[ref] = (cards[ref] ?? 0) + 1
  return { id, cards, boosters }
}

describe('planReplacements', () => {
  it('replaces each printing by the same rarity group and the real faction, in place', () => {
    const p = pool('p1', [['ALT_CORE_B_LY_29_C', 'ALT_CORE_B_MU_15_C'], ['ALT_CORE_B_LY_29_R1', 'ALT_CORE_B_LY_29_R2']])
    const plan = planReplacements(p, cardsBySet)
    expect(plan.unresolved).toEqual([])
    expect(plan.replacements.map(r => [r.booster, r.slot])).toEqual([[0, 0], [1, 0], [1, 1]])
    expect(LY_COMMONS).toContain(plan.boosters[0][0])
    expect(plan.boosters[0][1]).toBe('ALT_CORE_B_MU_15_C')
    expect(LY_RARES).toContain(plan.boosters[1][0])
    expect(MU_RARES).toContain(plan.boosters[1][1])
    // cards = the recount of the new boosters, the input left untouched
    const recount = {}
    for (const ref of plan.boosters.flat()) recount[ref] = (recount[ref] ?? 0) + 1
    expect(plan.cards).toEqual(recount)
    expect(p.boosters[0][0]).toBe('ALT_CORE_B_LY_29_C')
  })

  it('is deterministic per pool id and slot', () => {
    const boosters = Array.from({ length: 7 }, () => ['ALT_CORE_B_LY_29_C', 'ALT_CORE_B_LY_29_R1'])
    const a = planReplacements(pool('same', boosters), cardsBySet)
    expect(planReplacements(pool('same', boosters), cardsBySet)).toEqual(a)
    const draws = new Set(Array.from({ length: 20 }, (_, i) => planReplacements(pool(`p${i}`, boosters), cardsBySet).boosters.flat().join()))
    expect(draws.size).toBeGreaterThan(1)
  })

  it('never draws a hero or a banned card', () => {
    for (let i = 0; i < 50; i++) {
      const plan = planReplacements(pool(`p${i}`, [['ALT_CORE_B_LY_29_C']]), cardsBySet)
      expect(LY_COMMONS).toContain(plan.boosters[0][0])
    }
  })

  it('replaces copies held outside the boosters too', () => {
    const plan = planReplacements(pool('p', [['ALT_CORE_B_MU_15_C']], { ALT_CORE_B_LY_29_C: 2 }), cardsBySet)
    expect(plan.replacements).toHaveLength(2)
    expect(plan.replacements.every(r => r.booster === null)).toBe(true)
    expect(plan.cards.ALT_CORE_B_LY_29_C).toBeUndefined()
    expect(Object.values(plan.cards).reduce((a, b) => a + b, 0)).toBe(3)
  })

  it('reports a banned card it cannot replace instead of dropping it', () => {
    const plan = planReplacements(pool('p', [['ALT_CORE_B_LY_29_C']]), { CORE: [card('ALT_CORE_B_LY_29_C', 'LY', 'C')] })
    expect(plan.boosters[0][0]).toBe('ALT_CORE_B_LY_29_C')
    expect(plan.unresolved).toHaveLength(1)
    expect(planReplacements(pool('p', [['ALT_CORE_B_LY_29_C']]), {}).unresolved[0].reason).toMatch(/not found/)
  })

  it('leaves a clean pool unchanged', () => {
    const p = pool('p', [['ALT_CORE_B_MU_15_C']])
    expect(planReplacements(p, cardsBySet)).toEqual({ cards: p.cards, boosters: p.boosters, replacements: [], unresolved: [] })
  })
})
