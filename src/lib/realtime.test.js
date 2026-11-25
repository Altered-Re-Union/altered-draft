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

  describe('when Realtime is configured', () => {
    // A fake supabase client whose channel status / pushes the test drives by hand.
    function fakeSupabase() {
      const ch = { handlers: {}, statusCb: null }
      ch.on = (type, _filter, cb) => { ch.handlers[type] = cb; return ch }
      ch.subscribe = cb => { ch.statusCb = cb; return ch }
      const client = { channel: vi.fn(() => ch), removeChannel: vi.fn() }
      return {
        client,
        status: s => ch.statusCb(s),
        push: state => ch.handlers.postgres_changes({ new: { state } }),
        system: ev => ch.handlers.system(ev),
      }
    }

    async function loadWithClient(fake) {
      vi.resetModules()
      vi.doMock('./supabase.js', () => ({
        getRealtimeConfig: async () => ({ url: 'https://x', anonKey: 'k', ok: true }),
        getSupabaseClient: async () => fake.client,
      }))
      return (await import('./realtime.js')).subscribeToRoomRealtime
    }

    afterEach(() => {
      vi.doUnmock('./supabase.js')
    })

    it('does not poll while the channel is healthy, and reads the room once on SUBSCRIBED', async () => {
      const fake = fakeSupabase()
      const subscribe = await loadWithClient(fake)
      const fetchRoom = roomFetcher([{ phase: 'lobby' }])
      const onUpdate = vi.fn()
      const onStatus = vi.fn()

      const unsubscribe = subscribe('ABCD', onUpdate, onStatus, fetchRoom)
      await vi.advanceTimersByTimeAsync(0)
      fake.status('SUBSCRIBED')
      await vi.advanceTimersByTimeAsync(0)
      expect(onStatus).toHaveBeenCalledWith('subscribed')
      expect(onUpdate).toHaveBeenCalledWith({ phase: 'lobby' }) // catch-up read

      fake.push({ phase: 'drafting' })
      expect(onUpdate).toHaveBeenLastCalledWith({ phase: 'drafting' })

      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchRoom).toHaveBeenCalledTimes(1) // no polling

      unsubscribe()
      expect(fake.client.removeChannel).toHaveBeenCalled()
    })

    it('polls when the channel fails, and stops once it is SUBSCRIBED again', async () => {
      const fake = fakeSupabase()
      const subscribe = await loadWithClient(fake)
      const fetchRoom = roomFetcher([{ phase: 'lobby' }, { phase: 'drafting' }])
      const onUpdate = vi.fn()

      const unsubscribe = subscribe('ABCD', onUpdate, undefined, fetchRoom)
      await vi.advanceTimersByTimeAsync(0)
      fake.status('CHANNEL_ERROR') // e.g. "transport failure"
      await vi.advanceTimersByTimeAsync(0)
      expect(onUpdate).toHaveBeenNthCalledWith(1, { phase: 'lobby' })

      await vi.advanceTimersByTimeAsync(1500)
      expect(onUpdate).toHaveBeenNthCalledWith(2, { phase: 'drafting' }) // the host started

      fake.status('SUBSCRIBED')
      await vi.advanceTimersByTimeAsync(0)
      const calls = fetchRoom.mock.calls.length
      await vi.advanceTimersByTimeAsync(30_000)
      expect(fetchRoom.mock.calls.length).toBe(calls)
      expect(onUpdate).toHaveBeenCalledTimes(2) // the catch-up read changed nothing

      unsubscribe()
    })

    it('polls when the channel never reports SUBSCRIBED', async () => {
      const fake = fakeSupabase()
      const subscribe = await loadWithClient(fake)
      const fetchRoom = roomFetcher([{ phase: 'lobby' }])
      const onUpdate = vi.fn()

      const unsubscribe = subscribe('ABCD', onUpdate, undefined, fetchRoom)
      await vi.advanceTimersByTimeAsync(9_000)
      expect(fetchRoom).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(onUpdate).toHaveBeenCalledWith({ phase: 'lobby' })

      unsubscribe()
    })

    it('polls when the postgres_changes binding fails on a joined channel', async () => {
      const fake = fakeSupabase()
      const subscribe = await loadWithClient(fake)
      const fetchRoom = roomFetcher([{ phase: 'lobby' }, { phase: 'sealed' }])
      const onUpdate = vi.fn()

      const unsubscribe = subscribe('ABCD', onUpdate, undefined, fetchRoom)
      await vi.advanceTimersByTimeAsync(0)
      fake.status('SUBSCRIBED')
      await vi.advanceTimersByTimeAsync(0)
      fake.system({ extension: 'postgres_changes', status: 'error', message: 'Unable to subscribe' })
      await vi.advanceTimersByTimeAsync(0)
      expect(onUpdate).toHaveBeenLastCalledWith({ phase: 'sealed' })

      unsubscribe()
    })

    it('never lets a slow catch-up read overwrite a newer push', async () => {
      const fake = fakeSupabase()
      const subscribe = await loadWithClient(fake)
      let resolveRead
      const fetchRoom = vi.fn(() => new Promise(r => { resolveRead = r }))
      const onUpdate = vi.fn()

      const unsubscribe = subscribe('ABCD', onUpdate, undefined, fetchRoom)
      await vi.advanceTimersByTimeAsync(0)
      fake.status('SUBSCRIBED')
      fake.push({ phase: 'drafting', version: 2 })
      resolveRead({ data: { state: { phase: 'lobby', version: 1 } } })
      await vi.advanceTimersByTimeAsync(0)
      expect(onUpdate).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenLastCalledWith({ phase: 'drafting', version: 2 })

      unsubscribe()
    })

    it('reports error when a fallback poll read fails, and keeps polling', async () => {
      const fake = fakeSupabase()
      const subscribe = await loadWithClient(fake)
      const fetchRoom = vi.fn()
        .mockResolvedValueOnce({ data: null, error: new Error('HTTP 502') })
        .mockResolvedValue({ data: { state: { phase: 'lobby' } }, error: null })
      const onStatus = vi.fn()

      const unsubscribe = subscribe('ABCD', vi.fn(), onStatus, fetchRoom)
      await vi.advanceTimersByTimeAsync(0)
      fake.status('CLOSED')
      await vi.advanceTimersByTimeAsync(0)
      expect(onStatus).toHaveBeenLastCalledWith('error')
      await vi.advanceTimersByTimeAsync(1500)
      expect(onStatus).toHaveBeenLastCalledWith('subscribed')

      unsubscribe()
    })
  })
})
