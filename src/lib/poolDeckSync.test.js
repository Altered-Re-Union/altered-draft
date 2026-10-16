import { describe, it, expect } from 'vitest'
import { syncDeckToPool } from './poolDeckSync.js'

// Records every call in order, so the tests can assert the sequence decks-api sees.
function fakes({ updateFails = null } = {}) {
  const calls = []
  return {
    calls,
    deps: {
      createDeck: async body => { calls.push(['create', body]); return { id: 'new-deck' } },
      updateDeck: async (id, body) => {
        calls.push(['update', id, body])
        if (updateFails && body.deckCards) { const e = new Error('gone'); e.status = updateFails; throw e }
        return { id }
      },
      syncPoolDeck: async (poolId, summary) => { calls.push(['link', poolId, summary.deckId]); return { id: poolId, deck: { id: summary.deckId } } },
    },
  }
}

const summary = (isDraft) => ({ name: 'Cup', deckCards: [{ cardReference: 'X', quantity: 30 }], isDraft, format: 'sealed' })
const extra = { heroRef: 'H', faction: 'AX', cardQuantity: 30 }

describe('syncDeckToPool', () => {
  it('creates a deck that is already valid as a DRAFT, links it, and only then flips it off draft', async () => {
    const { calls, deps } = fakes()
    const pool = await syncDeckToPool({ poolId: 'p1', deckId: null, summary: summary(false), ...extra }, deps)
    expect(calls).toEqual([
      ['create', { ...summary(false), isDraft: true }],
      ['link', 'p1', 'new-deck'],
      ['update', 'new-deck', { isDraft: false }],
    ])
    expect(pool.deck.id).toBe('new-deck')
  })

  it('leaves an invalid new deck as a draft (no flip)', async () => {
    const { calls, deps } = fakes()
    await syncDeckToPool({ poolId: 'p1', deckId: null, summary: summary(true), ...extra }, deps)
    expect(calls.map(c => c[0])).toEqual(['create', 'link'])
  })

  it('updates an existing linked deck in place (the link already exists, validation can run)', async () => {
    const { calls, deps } = fakes()
    await syncDeckToPool({ poolId: 'p1', deckId: 'd1', summary: summary(false), ...extra }, deps)
    expect(calls).toEqual([['update', 'd1', summary(false)], ['link', 'p1', 'd1']])
  })

  it('recreates a deck deleted on decks-api with the same draft-link-flip sequence', async () => {
    const { calls, deps } = fakes({ updateFails: 404 })
    await syncDeckToPool({ poolId: 'p1', deckId: 'gone', summary: summary(false), ...extra }, deps)
    expect(calls.map(c => c[0])).toEqual(['update', 'create', 'link', 'update'])
    expect(calls[1][1].isDraft).toBe(true)
    expect(calls[3]).toEqual(['update', 'new-deck', { isDraft: false }])
  })

  it('rethrows a non-404 update failure', async () => {
    const { deps } = fakes({ updateFails: 500 })
    await expect(syncDeckToPool({ poolId: 'p1', deckId: 'd1', summary: summary(false), ...extra }, deps)).rejects.toThrow('gone')
  })
})
