// URLs of the Altered Re:Union / Community services this app talks to. Prod by default
// (no config = current behaviour); each one is overridable so a dev can point the app at
// local versions of those services (see .env.example and the Makefile).
//
// Shared by server and browser code:
//   - server (api/*.js, server/index.js): read from env vars at module load;
//   - browser: the public subset is fetched from /api/config (api/config.js) by main.jsx
//     BEFORE the app modules are imported, so module-level constants built from these
//     URLs (asset maps, etc.) already see the right values.

const DEFAULTS = {
  keycloakIssuer: 'https://auth.altered.re/realms/players',
  keycloakClientId: 'altered-draft',
  decksApiUrl: 'https://decks.alteredcore.org',
  deckbuilderUrl: 'https://deckbuilder.alteredcore.org',
  reunionUrl: 'https://altered.re',
  cardsApiUrl: 'https://cards.alteredcore.org',
  cdnUrl: 'https://cdn.alteredcore.org',
}

const ENV_VARS = {
  keycloakIssuer: 'KEYCLOAK_ISSUER',
  keycloakClientId: 'KEYCLOAK_CLIENT_ID',
  decksApiUrl: 'DECKS_API_URL',
  deckbuilderUrl: 'DECKBUILDER_URL',
  reunionUrl: 'REUNION_URL',
  cardsApiUrl: 'CARDS_API_URL',
  cdnUrl: 'CDN_URL',
}

// What the browser needs. The decks API is only ever reached through our own proxy
// (api/decks/*), so its URL stays server-side.
const PUBLIC_KEYS = ['keycloakIssuer', 'keycloakClientId', 'deckbuilderUrl', 'reunionUrl', 'cardsApiUrl', 'cdnUrl']

// Per attempt. Two attempts, so a cold serverless function gets a second chance before
// we give up — a fallback is only correct on a prod deployment.
const CONFIG_TIMEOUT_MS = 2500
const CONFIG_ATTEMPTS = 2

function merge(overrides) {
  const merged = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const value = overrides?.[key]
    if (typeof value === 'string' && value.trim()) merged[key] = value.trim().replace(/\/+$/, '')
  }
  return merged
}

function fromEnv(env) {
  return merge(Object.fromEntries(Object.entries(ENV_VARS).map(([key, name]) => [key, env[name]])))
}

let current = typeof process !== 'undefined' && process.env ? fromEnv(process.env) : { ...DEFAULTS }

export function endpoints() {
  return current
}

/** Server side: the subset served to the browser by /api/config. */
export function publicEndpoints() {
  return Object.fromEntries(PUBLIC_KEYS.map(key => [key, current[key]]))
}

async function fetchConfig() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS)
  try {
    const res = await fetch('/api/config', { signal: controller.signal })
    return res.ok ? await res.json() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Browser side: loads /api/config. If it can't be reached, falls back to prod defaults —
 * loudly, since on a non-prod deployment the server would keep ITS configured services
 * while the browser talks to prod (e.g. login against the wrong Keycloak).
 */
export async function loadEndpoints() {
  let config = null
  for (let attempt = 0; attempt < CONFIG_ATTEMPTS && !config; attempt++) config = await fetchConfig()
  if (!config) {
    console.warn('[endpoints] /api/config unavailable — falling back to PROD service URLs. On a local/preprod deployment, login, decks and cards will target prod until reload.')
  }
  current = merge(config)
  return current
}
