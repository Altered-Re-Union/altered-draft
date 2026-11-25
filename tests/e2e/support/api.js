// The app's API as a given persona (password-grant Bearer), and the seeding helpers built
// on it. Seeding always goes through the app, never through SQL.
import { tokenFor } from './auth.js'
import { isoDaysFromNow } from './dates.js'
import { APP_URL } from './env.js'
import { COMMUNITY_CUBES } from '../../../src/lib/cubes.js'

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

// The mono-faction "Axiom mix" of the V2 acceptance page, on the e2e card fixtures: only
// CYCLONE / EOLE / FUGUE exist there, so the four other sets stay at ×0 (left out).
export function factionTournamentBody(overrides = {}) {
  return tournamentBody({
    name: 'Axiom mix',
    bgaUrl: 'https://boardgamearena.com/tournament?id=123480',
    config: {
      source: { type: 'faction', faction: 'AX', sets: { CYCLONE: 1, EOLE: 2, FUGUE: 1 } },
      heroes: 'packs',
      uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: 'AX' },
      excludeBanlist: false,
    },
    ...overrides,
  })
}

// "SKY ROC NEJ mix" of the V3 acceptance page: the 7 boosters split over three sets, each
// booster set-pure (Neverending Journey has no unique data: its booster never holds one).
export function multisetTournamentBody(overrides = {}) {
  return tournamentBody({
    name: 'SKY ROC NEJ mix',
    bgaUrl: 'https://boardgamearena.com/tournament?id=123490',
    config: {
      source: { type: 'multiset', sets: { CYCLONE: 3, EOLE: 3, FUGUE: 1 } },
      heroes: 'packs',
      uniques: { inBoosters: 2, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: null },
      excludeBanlist: false,
    },
    ...overrides,
  })
}

// "Private cup" of the V4 acceptance page: listed only for its organizer, the players who
// have a pool on it and the moderators.
export function privateTournamentBody(overrides = {}) {
  return tournamentBody({
    name: 'Private cup',
    bgaUrl: 'https://boardgamearena.com/tournament?id=123500',
    visibility: 'private',
    ...overrides,
  })
}

const ALL_COMMONS_CUBE = COMMUNITY_CUBES.find(c => c.id === 'all-commons')
export const ALL_COMMONS = { cards: ALL_COMMONS_CUBE.refs.length, heroes: ALL_COMMONS_CUBE.heroes.length }

// "Commons cube" of the V5 acceptance page: the community All commons cube, 6 boosters of
// 10 cards, one common per faction. The cards are the cube's refs (the promo-only
// ALT_BISE_P_BR_64_C included), the hero pool its 12 heroes.
export function cubeTournamentBody(overrides = {}) {
  return tournamentBody({
    name: 'Commons cube',
    bgaUrl: 'https://boardgamearena.com/tournament?id=123510',
    maxPlayers: 3,
    config: {
      source: {
        type: 'cube', name: 'All commons', origin: 'community', cubeId: 'all-commons',
        cards: Object.fromEntries(ALL_COMMONS_CUBE.refs.map(ref => [ref, 1])),
        heroPool: [...ALL_COMMONS_CUBE.heroes],
        boosters: 6, cardsPerBooster: 10, perFaction: 1,
      },
      heroes: 'packs',
      uniques: { inBoosters: 0, guaranteed: 0 },
      excludeBanlist: false,
    },
    ...overrides,
  })
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
