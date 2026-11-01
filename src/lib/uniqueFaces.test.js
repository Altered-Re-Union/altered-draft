import { describe, it, expect, vi, beforeEach } from 'vitest'

const cached = new Map()
vi.mock('./faceCache.js', () => ({
  getCachedFace: async key => cached.get(key) ?? null,
  putCachedFace: async (key, src) => { cached.set(key, src) },
}))

beforeEach(() => {
  cached.clear()
  vi.resetModules()
})

// Node has no DOM: the renderer can't draw, so a face not in the cache fails.
describe('uniqueFaces', () => {
  it('serves a face from the persistent cache without drawing it', async () => {
    const { requestUniqueFace, getUniqueFace } = await import('./uniqueFaces.js')
    cached.set('84adbb8:ALT_EOLE_B_YZ_99_U_1_en', 'data:image/jpeg;base64,face')
    expect(await requestUniqueFace('ALT_EOLE_B_YZ_99_U_1', 'EN')).toBe('data:image/jpeg;base64,face')
    expect(getUniqueFace('ALT_EOLE_B_YZ_99_U_1', 'EN')).toMatchObject({ status: 'ready', src: 'data:image/jpeg;base64,face' })
  })

  it('reports a face it could not draw as failed, notifies, and lets it be retried', async () => {
    const { requestUniqueFace, getUniqueFace, subscribeUniqueFace, retryUniqueFace } = await import('./uniqueFaces.js')
    const seen = []
    subscribeUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR', () => seen.push(getUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR').status))
    const pending = requestUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR')
    expect(getUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR').status).toBe('pending')
    expect(await pending).toBeNull()
    expect(seen).toEqual(['pending', 'failed'])

    cached.set('84adbb8:ALT_EOLE_B_YZ_99_U_2_fr', 'data:image/jpeg;base64,later')
    expect(await retryUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR')).toBe('data:image/jpeg;base64,later')
  })

  it('asks for a face only once while it is pending', async () => {
    const { requestUniqueFace } = await import('./uniqueFaces.js')
    expect(requestUniqueFace('ALT_EOLE_B_YZ_99_U_3', 'EN')).toBe(requestUniqueFace('ALT_EOLE_B_YZ_99_U_3', 'EN'))
  })
})
