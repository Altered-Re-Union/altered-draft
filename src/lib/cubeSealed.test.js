import { describe, it, expect } from 'vitest'
import { cubeCapacity, expandCube, checkPlayerCap } from './cubeSealed.js'

const card = (ref, qty, faction) => ({ ref, qty, faction })
const F = ['AX', 'BR', 'LY', 'MU', 'OR', 'YZ']
// n distinct cards per faction, one copy each
const big = n => F.flatMap(f => Array.from({ length: n }, (_, i) => card(`ALT_CORE_B_${f}_${i + 1}_C`, 1, f)))

describe('cube capacity', () => {
  it('is bound by the total when every faction is plentiful', () => {
    const c = cubeCapacity({ cards: big(60), boosters: 3, cardsPerBooster: 10, perFaction: 1 })
    expect(c).toMatchObject({ players: 12, total: 360, limit: { by: 'total', have: 360, needed: 30 } })
  })
  it('is bound by the scarcest faction with a faction guarantee', () => {
    const cards = [...big(10), ...F.slice(0, 5).flatMap(f => Array.from({ length: 16 }, (_, i) => card(`ALT_CORE_B_${f}_${100 + i}_C`, 1, f)))] // YZ: 10 cards, others 26, total 140
    const c = cubeCapacity({ cards, boosters: 6, cardsPerBooster: 10, perFaction: 1 })
    expect(c.limit).toEqual({ by: 'YZ', have: 10, needed: 6 })
    expect(c.players).toBe(1)
    expect(cubeCapacity({ cards, boosters: 6, cardsPerBooster: 10, perFaction: 0 }).limit.by).toBe('total')
  })
  it('prefers the total on a tie', () => {
    expect(cubeCapacity({ cards: big(10), boosters: 6, cardsPerBooster: 10, perFaction: 1 }).limit.by).toBe('total')
  })
  it('counts an unknown faction in the total only, and caps at 256', () => {
    expect(cubeCapacity({ cards: [card('ALT_CORE_B_AX_1_U_9', 1, null), ...big(10)], boosters: 3, cardsPerBooster: 10, perFaction: 0 }).total).toBe(61)
    expect(cubeCapacity({ cards: big(2000), boosters: 3, cardsPerBooster: 10, perFaction: 0 }).players).toBe(256)
  })
  it('expandCube repeats a ref qty times', () => {
    expect(expandCube([card('A', 2, 'AX'), card('B', 1, 'BR')])).toEqual([{ ref: 'A', faction: 'AX' }, { ref: 'A', faction: 'AX' }, { ref: 'B', faction: 'BR' }])
  })
})

describe('checkPlayerCap', () => {
  it('cube required, above capacity, capacity below 2; other sources below the pool count', () => {
    const cube = { type: 'cube' }, set = { type: 'set' }
    expect(checkPlayerCap({ source: cube, maxPlayers: null, capacity: { players: 4 } })).toEqual({ fields: { maxPlayers: 'required_for_cube' }, config: [] })
    expect(checkPlayerCap({ source: cube, maxPlayers: 5, capacity: { players: 4 } })).toEqual({ fields: { maxPlayers: 'above_capacity' }, config: [] })
    expect(checkPlayerCap({ source: cube, maxPlayers: 2, capacity: { players: 1 } })).toEqual({ fields: {}, config: ['source.capacity'] })
    expect(checkPlayerCap({ source: cube, maxPlayers: 4, capacity: { players: 4 } })).toEqual({ fields: {}, config: [] })
    expect(checkPlayerCap({ source: set, maxPlayers: 2, poolCount: 3 })).toEqual({ fields: { maxPlayers: 'below_pool_count' }, config: [] })
    expect(checkPlayerCap({ source: set, maxPlayers: null, poolCount: 3 })).toEqual({ fields: {}, config: [] })
  })
})
