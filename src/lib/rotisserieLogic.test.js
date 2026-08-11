import { describe, it, expect } from 'vitest'
import { buildRotisserieState, applyRotisseriePick } from './rotisserieLogic.js'
import { rochesterOrder } from './rochesterLogic.js'

describe('buildRotisserieState', () => {
  const config = { timerEnabled: false }
  const players = [{ id: 'a' }, { id: 'b' }]

  it('flattens all packs into one face-up pool and computes a per-player target', () => {
    const packs = [['a', 'b', 'c'], ['d', 'e', 'f']] // 6 cards, 2 players -> target 3
    const state = buildRotisserieState(config, players, packs)
    expect(state.phase).toBe('rotisserie')
    expect(state.pool).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(state.target).toBe(3)
    expect(state.pickOrder).toEqual(rochesterOrder(2, 6, 0))
    expect(state.version).toBe(0)
  })

  it('caps the per-player target at 45', () => {
    const bigPool = Array.from({ length: 200 }, (_, i) => `c${i}`)
    const state = buildRotisserieState(config, players, [bigPool])
    expect(state.target).toBe(45)
  })

  it('never drops below a target of 1 even with a tiny pool', () => {
    const state = buildRotisserieState({ ...config }, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], [['only-one']])
    expect(state.target).toBe(1)
  })

  it('starts a finishing heroDraft phase first when a shared heroPool is given', () => {
    const state = buildRotisserieState(config, players, [['a', 'b']], ['H0', 'H1'])
    expect(state.phase).toBe('heroDraft')
    expect(state.heroStart).toBe('rotisserie')
  })
})

describe('applyRotisseriePick', () => {
  const config = { timerEnabled: false }
  const players = [{ id: 'a' }, { id: 'b' }]

  it('rejects a pick from a seat that is not up', () => {
    const state = buildRotisserieState(config, players, [['a', 'b', 'c', 'd']])
    const next = applyRotisseriePick(state, 1, 'a')
    expect(next).toBe(state)
  })

  it('rejects a stale pick (card no longer in the pool)', () => {
    const state = buildRotisserieState(config, players, [['a', 'b', 'c', 'd']])
    const next = applyRotisseriePick(state, 0, 'not-there')
    expect(next).toBe(state)
  })

  it('removes one copy and advances the snake', () => {
    const state = buildRotisserieState(config, players, [['a', 'a', 'b', 'c']]) // target = 2
    const next = applyRotisseriePick(state, 0, 'a')
    expect(next.pool).toEqual(['a', 'b', 'c']) // only one copy removed
    expect(next.picks['0']).toEqual(['a'])
    expect(next.turnPos).toBe(1)
  })

  it('finishes once the snake order is exhausted (each player has `target` cards)', () => {
    let state = buildRotisserieState(config, players, [['a', 'b', 'c', 'd']]) // target=2, order [0,1,1,0]
    state = applyRotisseriePick(state, 0, 'a')
    state = applyRotisseriePick(state, 1, 'b')
    state = applyRotisseriePick(state, 1, 'c')
    state = applyRotisseriePick(state, 0, 'd')
    expect(state.picks).toEqual({ '0': ['a', 'd'], '1': ['b', 'c'] })
    expect(state.phase).toBe('done')
    expect(state.pickDeadline).toBeNull()
  })

  it('finishes early if the pool runs out before the snake order does', () => {
    // A hand-built state where the order outruns the pool (shouldn't normally happen, but
    // applyRotisseriePick must still terminate safely rather than pick from an empty pool).
    const state = {
      config, players,
      phase: 'rotisserie',
      pool: ['a'],
      pickOrder: [0, 1, 0, 1],
      turnPos: 0,
      target: 2,
      picks: { '0': [], '1': [] },
      pickDeadline: null,
      version: 0,
    }
    const next = applyRotisseriePick(state, 0, 'a')
    expect(next.pool).toEqual([])
    expect(next.phase).toBe('done')
  })
})
