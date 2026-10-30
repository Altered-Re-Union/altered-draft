// The app's API as a given persona (password-grant Bearer), and the seeding helpers built
// on it. Seeding always goes through the app, never through SQL.
import { tokenFor } from './auth.js'
import { isoDaysFromNow } from './dates.js'
import { APP_URL } from './env.js'

// `bucket` (the test's guard bucket) collects the >= 500 answers, as the browser guard does.
export function apiAs(request, who, bucket = null) {
  let token = null
  async function call(method, path, body) {
    const headers = {}
    if (who) headers.Authorization = `Bearer ${token ??= await tokenFor(who)}`
    const res = await request.fetch(`${APP_URL}${path}`, { method, headers, data: body })
    if (bucket && res.status() >= 500) bucket.serverErrors.push(`${res.status()} ${method} ${APP_URL}${path} (api helper)`)
    const text = await res.text()
    let parsed = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
    return { status: res.status(), body: parsed }
  }
  return {
    get: path => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    delete: path => call('DELETE', path),
  }
}

export function tournamentBody(overrides = {}) {
  return {
    name: 'Test cup',
    description: 'Line one\nLine two',
    bgaUrl: 'https://fr.boardgamearena.com/tournament/?id=123456',
    startsAt: isoDaysFromNow(1),
    endsAt: null,
    config: {
      source: { type: 'set', setCode: 'CYCLONE' },
      heroes: 'packs',
      uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false, faction: null },
      excludeBanlist: false,
    },
    ...overrides,
  }
}

function expectStatus(res, status, what) {
  if (res.status !== status) throw new Error(`${what} → ${res.status} ${JSON.stringify(res.body)}`)
  return res.body
}

export function makeSeed(request, bucket = null) {
  return {
    async tournament(who, overrides = {}) {
      return expectStatus(await apiAs(request, who, bucket).post('/api/tournaments', tournamentBody(overrides)), 201, 'seed tournament')
    },
    async pool(who, tournamentId) {
      return expectStatus(await apiAs(request, who, bucket).get(`/api/tournaments/${tournamentId}/pool`), 200, 'seed pool')
    },
    async bgaDecklist(who, { tournamentId, tournamentName, gameId }) {
      const qs = new URLSearchParams({ tournamentId, tournamentName, gameId })
      return expectStatus(await apiAs(request, who, bucket).get(`/api/tournament-bga-decklist?${qs}`), 200, 'seed BGA decklist')
    },
  }
}

export async function withRequestContext(playwrightRequest, fn) {
  const ctx = await playwrightRequest.newContext({ baseURL: APP_URL })
  try {
    return await fn(makeSeed(ctx), who => apiAs(ctx, who))
  } finally {
    await ctx.dispose()
  }
}
