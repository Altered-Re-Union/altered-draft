import { describe, it, expect } from 'vitest'
import { buildRandomDeck } from './randomDeck.js'

function card(faction, cardType = 'CHARACTER') {
  return { faction, cardType }
}

function makePool({ heroesPerFaction = 1, cardsPerFaction = 10, factions = ['AX', 'BR', 'LY', 'MU', 'OR', 'YZ'] } = {}) {
  const poolCards = {}
  const cardMap = {}
  for (const f of factions) {
    for (let h = 0; h < heroesPerFaction; h++) {
      const ref = `HERO_${f}_${h}`
      poolCards[ref] = 1
      cardMap[ref] = card(f, 'HERO')
    }
    for (let c = 0; c < cardsPerFaction; c++) {
      const ref = `CARD_${f}_${c}`
      poolCards[ref] = 3
      cardMap[ref] = card(f)
    }
  }
  return { poolCards, cardMap }
}

function factionsOf(deck, cardMap) {
  return new Set(Object.keys(deck).map(r => cardMap[r]?.faction).filter(Boolean))
}

function heroCountOf(deck, cardMap) {
  return Object.keys(deck).filter(r => cardMap[r]?.cardType === 'HERO').reduce((n, r) => n + deck[r], 0)
}

function totalOf(deck) {
  return Object.values(deck).reduce((a, b) => a + b, 0)
}

describe('buildRandomDeck', () => {
  it('caps the deck at the requested size (hero included) when the pool has plenty', () => {
    const { poolCards, cardMap } = makePool()
    const deck = buildRandomDeck(poolCards, cardMap)
    expect(totalOf(deck)).toBe(30)
  })

  it('respects a custom size', () => {
    const { poolCards, cardMap } = makePool()
    const deck = buildRandomDeck(poolCards, cardMap, { size: 40 })
    expect(totalOf(deck)).toBe(40)
  })

  it('never uses more than 3 factions', () => {
    const { poolCards, cardMap } = makePool()
    const deck = buildRandomDeck(poolCards, cardMap)
    expect(factionsOf(deck, cardMap).size).toBeLessThanOrEqual(3)
  })

  it('never includes more than 1 hero', () => {
    const { poolCards, cardMap } = makePool()
    const deck = buildRandomDeck(poolCards, cardMap)
    expect(heroCountOf(deck, cardMap)).toBeLessThanOrEqual(1)
  })

  it('never exceeds a card ref\'s owned quantity', () => {
    const { poolCards, cardMap } = makePool({ cardsPerFaction: 3 })
    const deck = buildRandomDeck(poolCards, cardMap)
    for (const [ref, qty] of Object.entries(deck)) {
      expect(qty).toBeLessThanOrEqual(poolCards[ref])
    }
  })

  it('falls back to fewer than the target size if the pool is too small', () => {
    const { poolCards, cardMap } = makePool({ cardsPerFaction: 2, factions: ['AX'] })
    const deck = buildRandomDeck(poolCards, cardMap)
    expect(totalOf(deck)).toBeLessThan(30)
    expect(totalOf(deck)).toBe(totalOf(poolCards))
  })

  it('handles a pool with no heroes at all', () => {
    const { poolCards, cardMap } = makePool({ heroesPerFaction: 0 })
    const deck = buildRandomDeck(poolCards, cardMap)
    expect(heroCountOf(deck, cardMap)).toBe(0)
    expect(totalOf(deck)).toBe(30)
  })

  it('returns an empty deck for an empty pool', () => {
    expect(buildRandomDeck({}, {})).toEqual({})
  })
})