import { describe, it, expect } from 'vitest'
import { buildWinstonState, applyWinstonAction } from './winstonLogic.js'

const config = { timerEnabled: false }
const players = [{ id: 'a' }, { id: 'b' }]

// A hand-built state bypasses buildWinstonState's shuffle, so pile/deck contents are
// fully controlled and every action's outcome is deterministic to assert on.
function fixedState(overrides = {}) {
  return {
    config, players,
    phase: 'winston',
    deck: ['d1', 'd2', 'd3'],
    piles: [['p0'], ['p1'], ['p2']],
    turn: 0,
    peekIndex: 0,
    picks: { '0': [], '1': [] },
    lastBlind: null,
    pickDeadline: null,
    version: 0,
    ...overrides,
  }
}

describe('buildWinstonState', () => {
  it('deals 3 one-card piles from the shuffled pool and keeps the rest as the deck', () => {
    const packs = [['a', 'b', 'c', 'd', 'e']]
    const state = buildWinstonState(config, players, packs)
    expect(state.phase).toBe('winston')
    expect(state.piles).toHaveLength(3)
    for (const p of state.piles) expect(p).toHaveLength(1)
    expect(state.deck).toHaveLength(2)
    expect(state.turn).toBe(0)
    expect(state.peekIndex).toBe(0)
    expect(state.picks).toEqual({ '0': [], '1': [] })
    // No card is lost or duplicated between piles + deck.
    const allCards = [...state.piles.flat(), ...state.deck]
    expect(allCards.sort()).toEqual(['a', 'b', 'c', 'd', 'e'].sort())
  })

  it('handles a pool smaller than 3 gracefully (some piles start empty)', () => {
    const state = buildWinstonState(config, players, [['a']])
    expect(state.piles.filter(p => p.length).length).toBe(1)
    expect(state.deck).toHaveLength(0)
  })

  it('draft heroMode: starts a finishing heroDraft phase before the winston board', () => {
    const state = buildWinstonState({ ...config, heroMode: 'draft' }, players, [['a', 'b']], ['H0', 'H1'])
    expect(state.phase).toBe('heroDraft')
    expect(state.heroStart).toBe('winston')
  })

  it('split heroMode: pre-deals heroes one-per-faction per seat with no heroDraft phase', () => {
    const heroPool = ['ALT_CORE_B_AX_01_C', 'ALT_CORE_B_AX_02_C', 'ALT_CORE_B_BR_01_C', 'ALT_CORE_B_BR_02_C']
    const state = buildWinstonState({ ...config, heroMode: 'split' }, players, [['a', 'b']], heroPool)
    expect(state.phase).toBe('winston') // no hero-draft pause
    expect(state.heroPicks['0']).toBeDefined()
    expect(state.heroPicks['1']).toBeDefined()
    expect([...state.heroPicks['0'], ...state.heroPicks['1']].sort()).toEqual([...heroPool].sort())
  })
})

describe('applyWinstonAction', () => {
  it('ignores an action from the seat that is not the active turn', () => {
    const state = fixedState()
    const next = applyWinstonAction(state, 1, 'take')
    expect(next).toBe(state)
  })

  it('ignores an action when the phase is not winston (e.g. still in heroDraft)', () => {
    const state = fixedState({ phase: 'heroDraft' })
    const next = applyWinstonAction(state, 0, 'take')
    expect(next).toBe(state)
  })

  it('take: adds the peeked pile to the pool, refills it from the deck, and passes the turn', () => {
    const state = fixedState()
    const next = applyWinstonAction(state, 0, 'take')
    expect(next.picks['0']).toEqual(['p0'])
    expect(next.piles[0]).toEqual(['d3']) // top of deck refills pile 0
    expect(next.deck).toEqual(['d1', 'd2'])
    expect(next.turn).toBe(1)
    expect(next.peekIndex).toBe(0)
  })

  it('take: an emptied pile with no deck left to refill from stays empty', () => {
    const state = fixedState({ deck: [] })
    const next = applyWinstonAction(state, 0, 'take')
    expect(next.piles[0]).toEqual([])
  })

  it('decline: grows the pile with a face-down card and moves to the next pile (same turn)', () => {
    const state = fixedState()
    const next = applyWinstonAction(state, 0, 'decline')
    expect(next.piles[0]).toEqual(['p0', 'd3']) // grew from the deck
    expect(next.deck).toEqual(['d1', 'd2'])
    expect(next.peekIndex).toBe(1)
    expect(next.turn).toBe(0) // still this player's turn
  })

  it('decline all three piles draws the top of the deck blind and passes the turn (when a card is left after growing all 3)', () => {
    // Growing piles 0, 1 & 2 each pops one deck card; a 4th card is what's left to draw blind.
    let state = fixedState({ deck: ['d1', 'd2', 'd3', 'd4'] })
    state = applyWinstonAction(state, 0, 'decline') // pile 0 -> peek 1 (pops d4)
    state = applyWinstonAction(state, 0, 'decline') // pile 1 -> peek 2 (pops d3)
    state = applyWinstonAction(state, 0, 'decline') // pile 2 grows (pops d2), then draws d1 blind
    expect(state.picks['0']).toEqual(['d1'])
    expect(state.lastBlind).toEqual({ seat: 0, ref: 'd1' })
    expect(state.turn).toBe(1)
    expect(state.peekIndex).toBe(0)
    expect(state.deck).toEqual([])
  })

  it('declining the 3rd pile with only exactly enough deck to grow it draws no blind card', () => {
    // Only 3 deck cards: each decline pops one to grow a pile, leaving nothing for a 4th (blind) draw.
    let state = fixedState({ deck: ['d1', 'd2', 'd3'] })
    state = applyWinstonAction(state, 0, 'decline')
    state = applyWinstonAction(state, 0, 'decline')
    state = applyWinstonAction(state, 0, 'decline')
    expect(state.picks['0']).toEqual([])
    expect(state.deck).toEqual([])
    expect(state.turn).toBe(1)
  })

  it('preserves the OTHER seat\'s lastBlind highlight while that seat is still waiting', () => {
    const state = fixedState({ lastBlind: { seat: 1, ref: 'old' } })
    const next = applyWinstonAction(state, 0, 'take') // seat 0 acts, seat 1's highlight isn't theirs
    expect(next.lastBlind).toEqual({ seat: 1, ref: 'old' })
  })

  it('clears a seat\'s own lastBlind highlight once they act again', () => {
    const state = fixedState({ turn: 1, lastBlind: { seat: 1, ref: 'old' } })
    const next = applyWinstonAction(state, 1, 'take')
    expect(next.lastBlind).toBeNull()
  })

  it('when the deck is empty, decline skips to the next non-empty pile instead of growing anything', () => {
    const state = fixedState({ deck: [], piles: [['p0'], [], ['p2']], peekIndex: 0 })
    const next = applyWinstonAction(state, 0, 'decline')
    expect(next.peekIndex).toBe(2) // skipped the empty pile 1
    expect(next.turn).toBe(0) // still the same turn, just looking at a different pile
  })

  it('when the deck is empty and no other pile has cards, the player is forced to take the current pile', () => {
    const state = fixedState({ deck: [], piles: [['p0'], [], []], peekIndex: 0 })
    const next = applyWinstonAction(state, 0, 'decline')
    expect(next.picks['0']).toEqual(['p0'])
    expect(next.piles[0]).toEqual([])
    expect(next.turn).toBe(1)
  })

  it('finishes the draft once the deck and every pile are empty', () => {
    const state = fixedState({ deck: [], piles: [['p0'], [], []], peekIndex: 0 })
    const next = applyWinstonAction(state, 0, 'take')
    expect(next.phase).toBe('done')
    expect(next.pickDeadline).toBeNull()
  })

  it('normalizes peekIndex forward when the current pile was already emptied (post deck-exhaustion)', () => {
    const state = fixedState({ deck: [], piles: [[], ['p1'], ['p2']], peekIndex: 0 })
    const next = applyWinstonAction(state, 0, 'take')
    expect(next.picks['0']).toEqual(['p1']) // jumped forward to the first non-empty pile
  })
})
