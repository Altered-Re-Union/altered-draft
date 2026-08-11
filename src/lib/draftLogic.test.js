import { describe, it, expect } from 'vitest'
import {
  passDirection, rotatePacks, applyPick, heroOrderFor, heroTargetFor,
  applyHeroPick, allPlayerIndices, buildInitialState, buildDraftState,
} from './draftLogic.js'

// Every generated pack must be the SAME size across the round (real sets always yield
// 13-card packs) — build simple, all-equal test packs.
function pack(label, size = 3) {
  return Array.from({ length: size }, (_, i) => `${label}_${i}`)
}

describe('passDirection', () => {
  it('rounds 1 & 3 pass left, rounds 2 & 4 pass right', () => {
    expect(passDirection(1)).toBe('left')
    expect(passDirection(2)).toBe('right')
    expect(passDirection(3)).toBe('left')
    expect(passDirection(4)).toBe('right')
  })
})

describe('rotatePacks', () => {
  it('passing left: player i receives from player i+1 (wrapping)', () => {
    const packs = { 0: pack('P0'), 1: pack('P1'), 2: pack('P2') }
    const rotated = rotatePacks(packs, 3, 1) // round 1 -> left
    expect(rotated['0']).toBe(packs['1'])
    expect(rotated['1']).toBe(packs['2'])
    expect(rotated['2']).toBe(packs['0'])
  })

  it('passing right: player i receives from player i-1 (wrapping)', () => {
    const packs = { 0: pack('P0'), 1: pack('P1'), 2: pack('P2') }
    const rotated = rotatePacks(packs, 3, 2) // round 2 -> right
    expect(rotated['0']).toBe(packs['2'])
    expect(rotated['1']).toBe(packs['0'])
    expect(rotated['2']).toBe(packs['1'])
  })
})

describe('allPlayerIndices', () => {
  it('builds [0..count-1]', () => {
    expect(allPlayerIndices(4)).toEqual([0, 1, 2, 3])
  })
})

describe('buildInitialState', () => {
  const config = { timerEnabled: false }
  const players = [{ id: 'a' }, { id: 'b' }]

  it('lays out round 1 packs per player and stashes rounds 2-4 in remainingPacks', () => {
    const allPacks = [pack('r1p0'), pack('r1p1'), pack('r2p0'), pack('r2p1'), pack('r3p0'), pack('r3p1'), pack('r4p0'), pack('r4p1')]
    const state = buildInitialState(config, players, allPacks)

    expect(state.round).toBe(1)
    expect(state.phase).toBe('drafting')
    expect(state.version).toBe(0)
    expect(state.packs).toEqual({ '0': allPacks[0], '1': allPacks[1] })
    expect(state.picks).toEqual({ '0': [], '1': [] })
    expect(state.waitingFor).toEqual([0, 1])
    expect(state.remainingPacks).toEqual([
      { '0': allPacks[2], '1': allPacks[3] },
      { '0': allPacks[4], '1': allPacks[5] },
      { '0': allPacks[6], '1': allPacks[7] },
    ])
  })

  it('attaches an optional shared heroPool with a computed heroTarget capped at 4 rounds', () => {
    const allPacks = Array.from({ length: 8 }, (_, i) => pack(`p${i}`))
    const heroPool = ['H0', 'H1', 'H2', 'H3', 'H4', 'H5']
    const state = buildInitialState(config, players, allPacks, heroPool)
    expect(state.heroPool).toBe(heroPool)
    // heroTargetFor(config, 6, 2, 4) = min(3, floor(6/2)=3, 4) = 3
    expect(state.heroTarget).toBe(3)
    expect(state.heroPassesDone).toBe(0)
    expect(state.heroPicks).toEqual({ '0': [], '1': [] })
  })
})

describe('applyPick', () => {
  const config = { timerEnabled: false }
  const players = [{ id: 'a' }, { id: 'b' }]

  it('ignores a stale pick (card no longer in the pack) and returns the same state', () => {
    const state = buildInitialState(config, players, [pack('a', 2), pack('b', 2)])
    const next = applyPick(state, 0, 'not-in-pack')
    expect(next).toBe(state)
  })

  it('moves the card from pack to picks and removes the player from waitingFor', () => {
    const state = buildInitialState(config, players, [pack('a', 2), pack('b', 2)])
    const ref = state.packs['0'][0]
    const next = applyPick(state, 0, ref)
    expect(next.picks['0']).toEqual([ref])
    expect(next.packs['0']).not.toContain(ref)
    expect(next.waitingFor).toEqual([1])
  })

  it('rotates packs once every player has picked (packs still non-empty)', () => {
    let state = buildInitialState(config, players, [pack('a', 2), pack('b', 2)])
    const refA = state.packs['0'][0]
    const refB = state.packs['1'][0]
    state = applyPick(state, 0, refA)
    state = applyPick(state, 1, refB)
    // Round 1 passes left: player 0 now holds what remained of player 1's pack.
    expect(state.round).toBe(1)
    expect(state.waitingFor).toEqual([0, 1])
    expect(state.packs['0']).toHaveLength(1)
    expect(state.packs['1']).toHaveLength(1)
  })

  it('advances to the next round once every pack in the round empties', () => {
    let state = buildInitialState(config, players, [
      pack('r1a', 1), pack('r1b', 1),
      pack('r2a', 1), pack('r2b', 1),
      pack('r3a', 1), pack('r3b', 1),
      pack('r4a', 1), pack('r4b', 1),
    ])
    const refA = state.packs['0'][0]
    const refB = state.packs['1'][0]
    state = applyPick(state, 0, refA)
    state = applyPick(state, 1, refB)

    expect(state.round).toBe(2)
    expect(state.packs).toEqual({ '0': ['r2a_0'], '1': ['r2b_0'] })
    expect(state.waitingFor).toEqual([0, 1])
    expect(state.remainingPacks).toHaveLength(2)
  })

  it('finishes the draft after round 4 empties', () => {
    let state = buildInitialState(config, players, [
      pack('r1a', 1), pack('r1b', 1),
      pack('r2a', 1), pack('r2b', 1),
      pack('r3a', 1), pack('r3b', 1),
      pack('r4a', 1), pack('r4b', 1),
    ])
    for (let round = 0; round < 4; round++) {
      const refA = state.packs['0'][0]
      const refB = state.packs['1'][0]
      state = applyPick(state, 0, refA)
      state = applyPick(state, 1, refB)
    }
    expect(state.phase).toBe('done')
  })

  it('pauses into a heroDraft phase after a round when a shared hero pool needs drafting', () => {
    const heroPool = ['H0', 'H1']
    let state = buildInitialState(config, players, [
      pack('r1a', 1), pack('r1b', 1),
      pack('r2a', 1), pack('r2b', 1),
    ], heroPool)
    const refA = state.packs['0'][0]
    const refB = state.packs['1'][0]
    state = applyPick(state, 0, refA)
    state = applyPick(state, 1, refB)

    expect(state.phase).toBe('heroDraft')
    expect(state.heroOrder).toEqual(heroOrderFor(2, 0))
    expect(state.heroTurnPos).toBe(0)
    // The card round is preserved so it can resume after the hero pass.
    expect(state.round).toBe(1)
  })
})

describe('heroOrderFor', () => {
  it('is seat order on even passes, reversed on odd passes', () => {
    expect(heroOrderFor(4, 0)).toEqual([0, 1, 2, 3])
    expect(heroOrderFor(4, 1)).toEqual([3, 2, 1, 0])
    expect(heroOrderFor(4, 2)).toEqual([0, 1, 2, 3])
  })
})

describe('heroTargetFor', () => {
  it('defaults to min(3, floor(pool/players))', () => {
    expect(heroTargetFor({}, 12, 4)).toBe(3)
    expect(heroTargetFor({}, 4, 4)).toBe(1)
  })

  it('honors an explicit config.heroCount, clamped to the pool and cap', () => {
    expect(heroTargetFor({ heroCount: 2 }, 12, 4)).toBe(2)
    expect(heroTargetFor({ heroCount: 10 }, 12, 4)).toBe(3) // clamped to floor(12/4)
    expect(heroTargetFor({ heroCount: 10 }, 40, 4, 2)).toBe(2) // clamped to the cap
  })

  it('never returns less than 1', () => {
    expect(heroTargetFor({ heroCount: 0 }, 12, 4)).toBe(1)
  })
})

describe('applyHeroPick', () => {
  const config = { timerEnabled: false }
  const players = [{ id: 'a' }, { id: 'b' }]

  function heroDraftState() {
    return {
      config, players,
      phase: 'heroDraft',
      heroPool: ['H0', 'H1', 'H2', 'H3'],
      heroTarget: 1,
      heroPassesDone: 0,
      heroOrder: [0, 1],
      heroTurnPos: 0,
      heroPicks: { '0': [], '1': [] },
      picks: { '0': [], '1': [] },
      round: 1,
      remainingPacks: [{ '0': ['x'], '1': ['y'] }],
    }
  }

  it('rejects a pick from a player who is not up', () => {
    const state = heroDraftState()
    const next = applyHeroPick(state, 1, 'H0') // seat 0 is up, not 1
    expect(next).toBe(state)
  })

  it('rejects a stale hero pick (no longer in the pool)', () => {
    const state = heroDraftState()
    const next = applyHeroPick(state, 0, 'NOT_IN_POOL')
    expect(next).toBe(state)
  })

  it('advances turnPos within the same snake pass', () => {
    const state = heroDraftState()
    const next = applyHeroPick(state, 0, 'H0')
    expect(next.heroTurnPos).toBe(1)
    expect(next.heroPicks['0']).toEqual(['H0'])
    expect(next.heroPool).not.toContain('H0')
  })

  it('resumes the card draft at the next round once the pass completes and heroTarget is met', () => {
    let state = heroDraftState()
    state = applyHeroPick(state, 0, 'H0')
    state = applyHeroPick(state, 1, 'H1')
    expect(state.phase).toBe('drafting')
    expect(state.round).toBe(2)
    expect(state.heroPassesDone).toBe(1)
    expect(state.packs).toEqual({ '0': ['x'], '1': ['y'] })
  })

  it('finishes the draft (no more rounds) once round >= 4 and the hero pass completes', () => {
    let state = { ...heroDraftState(), round: 4 }
    state = applyHeroPick(state, 0, 'H0')
    state = applyHeroPick(state, 1, 'H1')
    expect(state.phase).toBe('done')
  })

  it('booster mode always resumes cards after one pass; the NEXT round re-pauses if heroTarget is still unmet', () => {
    // Booster's hero draft is interleaved one-pass-per-round: applyHeroPick itself doesn't
    // check heroesDone (that's capped at 4 rounds by buildInitialState) — the pause/resume
    // decision for pass #2 happens in applyPick, when the resumed round's packs empty again.
    let state = {
      ...heroDraftState(),
      heroTarget: 2,
      remainingPacks: [{ '0': ['x'], '1': ['y'] }, {}],
    }
    state = applyHeroPick(state, 0, 'H0')
    state = applyHeroPick(state, 1, 'H1')
    expect(state.phase).toBe('drafting')
    expect(state.heroPassesDone).toBe(1)
    expect(state.round).toBe(2)

    // Now finish round 2's (single-card) packs — heroPassesDone(1) < heroTarget(2), so
    // applyPick pauses into another hero pass instead of advancing to round 3.
    state = applyPick(state, 0, 'x')
    state = applyPick(state, 1, 'y')
    expect(state.phase).toBe('heroDraft')
    expect(state.heroOrder).toEqual(heroOrderFor(2, 1)) // reversed on this (odd) pass
    expect(state.round).toBe(2) // card round preserved, to resume after the pass
  })
})

describe('buildDraftState (format dispatch)', () => {
  const config = { timerEnabled: false }
  const players = [{ id: 'a' }, { id: 'b' }]
  const allPacks = [pack('a', 4), pack('b', 4)]

  it('defaults to booster (buildInitialState)', () => {
    expect(buildDraftState(config, players, allPacks).phase).toBe('drafting')
  })

  it('dispatches to rochester', () => {
    expect(buildDraftState({ ...config, draftFormat: 'rochester' }, players, allPacks).phase).toBe('rochester')
  })

  it('dispatches to rotisserie', () => {
    expect(buildDraftState({ ...config, draftFormat: 'rotisserie' }, players, allPacks).phase).toBe('rotisserie')
  })

  it('dispatches to winston', () => {
    expect(buildDraftState({ ...config, draftFormat: 'winston' }, players, allPacks).phase).toBe('winston')
  })
})
