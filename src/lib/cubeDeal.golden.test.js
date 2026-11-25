// Pins the rng order of dealCubeSlots (spec section 15.3). A moved digest means a deal that
// already happened could not be reproduced: change the contract on purpose or not at all.
import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import { dealCubeSlots } from './packGenerator.js'
import { mulberry32 } from './prng.js'
import { FACTIONS } from './cardData.js'

describe('cube deal golden', () => {
  it('the deal of a fake cube is frozen', () => {
    const cards = []
    for (const f of FACTIONS) for (let n = 1; n <= 60; n++) cards.push({ ref: `ALT_CORE_B_${f}_${n}_C`, faction: f })
    for (let n = 1; n <= 6; n++) cards.push({ ref: `ALT_CORE_B_AX_${n}_U_${n}`, faction: null })
    const lots = dealCubeSlots({ cards, heroPool: ['H1', 'H2', 'H3'], slots: 4, boosters: 6, cardsPerBooster: 12, perFaction: 1, heroesInBoosters: true }, mulberry32(42))
    expect(crypto.createHash('sha256').update(JSON.stringify(lots)).digest('hex')).toMatchSnapshot()
  })
})
