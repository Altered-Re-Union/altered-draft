import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fresh module graph per test: supabase.js caches the realtime config.
async function loadSubscribe() {
  vi.resetModules()
  return (await import('./realtime.js')).subscribeToRoomRealtime
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

// Serves room states in order, then keeps repeating the last one.
function roomFetcher(states) {
  return vi.fn(async () => ({ data: { state: states.length > 1 ? states.shift() : states[0] } }))
}

describe('subscribeToRoomRealtime polling fallback', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
  })

  describe('when Realtime is not configured', () => {
    beforeEach(() => {
      global.fetch = vi.fn(async () => jsonResponse({ url: '', anonKey: '' }))
    })

    it('reports subscribed, the first read, then only changed states', async () => {
      const subscribe = await loadSubscribe()
      const fetchRoom = roomFetcher([{ phase: 'lobby' }, { phase: 'lobby' }, { phase: 'sealed' }])
      const onUpdate = vi.fn()
      const onStatus = vi.fn()

      const unsubscribe = subscribe('ABCD', onUpdate, onStatus, fetchRoom)
      await vi.advanceTimersByTimeAsync(0)
      expect(onStatus).toHaveBeenCalledWith('subscribed')
      // The first read is reported too, so a change made before polling started isn't lost.
      expect(onUpdate).toHaveBeenNthCalledWith(1, { phase: 'lobby' })

      await vi.advanceTimersByTimeAsync(1500) // unchanged
      expect(onUpdate).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1500) // lobby -> sealed
      expect(onUpdate).toHaveBeenCalledTimes(2)
      expect(onUpdate).toHaveBeenLastCalledWith({ phase: 'sealed' })
      expect(fetchRoom).toHaveBeenCalledWith('ABCD')

      unsubscribe()
    })

    it('stops polling once unsubscribed', async () => {
      const subscribe = await loadSubscribe()
      const fetchRoom = roomFetcher([{ phase: 'lobby' }])
      const unsubscribe = subscribe('ABCD', vi.fn(), undefined, fetchRoom)
      await vi.advanceTimersByTimeAsync(0)
      unsubscribe()

      const calls = fetchRoom.mock.calls.length
      await vi.advanceTimersByTimeAsync(10_000)
      expect(fetchRoom.mock.calls.length).toBe(calls)
    })
  })

  describe('when the Realtime config request fails', () => {
    it('polls meanwhile and retries the config instead of caching the failure', async () => {
      global.fetch = vi.fn(async () => { throw new Error('network down') })
      const subscribe = await loadSubscribe()
      const fetchRoom = roomFetcher([{ phase: 'lobby' }])
      const onUpdate = vi.fn()

      const unsubscribe = subscribe('ABCD', onUpdate, undefined, fetchRoom)
      await vi.advanceTimersByTimeAsync(0)
      expect(onUpdate).toHaveBeenCalledWith({ phase: 'lobby' })
      expect(global.fetch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(15_000)
      expect(global.fetch).toHaveBeenCalledTimes(2) // config retried, not memoized

      unsubscribe()
    })
  })
})
