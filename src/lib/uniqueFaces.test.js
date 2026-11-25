import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const cached = new Map()
vi.mock('./faceCache.js', () => ({
  getCachedFace: async key => cached.get(key) ?? null,
  putCachedFace: async (key, src) => { cached.set(key, src) },
}))

const CACHE = '84adbb8.2'

beforeEach(() => {
  cached.clear()
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// Node has no DOM: the renderer can't draw, so a face not in the cache fails.
describe('uniqueFaces without a DOM', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })))
  })

  it('serves a face from the persistent cache without drawing it', async () => {
    const { requestUniqueFace, getUniqueFace } = await import('./uniqueFaces.js')
    cached.set(`${CACHE}:ALT_EOLE_B_YZ_99_U_1_en`, 'data:image/jpeg;base64,face')
    expect(await requestUniqueFace('ALT_EOLE_B_YZ_99_U_1', 'EN')).toBe('data:image/jpeg;base64,face')
    expect(getUniqueFace('ALT_EOLE_B_YZ_99_U_1', 'EN')).toMatchObject({ status: 'ready', src: 'data:image/jpeg;base64,face' })
  })

  it('ignores the faces cached by an older version (the "Loading…" placeholders)', async () => {
    const { requestUniqueFace } = await import('./uniqueFaces.js')
    cached.set('84adbb8:ALT_EOLE_B_YZ_99_U_4_en', 'data:image/jpeg;base64,placeholder')
    expect(await requestUniqueFace('ALT_EOLE_B_YZ_99_U_4', 'EN')).toBeNull()
  })

  it('reports a face it could not draw as failed, notifies, and lets it be retried', async () => {
    const { requestUniqueFace, getUniqueFace, subscribeUniqueFace, retryUniqueFace } = await import('./uniqueFaces.js')
    const seen = []
    subscribeUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR', () => seen.push(getUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR').status))
    const pending = requestUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR')
    expect(getUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR').status).toBe('pending')
    expect(await pending).toBeNull()
    expect(seen).toEqual(['pending', 'failed'])

    cached.set(`${CACHE}:ALT_EOLE_B_YZ_99_U_2_fr`, 'data:image/jpeg;base64,later')
    expect(await retryUniqueFace('ALT_EOLE_B_YZ_99_U_2', 'FR')).toBe('data:image/jpeg;base64,later')
  })

  it('asks for a face only once while it is pending', async () => {
    const { requestUniqueFace } = await import('./uniqueFaces.js')
    expect(requestUniqueFace('ALT_EOLE_B_YZ_99_U_3', 'EN')).toBe(requestUniqueFace('ALT_EOLE_B_YZ_99_U_3', 'EN'))
  })
})

// A fake renderer: mountFromApi resolves once "drawn", like the real one, with the art in
// state.images.bg (null when the art failed to load).
function fakeDom({ art = () => true } = {}) {
  const mounted = []
  const AlteredRender = {
    init: vi.fn(async () => ({})),
    mountFromApi: vi.fn(async (host, card) => {
      mounted.push(card)
      return {
        canvas: { width: 744, toDataURL: () => `data:image/jpeg;base64,${card.reference}` },
        state: { images: { bg: art(card.reference) ? {} : null } },
      }
    }),
  }
  vi.stubGlobal('window', { AlteredRender, customElements: { whenDefined: async () => {} } })
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute() {}, style: {} }),
    body: { appendChild() {}, removeChild() {} },
  })
  return { AlteredRender, mounted }
}

function batchApi(known) {
  return vi.fn(async (url, { body }) => {
    const { references } = JSON.parse(body)
    return { ok: true, json: async () => references.filter(r => known.includes(r)).map(reference => ({ reference })) }
  })
}

describe('uniqueFaces with the renderer', () => {
  const A = 'ALT_CORE_B_MU_13_U_6217'
  const B = 'ALT_CORE_B_YZ_17_U_4726'

  it('draws with mountFromApi, fetches the data of faces asked together in one batch, caches them', async () => {
    const { requestUniqueFace } = await import('./uniqueFaces.js')
    const { mounted } = fakeDom()
    const fetch = batchApi([A, B])
    vi.stubGlobal('fetch', fetch)

    const [a, b] = await Promise.all([requestUniqueFace(A, 'FR'), requestUniqueFace(B, 'FR')])
    expect(a).toBe(`data:image/jpeg;base64,${A}`)
    expect(b).toBe(`data:image/jpeg;base64,${B}`)
    // (earlier tests' module instances may still flush their own batch on this fetch)
    const ours = fetch.mock.calls.filter(([, { body }]) => body.includes(A) || body.includes(B))
    expect(ours).toHaveLength(1)
    expect(ours[0][0]).toMatch(/\/api\/cards\/batch$/)
    expect(JSON.parse(ours[0][1].body)).toEqual({ references: [A, B], locale: 'fr' })
    expect(mounted[0].forge).toEqual({ collection: 'official', lang: 'fr' })
    expect(cached.get(`${CACHE}:${A}_fr`)).toBe(a)
  })

  it('never keeps a face drawn without its art, and draws it on retry', async () => {
    const { requestUniqueFace, retryUniqueFace, getUniqueFace } = await import('./uniqueFaces.js')
    let artLoads = false
    fakeDom({ art: () => artLoads })
    vi.stubGlobal('fetch', batchApi([A]))

    expect(await requestUniqueFace(A, 'EN')).toBeNull()
    expect(getUniqueFace(A, 'EN').status).toBe('failed')
    expect(cached.size).toBe(0)

    artLoads = true
    expect(await retryUniqueFace(A, 'EN')).toBe(`data:image/jpeg;base64,${A}`)
  })

  it('fails a unique the cards API does not know, and asks the API again on retry', async () => {
    const { requestUniqueFace, retryUniqueFace } = await import('./uniqueFaces.js')
    const { AlteredRender } = fakeDom()
    const fetch = batchApi([])
    vi.stubGlobal('fetch', fetch)

    expect(await requestUniqueFace(A, 'EN')).toBeNull()
    expect(AlteredRender.mountFromApi).not.toHaveBeenCalled()
    expect(cached.size).toBe(0)

    fetch.mockImplementation(batchApi([A]))
    expect(await retryUniqueFace(A, 'EN')).toBe(`data:image/jpeg;base64,${A}`)
  })

  it('warms the renderer once, prefetching its assets in parallel', async () => {
    const { warmUniqueRenderer, RENDERER_ASSETS } = await import('./uniqueFaces.js')
    const { AlteredRender } = fakeDom()
    const fetch = vi.fn(async () => ({ blob: async () => null }))
    vi.stubGlobal('fetch', fetch)
    await Promise.all([warmUniqueRenderer(), warmUniqueRenderer()])
    expect(AlteredRender.init).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(RENDERER_ASSETS.map(p => `https://cdn.alteredcore.org/forge/${p}`))
  })

  it('prefetches from window.FORGE_BASE when the page sets it', async () => {
    const { warmUniqueRenderer } = await import('./uniqueFaces.js')
    fakeDom()
    window.FORGE_BASE = 'https://forge.example/base'
    const fetch = vi.fn(async () => ({ blob: async () => null }))
    vi.stubGlobal('fetch', fetch)
    await warmUniqueRenderer()
    expect(fetch.mock.calls[0][0]).toBe('https://forge.example/base/config/index.json')
  })
})
