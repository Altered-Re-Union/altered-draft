import { describe, it, expect } from 'vitest'
import { facesToEvict, getCachedFace, putCachedFace } from './faceCache.js'

const DAY = 24 * 3600 * 1000
const now = 100 * DAY

describe('facesToEvict', () => {
  it('evicts the entries older than the max age', () => {
    const entries = [{ key: 'old', savedAt: now - 31 * DAY }, { key: 'new', savedAt: now - DAY }]
    expect(facesToEvict(entries, now, { maxAgeMs: 30 * DAY, maxEntries: 10 })).toEqual(['old'])
  })

  it('evicts the oldest entries beyond the max count', () => {
    const entries = [3, 1, 4, 2].map(n => ({ key: `k${n}`, savedAt: now - n * DAY }))
    expect(facesToEvict(entries, now, { maxAgeMs: 30 * DAY, maxEntries: 2 })).toEqual(['k4', 'k3'])
  })

  it('keeps everything under both limits', () => {
    expect(facesToEvict([{ key: 'a', savedAt: now }], now, { maxAgeMs: DAY, maxEntries: 1 })).toEqual([])
  })
})

describe('without IndexedDB', () => {
  it('degrades to a miss and a no-op', async () => {
    await putCachedFace('k', 'data:image/jpeg;base64,xx')
    expect(await getCachedFace('k')).toBeNull()
  })
})
