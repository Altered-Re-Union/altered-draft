import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Fresh module graph per test: supabase.js caches the realtime config.
async function loadSubscribe() {
  vi.resetModules()
  return (await import('./realtime.js')).subscribeToRoomRealtime
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body }
}

describe('subscribeToRoomRealtime without a Realtime config (polling fallback)', () => {
  const originalFetch = global.fetch
  let roomStates

  beforeEach(() => {
    vi.useFakeTimers()
    roomStates = []
    global.fetch = vi.fn(async url => {
      if (url === '/api/realtime-config') return jsonResponse({ url: '', anonKey: '' })
      return jsonResponse({ state: roomStates.length > 1 ? roomStates.shift() : roomStates[0] })
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    global.fetch = originalFetch
  })

  it('reports subscribed, then only changed states', async () => {
    const subscribe = await loadSubscribe()
    roomStates = [{ phase: 'lobby' }, { phase: 'lobby' }, { phase: 'sealed' }]
    const onUpdate = vi.fn()
    const onStatus = vi.fn()

    const unsubscribe = subscribe('ABCD', onUpdate, onStatus)
    await vi.advanceTimersByTimeAsync(0)
    expect(onStatus).toHaveBeenCalledWith('subscribed')
    expect(onUpdate).not.toHaveBeenCalled() // first read is the baseline

    await vi.advanceTimersByTimeAsync(1500) // unchanged
    expect(onUpdate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1500) // lobby -> sealed
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ phase: 'sealed' })
    expect(global.fetch).toHaveBeenCalledWith('/api/rooms/ABCD')

    unsubscribe()
  })

  it('stops polling once unsubscribed', async () => {
    const subscribe = await loadSubscribe()
    roomStates = [{ phase: 'lobby' }]
    const unsubscribe = subscribe('ABCD', vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()

    const calls = global.fetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(global.fetch.mock.calls.length).toBe(calls)
  })
})
