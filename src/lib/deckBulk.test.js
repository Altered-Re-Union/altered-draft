import { describe, it, expect } from 'vitest'
import { addRefsToDeck, removeRefsFromDeck, bulkDeckState } from './deckBulk.js'

const cardMap = {
  AX_HERO: { faction: 'AX', cardType: 'HERO' },
  AX_1: { faction: 'AX', cardType: 'CHARACTER' },
  AX_2: { faction: 'AX', cardType: 'SPELL' },
  BR_1: { faction: 'BR', cardType: 'CHARACTER' },
  BR_HERO: { faction: 'BR', cardType: 'HERO' },
}
const poolCounts = { AX_HERO: 1, AX_1: 2, AX_2: 1, BR_1: 3, BR_HERO: 1 }
// A group lists one entry per copy, the way PoolGrid's groups do.
const axGroup = ['AX_HERO', 'AX_1', 'AX_1', 'AX_2']

describe('addRefsToDeck', () => {
  it('adds every non-hero card of the group at its pool quantity', () => {
    expect(addRefsToDeck({}, poolCounts, cardMap, axGroup)).toEqual({ AX_1: 2, AX_2: 1 })
  })

  it('keeps the rest of the deck, the heroes included, and tops up partial copies', () => {
    const deck = { AX_1: 1, BR_1: 2, BR_HERO: 1 }
    expect(addRefsToDeck(deck, poolCounts, cardMap, axGroup)).toEqual({ AX_1: 2, AX_2: 1, BR_1: 2, BR_HERO: 1 })
  })

  it('never adds a hero, nor a card the pool does not hold', () => {
    expect(addRefsToDeck({}, poolCounts, cardMap, ['BR_HERO', 'BR_1'])).toEqual({ BR_1: 3 })
    expect(addRefsToDeck({}, {}, cardMap, ['AX_1'])).toEqual({})
  })
})

describe('removeRefsFromDeck', () => {
  it('removes the non-hero cards of the group and keeps the hero', () => {
    const deck = { AX_HERO: 1, AX_1: 2, AX_2: 1, BR_1: 3 }
    expect(removeRefsFromDeck(deck, cardMap, axGroup)).toEqual({ AX_HERO: 1, BR_1: 3 })
  })
})

describe('bulkDeckState', () => {
  it('only allows adding while a copy is missing, removing while one is in the deck', () => {
    expect(bulkDeckState({}, poolCounts, cardMap, axGroup)).toEqual({ canAdd: true, canRemove: false })
    expect(bulkDeckState({ AX_1: 1 }, poolCounts, cardMap, axGroup)).toEqual({ canAdd: true, canRemove: true })
    expect(bulkDeckState({ AX_1: 2, AX_2: 1 }, poolCounts, cardMap, axGroup)).toEqual({ canAdd: false, canRemove: true })
  })

  it('ignores the hero: a group whose only deck card is its hero has nothing to remove', () => {
    expect(bulkDeckState({ AX_HERO: 1 }, poolCounts, cardMap, axGroup).canRemove).toBe(false)
  })
})
