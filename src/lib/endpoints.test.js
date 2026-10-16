import { describe, it, expect, vi, afterEach } from 'vitest'

const ENV_KEYS = ['KEYCLOAK_ISSUER', 'KEYCLOAK_CLIENT_ID', 'DECKS_API_URL', 'DECKBUILDER_URL', 'REUNION_URL', 'CARDS_API_URL', 'CDN_URL']

// endpoints.js reads process.env at module load — re-import it per scenario.
async function loadWithEnv(env) {
  vi.resetModules()
  for (const key of ENV_KEYS) vi.stubEnv(key, env[key] ?? '')
  return import('./endpoints.js')
}

describe('endpoints', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('defaults to prod when nothing is configured', async () => {
    const { endpoints } = await loadWithEnv({})
    expect(endpoints()).toEqual({
      keycloakIssuer: 'https://auth.altered.re/realms/players',
      keycloakClientId: 'altered-draft',
      decksApiUrl: 'https://decks.alteredcore.org',
      deckbuilderUrl: 'https://deckbuilder.alteredcore.org',
      reunionUrl: 'https://altered.re',
      cardsApiUrl: 'https://cards.alteredcore.org',
      cdnUrl: 'https://cdn.alteredcore.org',
    })
  })

  it('takes overrides from env, ignoring blanks and trailing slashes', async () => {
    const { endpoints } = await loadWithEnv({ DECKS_API_URL: 'http://localhost:8001/', CDN_URL: '   ' })
    expect(endpoints().decksApiUrl).toBe('http://localhost:8001')
    expect(endpoints().cdnUrl).toBe('https://cdn.alteredcore.org')
  })

  it('exposes only the public subset (no decks API URL)', async () => {
    const { publicEndpoints } = await loadWithEnv({ CARDS_API_URL: 'http://localhost:8889' })
    expect(publicEndpoints()).not.toHaveProperty('decksApiUrl')
    expect(publicEndpoints().cardsApiUrl).toBe('http://localhost:8889')
  })

  it('warns once in the browser when read before /api/config is loaded, not after', async () => {
    vi.stubGlobal('window', {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { endpoints, loadEndpoints } = await loadWithEnv({})
      endpoints()
      endpoints()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toMatch(/read before \/api\/config was loaded/)

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
      await loadEndpoints()
      warn.mockClear()
      endpoints()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('never warns server side', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { endpoints } = await loadWithEnv({})
      endpoints()
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('loadEndpoints applies /api/config and falls back to prod when it fails', async () => {
    const { loadEndpoints, endpoints } = await loadWithEnv({})
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ reunionUrl: 'http://localhost:18181' }) })))
    await loadEndpoints()
    expect(endpoints().reunionUrl).toBe('http://localhost:18181')

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    await loadEndpoints()
    expect(endpoints().reunionUrl).toBe('https://altered.re')
  })
})
