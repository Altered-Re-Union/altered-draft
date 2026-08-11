import { describe, it, expect } from 'vitest'
import { rochesterOrder, buildRochesterState, applyRochesterPick } from './rochesterLogic.js'

describe('rochesterOrder', () => {
  it('snakes forward then backward, starting at the given opener', () => {
    // 3 players, opener 1: forward pass [1,2,0], backward [0,2,1], forward [1,2,0]...
    expect(rochesterOrder(3, 8, 1)).toEqual([1, 2, 0, 0, 2, 1, 1, 2])
  })

  it('defaults opener to seat 0', () => {
    expect(rochesterOrder(2, 4)).toEqual([0, 1, 1, 0])
  })

  it('truncates to exactly `length` picks', () => {
    expect(rochesterOrder(4, 2, 0)).toEqual([0, 1])
  })
})

describe('buildRochesterState', () => {
  const config = { timerEnabled: false }
  const players = [{ id: 'a' }, { id: 'b' }]

  it('opens the first pack and queues the rest, filtering out empty packs', () => {
    const packs = [['a', 'b'], [], ['c', 'd', 'e']]
    const state = buildRochesterState(config, players, packs)
    expect(state.phase).toBe('rochester')
    expect(state.activePack).toEqual(['a', 'b'])
    expect(state.packQueue).toEqual([['c', 'd', 'e']])
    expect(state.totalPacks).toBe(2)
    expect(state.packNum).toBe(1)
    expect(state.pickOrder).toEqual(rochesterOrder(2, 2, 0))
    expect(state.version).toBe(0)
  })

  it('starts a finishing heroDraft phase first when a shared heroPool is given', () => {
    const state = buildRochesterState(config, players, [['a', 'b']], ['H0', 'H1'])
    expect(state.phase).toBe('heroDraft')
    expect(state.heroStart).toBe('rochester')
    expect(state.heroPool).toEqual(['H0', 'H1'])
  })
})

describe('applyRochesterPick', () => {
  const config = { timerEnabled: false }
  const players = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('rejects a pick from a seat that is not up', () => {
    const state = buildRochesterState(config, players, [['a', 'b', 'c']])
    const next = applyRochesterPick(state, 1, 'a') // seat 0 is up first
    expect(next).toBe(state)
  })

  it('rejects a stale pick (card no longer in the active pack)', () => {
    const state = buildRochesterState(config, players, [['a', 'b', 'c']])
    const next = applyRochesterPick(state, 0, 'not-there')
    expect(next).toBe(state)
  })

  it('advances the snake within a pack', () => {
    const state = buildRochesterState(config, players, [['a', 'b', 'c']])
    const next = applyRochesterPick(state, 0, 'a')
    expect(next.picks['0']).toEqual(['a'])
    expect(next.activePack).toEqual(['b', 'c'])
    expect(next.turnPos).toBe(1)
  })

  it('opens the next pack (rotating the opener) once the active pack empties', () => {
    let state = buildRochesterState(config, players, [['a'], ['b', 'c', 'd']])
    state = applyRochesterPick(state, 0, 'a') // only card, pack empties
    expect(state.activePack).toEqual(['b', 'c', 'd'])
    expect(state.packQueue).toEqual([])
    expect(state.opener).toBe(1)
    expect(state.packNum).toBe(2)
    expect(state.pickOrder).toEqual(rochesterOrder(3, 3, 1))
    expect(state.turnPos).toBe(0)
  })

  it('finishes the draft once every pack has been drafted', () => {
    let state = buildRochesterState(config, players, [['a']])
    state = applyRochesterPick(state, 0, 'a')
    expect(state.phase).toBe('done')
    expect(state.pickDeadline).toBeNull()
  })

  it('plays a full 2-player pack end to end in snake order', () => {
    let state = buildRochesterState({ timerEnabled: false }, [{ id: 'a' }, { id: 'b' }], [['x', 'y', 'z', 'w']])
    // order for length 4, opener 0: forward [0,1], backward [1,0] -> [0,1,1,0]
    state = applyRochesterPick(state, 0, 'x')
    state = applyRochesterPick(state, 1, 'y')
    state = applyRochesterPick(state, 1, 'z')
    state = applyRochesterPick(state, 0, 'w')
    expect(state.picks).toEqual({ '0': ['x', 'w'], '1': ['y', 'z'] })
    expect(state.phase).toBe('done')
  })
})
