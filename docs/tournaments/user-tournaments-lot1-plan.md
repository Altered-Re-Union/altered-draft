# User-created sealed tournaments — Lot 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any Re:Union account declare a sealed tournament (7 boosters of one set + the existing tournament knobs), let players prepare a stored, one-shot pool for it, and have BGA's unchanged deck-list call find that pool.

**Architecture:** A new `tournaments` table holds the declared tournaments and their config (jsonb). Pools keep living in `sealed_pools`, now with a `tournament_ref` FK and the generated `cards`/`boosters` stored at insert time by a single generation entry point (`src/lib/poolBuilder.js`). The BGA path resolves `(sub, tournament_id)` first, then the registry, then the legacy pending pool. New `api/tournaments/*` handlers serve the public list, CRUD for organizers, and the player's get-or-create pool; new pages wire the form, the tournament page with its 3-step checklist, and the reworked menu.

**Tech Stack:** Node ≥ 20.6 (22 recommended), Express 5 / Vercel functions (same handler modules), `pg`, React 18 + react-router 6 + Tailwind (semantic tokens), vitest (unit: `npm test`; integration against Docker Postgres: `npm run test:integration`).

**Spec:** `docs/tournaments/user-tournaments-spec.md` (read it first; §4–§9 are the contract this plan implements).

## Global Constraints

- Sealed only: `tournaments.format` is `'sealed'` with a CHECK constraint; `config.source.type` is `'set'` and `config.source.boosters` is `7` in lot 1.
- Pools are generated **then** inserted in one `INSERT … ON CONFLICT DO NOTHING RETURNING *`; never insert a row without `cards`/`boosters`.
- Every pool read is owner-scoped (`sub`), never by id alone.
- BGA-facing contracts (`/api/tournament-bga-decklist`, `/api/tournament-pool-counts`, `/api/tournament-pool-by-deck`, `/api/tournament-pool`) do not change shape.
- Registered pools: `tournament_id` = the tournament's `bga_tournament_id`, `bound_at` = creation time, `tournament_name` = the altered-draft name (never refreshed from BGA).
- Max **10** open tournaments per account (open = not cancelled, not ended, `ends_at` null or in the future); moderators exempt.
- Moderator = `realm_access.roles` of the access token contains `TOURNAMENT_MODERATOR_ROLE`, or `sub` ∈ `TOURNAMENT_MODERATORS` (comma-separated). Both env vars optional.
- BGA link: `https`, host `boardgamearena.com` or a subdomain, path `/tournament`, numeric `id` query param; stored canonical as `https://boardgamearena.com/tournament?id=<id>`; unique across tournaments.
- UI copy in both `src/lib/i18n/en.js` and `fr.js`; semantic Tailwind tokens only (`surface*`, `ink*`, `muted`, `faint`, `line`, `accent*`), never raw `gray-*`/`amber-*`.
- Code, comments, commits in English. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Branch: `feat/user-tournaments`, created from `chore/local-dev-stack` (decided 2026-10-16; rebase onto `main` once that branch merges). Commit only the files each task touches.
- Cancelled and ended tournaments stay editable (name, description, dates, actions); only pool existence locks the BGA link and the config. No handler checks the status before a PATCH.
- Node ESM: JSON imports need `with { type: 'json' }`; `pg` serializes plain objects as JSON but turns JS arrays into Postgres arrays — always `JSON.stringify` jsonb parameters.

## Review Focus

Input classes the spec implies that a user will hit; each one gets a test in the task that owns the code.

1. **BGA link variants** — `https://fr.boardgamearena.com/tournament?id=597924&x=1`, `HTTPS://BOARDGAMEARENA.COM/tournament/?id=5`, a stage page or `http://` → accepted and canonicalized, or rejected; never a 500. → Task 1.
2. **Dates crossing on PATCH** — moving `startsAt` past an existing `endsAt`, or sending `endsAt` before the stored `startsAt` → 400, not a tournament that is "ended before it starts". → Task 1.
3. **Concurrent pool creation** — the page and BGA's call create the same player's pool at the same instant → exactly one row, both callers get it, no 500 from the second unique index. → Task 7.
4. **Tournament declared after a legacy pool was already bound to that BGA id** — the player's existing (played) pool is adopted, not replaced. → Task 7.
5. **Public GET with a stale bearer** — a logged-out-looking request carrying an expired token still gets the public list (anonymous view), not a 401. → Task 9.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/bgaUrl.js` (+ `.test.js`) | Parse/canonicalize a BGA tournament URL → `{ id, url }`. Pure. |
| `src/lib/tournamentRules.js` (+ `.test.js`) | `tournamentStatus(row, now)`, `validateTournamentFields(body, opts)`, constants. Pure. |
| `src/lib/tournamentConfig.js` (+ `.test.js`) | Config object: `validateTournamentConfig`, `configFromLegacyFormat`, `legacyColumnsFromConfig`. Pure. |
| `src/lib/poolBuilder.js` (+ `.test.js`) | `buildPool(sub, { config, nonce }, { fetchCards })` → `{ cards, boosters }`; `buildPoolSeedString`. Server-side. |
| `src/lib/tournamentStore.js` | SQL for `tournaments` (create/get/list/update/delete/count) + `toTournamentJson`. |
| `api/_lib/request.js` | `queryParam(req, name)`, `jsonBody(req)` shared by handlers. |
| `api/tournaments/index.js` | GET list (public, optional bearer) / POST create. |
| `api/tournaments/[id].js` | GET detail / PATCH / DELETE. |
| `api/tournaments/[id]/pool.js` | GET get-or-create the caller's pool for a tournament. |
| `scripts/freeze-sealed-pools.mjs` | One-shot: store `cards`/`boosters` on every legacy row. |
| `tests/integration/tournaments.test.js` | Store + handlers against real Postgres (mocked `buildPool` and auth). |
| `src/components/SetPresetGrid.jsx` | The set grid extracted from the Lobby's presets tab. |
| `src/components/TournamentUniqueFields.jsx` | Steppers + even-factions checkbox. |
| `src/components/TournamentChecklist.jsx` | The 3-step wizard block. |
| `src/pages/TournamentForm.jsx` | Create / edit a tournament. |
| `src/pages/TournamentDetail.jsx` | Tournament page (checklist + organizer panel). |
| `src/pages/TournamentPoolPage.jsx` | `TournamentPoolView` for a tournament pool. |

**Modified**

| File | Change |
| --- | --- |
| `sealed-pools-schema.sql` | `tournaments` table, new `sealed_pools` columns + index, `created_by` backfill. |
| `docker-compose.test.yml` | Mount `sealed-pools-schema.sql` in the test Postgres. |
| `src/lib/uniqueFactionRanges.js` | `isAllowed` option on `pickDeterministicUniques`; `hasFactionRanges(setCode)`. |
| `src/lib/poolStore.js` | Stored pools on insert/reset; `getOrCreateTournamentPool`; new `bindTournamentId` order; tournament join in `listBoundTournamentPools`; counters. |
| `api/_lib/tournamentPool.js` | `loadPool` / `loadPoolCounts` (stored or regenerate); `poolResponse` extra. |
| `api/_lib/auth.js` | `verifyUser`, `isModerator`, `decodeJwtPayload`. |
| `api/tournament-normal-pool.js`, `api/tournament-prep-pool.js`, `api/tournament-pool.js`, `api/tournament-pool-counts.js`, `api/tournament-pool-by-deck.js`, `api/tournament-bga-decklist.js` | Call `loadPool`/`loadPoolCounts`; pass `createdBy: 'bga'` on the BGA path. |
| `api/tournament-bound-pools.js` | Add `tournament` per pool. |
| `server/index.js` | Mount the three new routes. |
| `src/lib/tournamentApi.js` | New client functions. |
| `src/components/SettingsFields.jsx` | `showLang` prop. |
| `src/components/TournamentPoolView.jsx` | Optional `backTo` prop. |
| `src/pages/Lobby.jsx` | Use `SetPresetGrid`. |
| `src/pages/TournamentMenu.jsx` | Public lists + my tournaments + generic prep at the bottom. |
| `src/App.jsx` | Routes. |
| `src/lib/i18n/en.js`, `fr.js` | `tournaments.*` namespace. |
| `.env.example`, `docs/tournaments/README.md`, `CLAUDE.md`, `ROADMAP.md`, `TESTING.md` | Docs. |

Test helpers for handlers (`mockRes`, `call`) are copied from `tests/integration/rooms.test.js`.

---

### Task 1: BGA URL parsing and tournament rules (pure)

**Files:**
- Create: `src/lib/bgaUrl.js`, `src/lib/bgaUrl.test.js`
- Create: `src/lib/tournamentRules.js`, `src/lib/tournamentRules.test.js`

**Interfaces:**
- Produces: `parseBgaTournamentUrl(input) → { id: string, url: string } | null`
- Produces: `tournamentStatus(row, now = new Date()) → 'upcoming'|'ongoing'|'ended'|'cancelled'` (accepts snake_case rows and camelCase JSON)
- Produces: `validateTournamentFields(body, { now, isCreate, current }) → { ok, errors: Record<string,string>, values: { name?, description?, startsAt?: Date, endsAt?: Date|null, bgaUrl?, bgaTournamentId? } }`
- Produces: constants `NAME_MIN = 3`, `NAME_MAX = 80`, `DESCRIPTION_MAX = 2000`, `MAX_OPEN_TOURNAMENTS = 10`, `OPEN_STATUSES = ['upcoming', 'ongoing']`

- [x] **Step 1: Write the failing tests**

`src/lib/bgaUrl.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { parseBgaTournamentUrl } from './bgaUrl.js'

describe('parseBgaTournamentUrl', () => {
  it('accepts the canonical tournament link', () => {
    expect(parseBgaTournamentUrl('https://boardgamearena.com/tournament?id=597924'))
      .toEqual({ id: '597924', url: 'https://boardgamearena.com/tournament?id=597924' })
  })

  it('accepts locale subdomains, uppercase host, trailing slash and extra params, and canonicalizes', () => {
    expect(parseBgaTournamentUrl('HTTPS://FR.boardgamearena.com/tournament/?id=5&foo=bar'))
      .toEqual({ id: '5', url: 'https://boardgamearena.com/tournament?id=5' })
    expect(parseBgaTournamentUrl('  https://en.boardgamearena.com/tournament?id=42  '))
      .toEqual({ id: '42', url: 'https://boardgamearena.com/tournament?id=42' })
  })

  it('rejects http, other hosts, other paths, non-numeric ids and garbage', () => {
    expect(parseBgaTournamentUrl('http://boardgamearena.com/tournament?id=1')).toBeNull()
    expect(parseBgaTournamentUrl('https://boardgamearena.com.evil.io/tournament?id=1')).toBeNull()
    expect(parseBgaTournamentUrl('https://notboardgamearena.com/tournament?id=1')).toBeNull()
    expect(parseBgaTournamentUrl('https://boardgamearena.com/tournamentlist?id=1')).toBeNull()
    expect(parseBgaTournamentUrl('https://boardgamearena.com/tournament?id=abc')).toBeNull()
    expect(parseBgaTournamentUrl('https://boardgamearena.com/tournament')).toBeNull()
    expect(parseBgaTournamentUrl('not a url')).toBeNull()
    expect(parseBgaTournamentUrl(null)).toBeNull()
  })
})
```

`src/lib/tournamentRules.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { tournamentStatus, validateTournamentFields } from './tournamentRules.js'

const NOW = new Date('2026-11-01T12:00:00Z')
const later = '2026-11-02T19:00:00Z'
const earlier = '2026-10-30T19:00:00Z'

describe('tournamentStatus', () => {
  it('derives upcoming / ongoing / ended / cancelled, cancelled winning over everything', () => {
    expect(tournamentStatus({ starts_at: later }, NOW)).toBe('upcoming')
    expect(tournamentStatus({ starts_at: earlier }, NOW)).toBe('ongoing')
    expect(tournamentStatus({ starts_at: earlier, ends_at: '2026-10-31T00:00:00Z' }, NOW)).toBe('ended')
    expect(tournamentStatus({ starts_at: earlier, ends_at: later }, NOW)).toBe('ongoing')
    expect(tournamentStatus({ starts_at: later, ended_at: earlier }, NOW)).toBe('ended')
    expect(tournamentStatus({ starts_at: earlier, ended_at: earlier, cancelled_at: earlier }, NOW)).toBe('cancelled')
  })

  it('accepts camelCase JSON rows too', () => {
    expect(tournamentStatus({ startsAt: later, cancelledAt: null }, NOW)).toBe('upcoming')
    expect(tournamentStatus({ startsAt: later, cancelledAt: earlier }, NOW)).toBe('cancelled')
  })
})

describe('validateTournamentFields (create)', () => {
  const good = { name: '  Winter Cup ', description: 'd', startsAt: later, endsAt: null, bgaUrl: 'https://boardgamearena.com/tournament?id=7' }

  it('normalizes a valid payload', () => {
    const r = validateTournamentFields(good, { now: NOW, isCreate: true })
    expect(r.ok).toBe(true)
    expect(r.values).toEqual({
      name: 'Winter Cup', description: 'd', startsAt: new Date(later), endsAt: null,
      bgaUrl: 'https://boardgamearena.com/tournament?id=7', bgaTournamentId: '7',
    })
  })

  it('requires every field on create and reports each error by field', () => {
    const r = validateTournamentFields({}, { now: NOW, isCreate: true })
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual({ name: 'invalid_length', startsAt: 'invalid_date', bgaUrl: 'invalid_bga_url' })
  })

  it('rejects a start in the past on create, a too-long name/description, an end before the start', () => {
    expect(validateTournamentFields({ ...good, startsAt: earlier }, { now: NOW, isCreate: true }).errors.startsAt).toBe('must_be_future')
    expect(validateTournamentFields({ ...good, name: 'ab' }, { now: NOW, isCreate: true }).errors.name).toBe('invalid_length')
    expect(validateTournamentFields({ ...good, name: 'x'.repeat(81) }, { now: NOW, isCreate: true }).errors.name).toBe('invalid_length')
    expect(validateTournamentFields({ ...good, description: 'x'.repeat(2001) }, { now: NOW, isCreate: true }).errors.description).toBe('too_long')
    expect(validateTournamentFields({ ...good, endsAt: '2026-11-02T18:00:00Z' }, { now: NOW, isCreate: true }).errors.endsAt).toBe('must_be_after_start')
  })
})

describe('validateTournamentFields (patch)', () => {
  const current = { starts_at: later, ends_at: '2026-11-10T00:00:00Z' }

  it('validates only the keys present, and allows a past start on edit', () => {
    const r = validateTournamentFields({ name: 'Renamed' }, { now: NOW, current })
    expect(r).toEqual({ ok: true, errors: {}, values: { name: 'Renamed' } })
    expect(validateTournamentFields({ startsAt: earlier }, { now: NOW, current }).ok).toBe(true)
  })

  it('rejects endsAt before the stored startsAt, and startsAt after the stored endsAt', () => {
    expect(validateTournamentFields({ endsAt: '2026-11-02T18:00:00Z' }, { now: NOW, current }).errors.endsAt).toBe('must_be_after_start')
    expect(validateTournamentFields({ startsAt: '2026-11-11T00:00:00Z' }, { now: NOW, current }).errors.startsAt).toBe('must_be_before_end')
  })

  it('treats an empty endsAt as clearing it', () => {
    expect(validateTournamentFields({ endsAt: '' }, { now: NOW, current }).values).toEqual({ endsAt: null })
  })
})
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/bgaUrl.test.js src/lib/tournamentRules.test.js`
Expected: FAIL — "Failed to resolve import ./bgaUrl.js" / "./tournamentRules.js".

- [x] **Step 3: Implement `src/lib/bgaUrl.js`**

```js
// A BGA tournament link as pasted by an organizer, reduced to its tournament id. Only
// boardgamearena.com (any locale subdomain) over https with a numeric `id` is accepted:
// the list of tournaments is public, so the stored link must never be an arbitrary URL.
const BGA_HOST = /(^|\.)boardgamearena\.com$/i

/**
 * @param {unknown} input
 * @returns {{ id: string, url: string } | null} the numeric id and the canonical link
 */
export function parseBgaTournamentUrl(input) {
  let url
  try {
    url = new URL(String(input ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (!BGA_HOST.test(url.hostname)) return null
  if (!/^\/tournament\/?$/.test(url.pathname)) return null
  const id = url.searchParams.get('id')
  if (!id || !/^\d+$/.test(id)) return null
  return { id, url: `https://boardgamearena.com/tournament?id=${id}` }
}
```

- [x] **Step 4: Implement `src/lib/tournamentRules.js`**

```js
// Pure rules for user-created tournaments (docs/tournaments/user-tournaments-spec.md §3.2, §9).
// Shared by the API handlers (server) and the form (browser) — no DB, no React here.
import { parseBgaTournamentUrl } from './bgaUrl.js'

export const NAME_MIN = 3
export const NAME_MAX = 80
export const DESCRIPTION_MAX = 2000
export const MAX_OPEN_TOURNAMENTS = 10
export const OPEN_STATUSES = ['upcoming', 'ongoing']

const pick = (row, snake, camel) => row?.[snake] ?? row?.[camel] ?? null

/**
 * Derived status (never stored): cancelled > ended (manual close, or ends_at reached)
 * > ongoing (starts_at reached) > upcoming. Accepts DB rows (snake_case) and API JSON.
 */
export function tournamentStatus(row, now = new Date()) {
  if (pick(row, 'cancelled_at', 'cancelledAt')) return 'cancelled'
  if (pick(row, 'ended_at', 'endedAt')) return 'ended'
  const endsAt = pick(row, 'ends_at', 'endsAt')
  if (endsAt && now >= new Date(endsAt)) return 'ended'
  const startsAt = pick(row, 'starts_at', 'startsAt')
  if (startsAt && now >= new Date(startsAt)) return 'ongoing'
  return 'upcoming'
}

function parseDate(value) {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Validates the non-config fields of a tournament payload. On create every field is
 * required; on patch (`isCreate` false) only the keys present in `body` are validated,
 * against `current` (the stored row) for the cross-field date checks.
 * @returns {{ ok: boolean, errors: Record<string, string>, values: object }}
 */
export function validateTournamentFields(body, { now = new Date(), isCreate = false, current = null } = {}) {
  const errors = {}
  const values = {}
  const has = key => body != null && Object.prototype.hasOwnProperty.call(body, key)

  if (isCreate || has('name')) {
    const name = String(body?.name ?? '').trim()
    if (name.length < NAME_MIN || name.length > NAME_MAX) errors.name = 'invalid_length'
    else values.name = name
  }

  if (isCreate || has('description')) {
    const description = String(body?.description ?? '').trim()
    if (description.length > DESCRIPTION_MAX) errors.description = 'too_long'
    else values.description = description
  }

  if (isCreate || has('startsAt')) {
    const d = parseDate(body?.startsAt)
    if (!d) errors.startsAt = 'invalid_date'
    else if (isCreate && d <= now) errors.startsAt = 'must_be_future'
    else values.startsAt = d
  }

  if (isCreate || has('endsAt')) {
    if (body?.endsAt == null || body.endsAt === '') {
      values.endsAt = null
    } else {
      const d = parseDate(body.endsAt)
      const startsAt = values.startsAt ?? (current ? parseDate(current.starts_at ?? current.startsAt) : null)
      if (!d) errors.endsAt = 'invalid_date'
      else if (startsAt && d <= startsAt) errors.endsAt = 'must_be_after_start'
      else values.endsAt = d
    }
  }

  // Moving the start past a stored end (when the patch doesn't touch the end) would make
  // the tournament "ended" before it starts.
  if (values.startsAt && !has('endsAt') && current) {
    const storedEnd = parseDate(current.ends_at ?? current.endsAt)
    if (storedEnd && storedEnd <= values.startsAt) errors.startsAt = 'must_be_before_end'
  }

  if (isCreate || has('bgaUrl')) {
    const parsed = parseBgaTournamentUrl(body?.bgaUrl)
    if (!parsed) errors.bgaUrl = 'invalid_bga_url'
    else {
      values.bgaUrl = parsed.url
      values.bgaTournamentId = parsed.id
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, values }
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/bgaUrl.test.js src/lib/tournamentRules.test.js`
Expected: PASS (all tests green).

- [x] **Step 6: Commit**

```bash
git add src/lib/bgaUrl.js src/lib/bgaUrl.test.js src/lib/tournamentRules.js src/lib/tournamentRules.test.js
git commit -m "Add BGA link parsing and tournament field rules

Pure helpers for the user-created tournaments feature: canonical BGA
tournament links, derived tournament status and payload validation
shared by the API and the form.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Tournament config object + unique picker options

**Files:**
- Create: `src/lib/tournamentConfig.js`, `src/lib/tournamentConfig.test.js`
- Modify: `src/lib/uniqueFactionRanges.js` (the `pickDeterministicUniques` signature and its retry loop, ~lines 97–122; add `hasFactionRanges`)
- Modify: `src/lib/uniqueFactionRanges.test.js` (append two tests)

**Interfaces:**
- Produces: `validateTournamentConfig(input) → { ok, errors: string[], config }` (normalized config, see spec §5.1)
- Produces: `configFromLegacyFormat(row) → config` (from a `current_format` or `sealed_pools` row)
- Produces: `legacyColumnsFromConfig(config) → { set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques }`
- Produces: constants `CONFIG_VERSION = 1`, `SEALED_BOOSTERS = 7`, `MAX_UNIQUES = 7`
- Produces: `hasFactionRanges(setCode) → boolean`; `pickDeterministicUniques(setCode, rng, { uniqueCount, evenFactions, isAllowed })`

- [x] **Step 1: Write the failing tests**

`src/lib/tournamentConfig.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { validateTournamentConfig, configFromLegacyFormat, legacyColumnsFromConfig } from './tournamentConfig.js'

const valid = {
  format: 'sealed',
  source: { type: 'set', setCode: 'CYCLONE', boosters: 7 },
  heroes: 'packs',
  uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false },
  excludeBanlist: true,
}

describe('validateTournamentConfig', () => {
  it('normalizes a valid config (numbers coerced, booleans defaulted, version stamped)', () => {
    const r = validateTournamentConfig({ ...valid, uniques: { inBoosters: '2', guaranteed: 0 }, excludeBanlist: undefined })
    expect(r.ok).toBe(true)
    expect(r.config).toEqual({
      v: 1, format: 'sealed',
      source: { type: 'set', setCode: 'CYCLONE', boosters: 7 },
      heroes: 'packs',
      uniques: { inBoosters: 2, guaranteed: 0, evenFactions: false },
      excludeBanlist: false,
    })
  })

  it('accepts a missing format/boosters (defaults) but rejects other values', () => {
    expect(validateTournamentConfig({ ...valid, format: undefined, source: { type: 'set', setCode: 'EOLE' } }).ok).toBe(true)
    expect(validateTournamentConfig({ ...valid, format: 'draft' }).errors).toContain('format')
    expect(validateTournamentConfig({ ...valid, source: { ...valid.source, boosters: 6 } }).errors).toContain('source.boosters')
  })

  it('rejects unknown/hidden sets, other source types, bad hero modes and out-of-range uniques', () => {
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'NOPE' } }).errors).toContain('source.setCode')
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'COREKS' } }).errors).toContain('source.setCode')
    expect(validateTournamentConfig({ ...valid, source: { type: 'cube', setCode: 'CORE' } }).errors).toContain('source.type')
    expect(validateTournamentConfig({ ...valid, heroes: 'draft' }).errors).toContain('heroes')
    expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 8, guaranteed: 0 } }).errors).toContain('uniques.inBoosters')
    expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 0, guaranteed: -1 } }).errors).toContain('uniques.guaranteed')
    expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 'x', guaranteed: 0 } }).errors).toContain('uniques.inBoosters')
  })

  it('rejects uniques on a set without faction-range data (FUGUE) but allows zero', () => {
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'FUGUE' } }).errors).toContain('uniques.unsupportedSet')
    expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'FUGUE' }, uniques: { inBoosters: 0, guaranteed: 0 } }).ok).toBe(true)
  })

  it('rejects non-object input without throwing', () => {
    expect(validateTournamentConfig(null).ok).toBe(false)
    expect(validateTournamentConfig('x').ok).toBe(false)
  })
})

describe('legacy format <-> config', () => {
  const row = { set_code: 'EOLE', unique_count: 1, even_factions: false, heroes_in_pool: false, guaranteed_uniques: 1 }

  it('converts a current_format row into a config', () => {
    expect(configFromLegacyFormat(row)).toEqual({
      v: 1, format: 'sealed',
      source: { type: 'set', setCode: 'EOLE', boosters: 7 },
      heroes: 'free',
      uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false },
      excludeBanlist: false,
    })
  })

  it('round-trips through legacyColumnsFromConfig', () => {
    expect(legacyColumnsFromConfig(configFromLegacyFormat(row))).toEqual(row)
  })

  it('defaults a missing guaranteed_uniques to 0', () => {
    expect(configFromLegacyFormat({ ...row, guaranteed_uniques: undefined }).uniques.guaranteed).toBe(0)
  })
})
```

Append to `src/lib/uniqueFactionRanges.test.js`:

```js
import { pickDeterministicUniques, hasFactionRanges } from './uniqueFactionRanges.js'
import { mulberry32, hashSeed } from './prng.js'

describe('pickDeterministicUniques isAllowed / hasFactionRanges', () => {
  it('skips refs the predicate rejects and still returns the requested count', () => {
    const rng = () => mulberry32(hashSeed('seed'))
    const first = pickDeterministicUniques('EOLE', rng(), { uniqueCount: 1 })[0]
    const picked = pickDeterministicUniques('EOLE', rng(), { uniqueCount: 1, isAllowed: ref => ref !== first })
    expect(picked).toHaveLength(1)
    expect(picked[0]).not.toBe(first)
  })

  it('reports which sets have faction-range data', () => {
    expect(hasFactionRanges('EOLE')).toBe(true)
    expect(hasFactionRanges('FUGUE')).toBe(false)
  })
})
```

(Keep the file's existing imports; if `describe`/`it`/`expect` are already imported at the top, don't import them twice.)

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/tournamentConfig.test.js src/lib/uniqueFactionRanges.test.js`
Expected: FAIL — unresolved import `./tournamentConfig.js`; `hasFactionRanges` is not exported; the `isAllowed` test fails because the predicate is ignored.

- [x] **Step 3: Modify `src/lib/uniqueFactionRanges.js`**

Replace the `pickDeterministicUniques` signature and retry loop:

```js
/** Whether per-family faction-window data exists for `setCode` (FUGUE has none yet). */
export function hasFactionRanges(setCode) {
  return !!FACTION_RANGES_BY_SET[setCode]
}

export function pickDeterministicUniques(setCode, rng, { uniqueCount = 0, evenFactions = false, isAllowed = () => true } = {}) {
  const rangesForSet = FACTION_RANGES_BY_SET[setCode]
  if (!rangesForSet || uniqueCount <= 0) return []

  const seen = new Set()
  const refs = []
  const targets = evenFactions ? evenFactionTargets(rng, uniqueCount) : Array(uniqueCount).fill(null)

  for (const target of targets) {
    const candidates = buildCandidates(rangesForSet, target)
    if (!candidates.length) continue
    // Retry on a serial already picked (astronomically unlikely) or one the caller
    // rejects (e.g. a banned unique family when the ban list is on).
    for (let attempt = 0; attempt < 10; attempt++) {
      const { family, faction, windows } = pickWeighted(candidates, rng)
      const serial = pickSerialInWindows(windows, rng)
      const ref = `ALT_${setCode}_B_${family}_U_${serial}`
      if (!seen.has(ref) && isAllowed(ref)) {
        seen.add(ref)
        refs.push(ref)
        break
      }
    }
  }
  return refs
}
```

(`faction` was already unused in the destructuring; leave it as the file has it.)

- [x] **Step 4: Implement `src/lib/tournamentConfig.js`**

```js
// The sealed configuration object of a tournament (docs/tournaments/user-tournaments-spec.md
// §5.1). One shape for declared tournaments, for the legacy `current_format` (converted on
// read) and, from lot 2 on, for the Lobby. Pure: shared by server validation and the form.
import { SETS } from './cardData.js'
import { hasFactionRanges } from './uniqueFactionRanges.js'

export const CONFIG_VERSION = 1
export const SEALED_BOOSTERS = 7
export const MAX_UNIQUES = 7
export const HERO_MODES = ['packs', 'free']

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(String(value))
  return Number.isInteger(n) ? n : null
}

/**
 * Validates and normalizes a config. `errors` lists dotted paths of the offending fields.
 * @returns {{ ok: boolean, errors: string[], config: object | null }}
 */
export function validateTournamentConfig(input) {
  const errors = []
  const c = input && typeof input === 'object' ? input : {}

  if (c.format !== undefined && c.format !== 'sealed') errors.push('format')

  const src = c.source && typeof c.source === 'object' ? c.source : {}
  if (src.type !== 'set') errors.push('source.type')
  const set = SETS.find(s => s.code === src.setCode && !s.hidden) ?? null
  if (!set) errors.push('source.setCode')
  if (src.boosters !== undefined && src.boosters !== SEALED_BOOSTERS) errors.push('source.boosters')

  if (!HERO_MODES.includes(c.heroes)) errors.push('heroes')

  const u = c.uniques && typeof c.uniques === 'object' ? c.uniques : {}
  const inBoosters = toInt(u.inBoosters, 0)
  const guaranteed = toInt(u.guaranteed, 0)
  if (inBoosters === null || inBoosters < 0 || inBoosters > MAX_UNIQUES) errors.push('uniques.inBoosters')
  if (guaranteed === null || guaranteed < 0 || guaranteed > MAX_UNIQUES) errors.push('uniques.guaranteed')
  if (u.evenFactions !== undefined && typeof u.evenFactions !== 'boolean') errors.push('uniques.evenFactions')
  if (set && ((inBoosters ?? 0) > 0 || (guaranteed ?? 0) > 0) && !hasFactionRanges(set.code)) errors.push('uniques.unsupportedSet')

  if (c.excludeBanlist !== undefined && typeof c.excludeBanlist !== 'boolean') errors.push('excludeBanlist')

  if (errors.length) return { ok: false, errors, config: null }
  return {
    ok: true,
    errors: [],
    config: {
      v: CONFIG_VERSION,
      format: 'sealed',
      source: { type: 'set', setCode: set.code, boosters: SEALED_BOOSTERS },
      heroes: c.heroes,
      uniques: { inBoosters, guaranteed, evenFactions: !!u.evenFactions },
      excludeBanlist: !!c.excludeBanlist,
    },
  }
}

/** A `current_format` (or legacy `sealed_pools`) row expressed as a config. */
export function configFromLegacyFormat(row) {
  return {
    v: CONFIG_VERSION,
    format: 'sealed',
    source: { type: 'set', setCode: row.set_code, boosters: SEALED_BOOSTERS },
    heroes: row.heroes_in_pool ? 'packs' : 'free',
    uniques: {
      inBoosters: row.unique_count ?? 0,
      guaranteed: row.guaranteed_uniques ?? 0,
      evenFactions: !!row.even_factions,
    },
    excludeBanlist: false,
  }
}

/** The legacy snapshot columns of `sealed_pools` for a config (they stay NOT NULL in lot 1). */
export function legacyColumnsFromConfig(config) {
  return {
    set_code: config.source.setCode,
    unique_count: config.uniques.inBoosters,
    even_factions: config.uniques.evenFactions,
    heroes_in_pool: config.heroes === 'packs',
    guaranteed_uniques: config.uniques.guaranteed,
  }
}
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/tournamentConfig.test.js src/lib/uniqueFactionRanges.test.js`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/lib/tournamentConfig.js src/lib/tournamentConfig.test.js src/lib/uniqueFactionRanges.js src/lib/uniqueFactionRanges.test.js
git commit -m "Add the tournament config object and an isAllowed filter for unique draws

The config is the single sealed-settings shape shared by declared
tournaments and the legacy current_format row. The unique picker can
now reject refs (ban list), and reports which sets have range data.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The single pool-generation entry point (`poolBuilder.js`)

**Files:**
- Create: `src/lib/poolBuilder.js`, `src/lib/poolBuilder.test.js`
- Modify: `src/lib/poolStore.js` (remove its `buildPoolSeedString` body, re-export from poolBuilder)

**Interfaces:**
- Consumes: `legacyColumnsFromConfig`, `SEALED_BOOSTERS` (Task 2); `pickDeterministicUniques` with `isAllowed` (Task 2); existing `generateTournamentSealedPool`, `hashSeed`, `mulberry32`, `fetchSet`, `filterBanned`, `isBanned`.
- Produces: `buildPoolSeedString(sub, cols)` (moved here; `poolStore.js` keeps re-exporting it so `api/_lib/tournamentPool.js` is untouched for now)
- Produces: `buildPool(sub, { config, nonce }, { fetchCards = fetchSet } = {}) → Promise<{ cards: Record<string, number>, boosters: string[][] }>` — throws on empty card data or when fewer uniques than requested could be drawn.

- [x] **Step 1: Write the failing test**

`src/lib/poolBuilder.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildPool, buildPoolSeedString } from './poolBuilder.js'
import { FACTIONS } from './cardData.js'

// A synthetic set: 2 heroes, 3 commons per faction, 4 rares (+ 1 banned common).
function fakeSet() {
  const cards = []
  cards.push({ reference: 'ALT_TEST_B_AX_01_C', name: 'Hero A', faction: 'AX', rarity: 'C', cardType: 'HERO' })
  cards.push({ reference: 'ALT_TEST_B_BR_01_C', name: 'Hero B', faction: 'BR', rarity: 'C', cardType: 'HERO' })
  let n = 10
  for (const f of FACTIONS) {
    for (let i = 0; i < 3; i++, n++) {
      cards.push({ reference: `ALT_TEST_B_${f}_${n}_C`, name: `Common ${f} ${i}`, faction: f, rarity: 'C', cardType: 'CHARACTER' })
    }
  }
  for (let i = 0; i < 4; i++, n++) {
    cards.push({ reference: `ALT_TEST_B_AX_${n}_R1`, name: `Rare ${i}`, faction: 'AX', rarity: 'R1', cardType: 'SPELL' })
  }
  // Same family as a banned CORE card: banlist.js keys on ALT_<SET>_B_<FACTION>_<NUM>.
  cards.push({ reference: 'ALT_CORE_B_BR_06_C', name: 'Banned one', faction: 'BR', rarity: 'C', cardType: 'CHARACTER' })
  return cards
}

const config = (over = {}) => ({
  v: 1, format: 'sealed',
  source: { type: 'set', setCode: 'TEST', boosters: 7 },
  heroes: 'packs',
  uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false },
  excludeBanlist: false,
  ...over,
})
const fetchCards = async () => fakeSet()

describe('buildPool', () => {
  it('is deterministic for the same sub/config/nonce and differs for another nonce', async () => {
    const a = await buildPool('alice', { config: config(), nonce: 'n1' }, { fetchCards })
    const b = await buildPool('alice', { config: config(), nonce: 'n1' }, { fetchCards })
    const c = await buildPool('alice', { config: config(), nonce: 'n2' }, { fetchCards })
    expect(a).toEqual(b)
    expect(c.boosters).not.toEqual(a.boosters)
  })

  it('deals 7 boosters of 13 (1 hero + 9 commons + 3 rares) and counts them', async () => {
    const { cards, boosters } = await buildPool('alice', { config: config(), nonce: 'n1' }, { fetchCards })
    expect(boosters).toHaveLength(7)
    for (const pack of boosters) expect(pack).toHaveLength(13)
    const total = Object.values(cards).reduce((s, n) => s + n, 0)
    expect(total).toBe(7 * 13)
  })

  it('with heroes "free", boosters have no hero and every hero is appended once to the pool', async () => {
    const { cards, boosters } = await buildPool('alice', { config: config({ heroes: 'free' }), nonce: 'n1' }, { fetchCards })
    for (const pack of boosters) expect(pack).toHaveLength(12)
    expect(cards['ALT_TEST_B_AX_01_C']).toBe(1)
    expect(cards['ALT_TEST_B_BR_01_C']).toBe(1)
  })

  it('excludes banned families when excludeBanlist is on', async () => {
    const seen = new Set()
    for (let i = 0; i < 20; i++) {
      const { cards } = await buildPool('alice', { config: config({ excludeBanlist: true }), nonce: `n${i}` }, { fetchCards })
      Object.keys(cards).forEach(r => seen.add(r))
    }
    expect(seen.has('ALT_CORE_B_BR_06_C')).toBe(false)
  })

  it('throws when the set has no cards', async () => {
    await expect(buildPool('alice', { config: config(), nonce: 'n1' }, { fetchCards: async () => [] })).rejects.toThrow(/no cards/)
  })

  it('draws real uniques for a set with range data, in-booster ones inside rare slots, guaranteed ones outside', async () => {
    const cfg = config({ source: { type: 'set', setCode: 'EOLE', boosters: 7 }, uniques: { inBoosters: 1, guaranteed: 1, evenFactions: false } })
    const { cards, boosters } = await buildPool('alice', { config: cfg, nonce: 'n1' }, { fetchCards })
    const inPacks = boosters.flat().filter(r => r.includes('_U_'))
    const all = Object.keys(cards).filter(r => r.includes('_U_'))
    expect(inPacks).toHaveLength(1)
    expect(all).toHaveLength(2)
    expect(inPacks[0]).toMatch(/^ALT_EOLE_B_/)
  })
})

describe('buildPoolSeedString', () => {
  it('matches the legacy seed layout exactly (tournament_id is NOT part of it)', () => {
    const s = buildPoolSeedString('sub1', { set_code: 'EOLE', unique_count: 1, even_factions: false, heroes_in_pool: false, guaranteed_uniques: 1, nonce: 'N', tournament_id: 'ignored' })
    expect(s).toBe('sub1|EOLE|1|false|false|1|N')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/poolBuilder.test.js`
Expected: FAIL — unresolved import `./poolBuilder.js`.

- [x] **Step 3: Implement `src/lib/poolBuilder.js`**

```js
// The ONE place a sealed pool is generated from a config (docs/tournaments/user-tournaments-spec.md
// §5.2). Server-side only (imports card data fetching). Lot 1 = the legacy regeneration
// logic (seeded PRNG + deterministic uniques + generateTournamentSealedPool), now also
// honouring `excludeBanlist`. Callers STORE the result on the pool row; this function is
// still deterministic so a legacy row (no stored cards) reproduces bit for bit.
import { hashSeed, mulberry32 } from './prng.js'
import { generateTournamentSealedPool } from './packGenerator.js'
import { pickDeterministicUniques } from './uniqueFactionRanges.js'
import { fetchSet } from './cardData.js'
import { filterBanned, isBanned } from './banlist.js'
import { legacyColumnsFromConfig, SEALED_BOOSTERS } from './tournamentConfig.js'

/**
 * The exact string fed into hashSeed() for a pool. Deliberately excludes tournament_id:
 * a pool's contents must not change when it gets bound to a tournament.
 * @param {string} sub
 * @param {{set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques?, nonce}} cols
 */
export function buildPoolSeedString(sub, cols) {
  return [
    sub,
    cols.set_code,
    String(cols.unique_count),
    String(cols.even_factions),
    String(cols.heroes_in_pool),
    String(cols.guaranteed_uniques ?? 0),
    cols.nonce,
  ].join('|')
}

/**
 * @param {string} sub - verified Keycloak sub of the pool's owner
 * @param {{ config: object, nonce: string }} pool - a validated config (tournamentConfig.js) + the row's nonce
 * @param {{ fetchCards?: (setCode: string) => Promise<object[]> }} deps - test seam; defaults to fetchSet
 * @returns {Promise<{ cards: Record<string, number>, boosters: string[][] }>}
 */
export async function buildPool(sub, { config, nonce }, { fetchCards = fetchSet } = {}) {
  const setCode = config.source.setCode
  const cols = { ...legacyColumnsFromConfig(config), nonce }
  const seedStr = buildPoolSeedString(sub, cols)

  const inBooster = config.uniques.inBoosters
  const outside = config.uniques.guaranteed
  const wanted = inBooster + outside
  const isAllowed = config.excludeBanlist ? ref => !isBanned(ref) : undefined
  // One deterministic stream for every unique, then split: the first `inBooster` replace
  // rare slots, the rest are handed out next to the boosters (like appended heroes).
  const allUniques = pickDeterministicUniques(setCode, mulberry32(hashSeed(`${seedStr}#uniques`)), {
    uniqueCount: wanted,
    evenFactions: config.uniques.evenFactions,
    ...(isAllowed ? { isAllowed } : {}),
  })
  if (allUniques.length < wanted) {
    throw new Error(`could only draw ${allUniques.length}/${wanted} uniques for ${setCode}`)
  }
  const boosterUniques = allUniques.slice(0, inBooster)
  const outsideUniques = allUniques.slice(inBooster)

  let cards = await fetchCards(setCode)
  if (!cards?.length) throw new Error(`no cards loaded for ${setCode}`)
  if (config.excludeBanlist) cards = filterBanned(cards)

  const includeHeroes = config.heroes === 'packs'
  const boosters = generateTournamentSealedPool(cards, mulberry32(hashSeed(seedStr)), {
    boosters: config.source.boosters ?? SEALED_BOOSTERS,
    uniqueRefs: boosterUniques,
    includeHeroes,
  })

  const counts = {}
  for (const ref of boosters.flat()) counts[ref] = (counts[ref] ?? 0) + 1
  for (const ref of outsideUniques) counts[ref] = (counts[ref] ?? 0) + 1
  if (!includeHeroes) {
    for (const card of cards) {
      if (card.cardType === 'HERO') counts[card.reference] = (counts[card.reference] ?? 0) + 1
    }
  }
  return { cards: counts, boosters }
}
```

- [x] **Step 4: Point `poolStore.js` at the moved seed helper**

In `src/lib/poolStore.js`, delete the whole `export function buildPoolSeedString(sub, pool) { … }` block (with its doc comment) and add near the top, after the `query` import:

```js
import { buildPoolSeedString } from './poolBuilder.js'
// Re-exported: api/_lib/tournamentPool.js and the freeze script import it from here.
export { buildPoolSeedString }
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/lib/poolBuilder.test.js && npm test`
Expected: PASS, and the whole unit suite still green (nothing else referenced the removed body).

- [x] **Step 6: Commit**

```bash
git add src/lib/poolBuilder.js src/lib/poolBuilder.test.js src/lib/poolStore.js
git commit -m "Add poolBuilder, the single sealed pool generation entry point

Same deterministic output as the legacy regeneration for a legacy
config, plus ban-list support. Pools generated here get stored on the
row by the next commits.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Schema migration + test Postgres wiring + `loadPool`

**Files:**
- Modify: `sealed-pools-schema.sql` (append at the end)
- Modify: `docker-compose.test.yml` (volumes)
- Modify: `api/_lib/tournamentPool.js` (`regeneratePool` body → `buildPool`; add `loadPool` / `loadPoolCounts`; `poolResponse` extra)
- Modify: call sites — `api/tournament-normal-pool.js`, `api/tournament-prep-pool.js`, `api/tournament-pool.js`, `api/tournament-pool-counts.js`, `api/tournament-pool-by-deck.js`, `api/_lib/tournamentPool.js` (`ensureDeck`)
- Create: `tests/integration/tournaments.test.js` (first describe only; later tasks append)

**Interfaces:**
- Produces (SQL): table `tournaments`; `sealed_pools.tournament_ref uuid`, `config jsonb`, `cards jsonb`, `boosters jsonb`, `created_by text`; unique index `sealed_pools_one_per_sub_per_tournament_ref`.
- Produces: `loadPool(sub, poolRow) → Promise<{ counts, boosters }>` (stored or regenerated), `loadPoolCounts(sub, poolRow) → Promise<counts>`, `regeneratePool(sub, poolRow)` (legacy-only, kept for the freeze script), `poolResponse(poolRow, counts, boosters, gamesPlayed, extra = {})`.

- [x] **Step 1: Append the DDL to `sealed-pools-schema.sql`**

```sql
-- ---------------------------------------------------------------------------------
-- User-created tournaments (docs/tournaments/user-tournaments-spec.md §4).
-- ---------------------------------------------------------------------------------
create table if not exists tournaments (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text not null default '',
  format            text not null default 'sealed' check (format in ('sealed')),
  bga_url           text not null,
  bga_tournament_id text not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  organizer_sub     text not null,
  organizer_name    text not null,
  config            jsonb not null,
  cancelled_at      timestamptz,
  ended_at          timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- One altered-draft tournament per BGA tournament, cancelled ones included (a cancelled
-- tournament's pools still answer BGA for that id; reuse = restore it).
create unique index if not exists tournaments_bga_tournament_id on tournaments (bga_tournament_id);
create index if not exists tournaments_organizer on tournaments (organizer_sub);
create index if not exists tournaments_starts_at on tournaments (starts_at);

-- Pools attached to a declared tournament, and stored pool contents (every pool created
-- after this migration stores what it generated; older rows keep being regenerated until
-- scripts/freeze-sealed-pools.mjs stores them too).
alter table sealed_pools add column if not exists tournament_ref uuid references tournaments(id);
alter table sealed_pools add column if not exists config jsonb;
alter table sealed_pools add column if not exists cards jsonb;
alter table sealed_pools add column if not exists boosters jsonb;
alter table sealed_pools add column if not exists created_by text;
update sealed_pools set created_by = 'legacy' where created_by is null;
create unique index if not exists sealed_pools_one_per_sub_per_tournament_ref
  on sealed_pools (sub, tournament_ref) where tournament_ref is not null;
```

- [x] **Step 2: Mount the schema in the test Postgres**

In `docker-compose.test.yml`, under `volumes:` of `postgres-test`, add after the existing line:

```yaml
      - ./sealed-pools-schema.sql:/docker-entrypoint-initdb.d/02-sealed-pools-schema.sql:ro
```

Also update the file's header comment: "just the draft_rooms table" → "the draft_rooms, sealed_pools and tournaments tables these tests exercise".

- [x] **Step 3: Write the failing integration test (schema smoke)**

`tests/integration/tournaments.test.js`:

```js
// Integration tests for the user-created tournaments feature (store + handlers) against
// the REAL Postgres of docker-compose.test.yml. Pool generation is mocked (no network):
// buildPool returns a tiny fixed pool, which is all the SQL paths need.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { query, getPool } from '../../src/lib/db.js'

vi.mock('../../src/lib/poolBuilder.js', async importOriginal => {
  const mod = await importOriginal()
  return {
    ...mod,
    buildPool: vi.fn(async (sub, { config, nonce }) => ({
      cards: { [`ALT_${config.source.setCode}_B_AX_01_C`]: 2, [`ALT_${config.source.setCode}_B_BR_02_R1`]: 1, [`NONCE_${nonce}`]: 1 },
      boosters: [[`ALT_${config.source.setCode}_B_AX_01_C`, `ALT_${config.source.setCode}_B_AX_01_C`, `ALT_${config.source.setCode}_B_BR_02_R1`, `NONCE_${nonce}`]],
    })),
  }
})

beforeEach(async () => {
  await query('TRUNCATE sealed_pool_games, sealed_pools, tournaments')
})

afterAll(async () => {
  await getPool().end()
})

describe('schema', () => {
  it('has the tournaments table and the new sealed_pools columns', async () => {
    const { rows } = await query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'sealed_pools' AND column_name = ANY($1)",
      [['tournament_ref', 'config', 'cards', 'boosters', 'created_by']],
    )
    expect(rows.map(r => r.column_name).sort()).toEqual(['boosters', 'cards', 'config', 'created_by', 'tournament_ref'])
    const t = await query("SELECT 1 FROM information_schema.tables WHERE table_name = 'tournaments'")
    expect(t.rows).toHaveLength(1)
  })
})
```

- [x] **Step 4: Run it to verify it fails**

Run: `npm run test:integration -- tests/integration/tournaments.test.js`
Expected: the container starts; FAIL on the schema assertions until Steps 1–2 are in place (if you did them first, it passes — that's fine, go on).

- [x] **Step 5: Rewrite the generation part of `api/_lib/tournamentPool.js`**

Replace the imports and the `regeneratePool` / `regeneratePoolCounts` functions with:

```js
import { buildPool } from '../../src/lib/poolBuilder.js'
import { configFromLegacyFormat } from '../../src/lib/tournamentConfig.js'
import { fetchSet, fetchUniques, isUniqueRef } from '../../src/lib/cardData.js'
import { updateDeckSummary } from '../../src/lib/poolStore.js'
import { buildRandomDeck } from '../../src/lib/randomDeck.js'
import { endpoints } from '../../src/lib/endpoints.js'

/**
 * LEGACY rows only (created before pools were stored): regenerates the pool from the
 * row's snapshot columns + nonce. Bit-for-bit the pre-storage behaviour, via poolBuilder.
 * Used by loadPool() below and by scripts/freeze-sealed-pools.mjs.
 */
export async function regeneratePool(sub, poolRow) {
  const { cards, boosters } = await buildPool(sub, { config: configFromLegacyFormat(poolRow), nonce: poolRow.nonce })
  return { counts: cards, boosters }
}

/** The pool's contents: stored on the row when present, else regenerated (legacy rows). */
export async function loadPool(sub, poolRow) {
  if (poolRow.cards) return { counts: poolRow.cards, boosters: poolRow.boosters ?? [] }
  return regeneratePool(sub, poolRow)
}

/** Just the flat counts (deck-validation / summary callers). */
export async function loadPoolCounts(sub, poolRow) {
  return (await loadPool(sub, poolRow)).counts
}
```

(Drop the now-unused imports `hashSeed`, `mulberry32`, `generateTournamentSealedPool`, `pickDeterministicUniques`, `buildPoolSeedString`.) In `ensureDeck`, change `const { counts } = await regeneratePool(sub, poolRow)` to `const { counts } = await loadPool(sub, poolRow)`.

Change `poolResponse`'s signature to `export function poolResponse(poolRow, cardCounts, boosters = null, gamesPlayed = null, extra = {})` and add, inside the returned object after `gamesPlayed`:

```js
    ...(poolRow.tournament_ref ? { tournamentRef: poolRow.tournament_ref } : {}),
    ...(extra.tournament ? { tournament: extra.tournament } : {}),
```

- [x] **Step 6: Switch every call site to `loadPool` / `loadPoolCounts`**

- `api/tournament-normal-pool.js`: import `loadPool` instead of `regeneratePool`; both `regeneratePool(` calls → `loadPool(`.
- `api/tournament-prep-pool.js`: same (one call).
- `api/tournament-pool.js`: same (two calls).
- `api/tournament-pool-counts.js`: import `loadPoolCounts` instead of `regeneratePoolCounts`; the call → `loadPoolCounts(`.
- `api/tournament-pool-by-deck.js`: same.

Then: `grep -rn "regeneratePool" api/ server/ scripts/ src/` must show only `api/_lib/tournamentPool.js` (definition + `loadPool`).

- [x] **Step 7: Run unit + integration suites**

Run: `npm test && npm run test:integration`
Expected: PASS. (`rooms.test.js` still passes with the extra schema mounted.)

- [x] **Step 8: Commit**

```bash
git add sealed-pools-schema.sql docker-compose.test.yml api/_lib/tournamentPool.js api/tournament-normal-pool.js api/tournament-prep-pool.js api/tournament-pool.js api/tournament-pool-counts.js api/tournament-pool-by-deck.js tests/integration/tournaments.test.js
git commit -m "Add the tournaments table, stored-pool columns and loadPool

Pool reads now serve the stored cards/boosters when a row has them and
fall back to regeneration for legacy rows. The integration Postgres
mounts sealed-pools-schema.sql.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Store generated pools on insert and reset (legacy flows go through `buildPool`)

**Files:**
- Modify: `src/lib/poolStore.js` (`insertPool`, `getOrCreateNormalPool`, `resetNormalPool`, `getOrCreatePreparationPool`)
- Modify: `tests/integration/tournaments.test.js` (append a describe)

**Interfaces:**
- Consumes: `buildPool` (Task 3), `configFromLegacyFormat`, `legacyColumnsFromConfig` (Task 2).
- Produces: `insertPool(sub, kind, { config, tournament = null, createdBy = 'page' }) → row | null` (module-private but Task 7 reuses it); `getOrCreateNormalPool(sub, { createdBy } = {})`, `getOrCreatePreparationPool(sub, { createdBy } = {})` keep their old one-argument form working; `resetNormalPool(sub)` unchanged signature.

- [x] **Step 1: Write the failing integration tests**

Append to `tests/integration/tournaments.test.js` (add the import at the top of the file, under the `db.js` import):

```js
import { getOrCreateNormalPool, resetNormalPool, getOrCreatePreparationPool } from '../../src/lib/poolStore.js'
```

```js
describe('legacy flows store their pools', () => {
  it('creates the normal pool with stored cards/boosters, the active format as config, and created_by', async () => {
    const p = await getOrCreateNormalPool('alice', { createdBy: 'page' })
    expect(p.kind).toBe('normal')
    expect(p.config.source.setCode).toBe('EOLE') // seeded by sealed-pools-schema.sql
    expect(p.cards['ALT_EOLE_B_AX_01_C']).toBe(2)
    expect(p.boosters).toHaveLength(1)
    expect(p.created_by).toBe('page')
    const again = await getOrCreateNormalPool('alice')
    expect(again.id).toBe(p.id)
  })

  it('reset regenerates + stores a fresh pool and reports the previous deck', async () => {
    const p = await getOrCreateNormalPool('alice')
    await query("UPDATE sealed_pools SET reset_at = now() - interval '1 hour', deck_id = $2, deck_card_quantity = 30 WHERE id = $1", [p.id, 'deck-1'])
    const r = await resetNormalPool('alice')
    expect(r.previousDeckId).toBe('deck-1')
    expect(r.pool.nonce).not.toBe(p.nonce)
    expect(r.pool.cards[`NONCE_${r.pool.nonce}`]).toBe(1)
    expect(r.pool.deck_id).toBeNull()
    expect(r.pool.config.source.setCode).toBe('EOLE')
  })

  it('still enforces the reset cooldown', async () => {
    await getOrCreateNormalPool('alice')
    await resetNormalPool('alice')
    const second = await resetNormalPool('alice')
    expect(second.cooldownRemainingMs).toBeGreaterThan(0)
  })

  it('creates one stored pending prep pool per player', async () => {
    const p = await getOrCreatePreparationPool('bob', { createdBy: 'bga' })
    expect(p.kind).toBe('tournament')
    expect(p.tournament_id).toBeNull()
    expect(p.tournament_ref).toBeNull()
    expect(p.cards).toBeTruthy()
    expect(p.created_by).toBe('bga')
    expect((await getOrCreatePreparationPool('bob')).id).toBe(p.id)
  })
})
```

- [x] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- tests/integration/tournaments.test.js`
Expected: FAIL — `p.cards` is null / `created_by` undefined (the inserts don't store yet).

- [x] **Step 3: Rewrite the insert/reset paths in `src/lib/poolStore.js`**

Add to the imports:

```js
import { buildPool, buildPoolSeedString } from './poolBuilder.js'
import { configFromLegacyFormat, legacyColumnsFromConfig } from './tournamentConfig.js'
export { buildPoolSeedString }
```

Replace `insertPool`:

```js
/**
 * Generates the pool FIRST (poolBuilder), then inserts it in one statement. A card-data
 * failure throws before anything is written; a lost insert race (ON CONFLICT DO NOTHING)
 * returns null and the caller re-selects the winner. `tournament` (a tournaments row)
 * attaches the pool to a declared tournament: tournament_ref + tournament_id (its BGA id)
 * + tournament_name (the altered-draft name) + bound_at are all set at creation.
 */
async function insertPool(sub, kind, { config, tournament = null, createdBy = 'page' }) {
  const nonce = newNonce()
  const built = await buildPool(sub, { config, nonce })
  const cols = legacyColumnsFromConfig(config)
  const conflictClause = kind === 'normal'
    ? "ON CONFLICT (sub) WHERE kind = 'normal' DO NOTHING"
    : tournament
      ? 'ON CONFLICT (sub, tournament_ref) WHERE tournament_ref IS NOT NULL DO NOTHING'
      : "ON CONFLICT (sub) WHERE kind = 'tournament' AND tournament_id IS NULL DO NOTHING"
  const { rows } = await query(
    `INSERT INTO sealed_pools
       (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce,
        config, cards, boosters, created_by, tournament_ref, tournament_id, tournament_name, bound_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ${conflictClause}
     RETURNING *`,
    [
      sub, kind, cols.set_code, cols.unique_count, cols.even_factions, cols.heroes_in_pool, cols.guaranteed_uniques, nonce,
      JSON.stringify(config), JSON.stringify(built.cards), JSON.stringify(built.boosters), createdBy,
      tournament?.id ?? null, tournament?.bga_tournament_id ?? null, tournament?.name ?? null, tournament ? new Date() : null,
    ],
  )
  return rows[0] ?? null
}
```

Replace `getOrCreateNormalPool`:

```js
/** The player's single normal-mode pool, creating it (from the active format) if absent. */
export async function getOrCreateNormalPool(sub, { createdBy = 'page' } = {}) {
  const { rows } = await query("SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'normal'", [sub])
  if (rows[0]) return rows[0]

  const format = await getActiveFormat()
  if (!format) throw new Error('no active competitive format configured')

  const inserted = await insertPool(sub, 'normal', { config: configFromLegacyFormat(format), createdBy })
  if (inserted) return inserted
  // Lost the insert race — someone else's concurrent request created it first.
  const retry = await query("SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'normal'", [sub])
  return retry.rows[0]
}
```

In `resetNormalPool`, replace everything after the cooldown check with:

```js
  const format = await getActiveFormat()
  if (!format) throw new Error('no active competitive format configured')

  const config = configFromLegacyFormat(format)
  const nonce = newNonce()
  const built = await buildPool(sub, { config, nonce })
  const cols = legacyColumnsFromConfig(config)
  const { rows } = await query(
    `UPDATE sealed_pools
     SET nonce = $2, set_code = $3, unique_count = $4, even_factions = $5, heroes_in_pool = $6,
         guaranteed_uniques = $7, config = $8, cards = $9, boosters = $10,
         reset_at = now(), deck_id = NULL, deck_name = NULL, deck_hero_ref = NULL,
         deck_faction = NULL, deck_card_quantity = NULL
     WHERE id = $1
     RETURNING *`,
    [pool.id, nonce, cols.set_code, cols.unique_count, cols.even_factions, cols.heroes_in_pool, cols.guaranteed_uniques,
     JSON.stringify(config), JSON.stringify(built.cards), JSON.stringify(built.boosters)],
  )
  return { pool: rows[0], previousDeckId: pool.deck_id ?? null }
```

Replace `getOrCreatePreparationPool`:

```js
/** The player's single pending (not yet bound, not attached) tournament pool, creating it if absent. */
export async function getOrCreatePreparationPool(sub, { createdBy = 'page' } = {}) {
  const { rows } = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_id IS NULL",
    [sub],
  )
  if (rows[0]) return rows[0]

  const format = await getActiveFormat()
  if (!format) throw new Error('no active competitive format configured')

  const inserted = await insertPool(sub, 'tournament', { config: configFromLegacyFormat(format), createdBy })
  if (inserted) return inserted
  const retry = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_id IS NULL",
    [sub],
  )
  return retry.rows[0]
}
```

- [x] **Step 4: Run the integration tests**

Run: `npm run test:integration -- tests/integration/tournaments.test.js`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/poolStore.js tests/integration/tournaments.test.js
git commit -m "Store generated pools for the normal and preparation flows

Every pool created from now on carries its cards and boosters; the
legacy regeneration only serves rows created before this change.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `tournamentStore.js` (SQL for the registry)

**Files:**
- Create: `src/lib/tournamentStore.js`
- Modify: `tests/integration/tournaments.test.js` (append)

**Interfaces:**
- Consumes: `tournamentStatus` (Task 1).
- Produces:
  - `createTournament({ name, description, bgaUrl, bgaTournamentId, startsAt, endsAt, organizerSub, organizerName, config }) → row`; throws `Error` with `code === 'bga_tournament_taken'` on a duplicate BGA id.
  - `getTournament(id) → row | null` (an invalid uuid string → null, no throw).
  - `getTournamentByBgaId(bgaId) → row | null`.
  - `listTournaments(status = 'open') → row[]` — `open` (default) = upcoming + ongoing; `upcoming`; `ongoing`; `all`; ordered by `starts_at` asc.
  - `countOpenTournaments(sub) → number`.
  - `updateTournament(id, fields, { requireUnlocked = false } = {}) → row | null` — `fields` keys among `name, description, startsAt, endsAt, bgaUrl, bgaTournamentId, config, cancelledAt, endedAt`; `null` when nothing matched (not found, or locked when `requireUnlocked`).
  - `countPoolsForTournament(id) → number`.
  - `deleteTournamentIfNoPools(id) → 'deleted' | 'has_pools' | 'not_found'`.
  - `toTournamentJson(row, extras = {}) → object` (spec §7 shape without `viewer`/`poolCount`, which the handlers add through `extras`).

- [ ] **Step 1: Write the failing integration tests**

Append to the top imports of `tests/integration/tournaments.test.js`:

```js
import {
  createTournament, getTournament, getTournamentByBgaId, listTournaments, countOpenTournaments,
  updateTournament, countPoolsForTournament, deleteTournamentIfNoPools, toTournamentJson,
} from '../../src/lib/tournamentStore.js'

const CONFIG = {
  v: 1, format: 'sealed',
  source: { type: 'set', setCode: 'CYCLONE', boosters: 7 },
  heroes: 'packs',
  uniques: { inBoosters: 1, guaranteed: 0, evenFactions: false },
  excludeBanlist: false,
}
const inDays = n => new Date(Date.now() + n * 86400000)

async function mkTournament(over = {}) {
  const bgaId = over.bgaTournamentId ?? String(Math.floor(Math.random() * 1e9))
  return createTournament({
    name: 'Winter Cup', description: 'desc', bgaUrl: `https://boardgamearena.com/tournament?id=${bgaId}`,
    bgaTournamentId: bgaId, startsAt: inDays(2), endsAt: null, organizerSub: 'org', organizerName: 'Org', config: CONFIG,
    ...over,
  })
}
```

Then:

```js
describe('tournamentStore', () => {
  it('creates, reads by id and by BGA id, and rejects a duplicate BGA id', async () => {
    const t = await mkTournament({ bgaTournamentId: '597924' })
    expect(t.format).toBe('sealed')
    expect((await getTournament(t.id)).name).toBe('Winter Cup')
    expect((await getTournamentByBgaId('597924')).id).toBe(t.id)
    expect(await getTournament('not-a-uuid')).toBeNull()
    await expect(mkTournament({ bgaTournamentId: '597924' })).rejects.toMatchObject({ code: 'bga_tournament_taken' })
  })

  it('lists by derived status, ordered by start', async () => {
    const soon = await mkTournament({ name: 'Soon', startsAt: inDays(1) })
    const later = await mkTournament({ name: 'Later', startsAt: inDays(5) })
    const running = await mkTournament({ name: 'Running', startsAt: inDays(-1) })
    const over = await mkTournament({ name: 'Over', startsAt: inDays(-10), endsAt: inDays(-1) })
    const cancelled = await mkTournament({ name: 'Cancelled', startsAt: inDays(3) })
    await updateTournament(cancelled.id, { cancelledAt: new Date() })

    expect((await listTournaments('open')).map(r => r.name)).toEqual(['Running', 'Soon', 'Later'])
    expect((await listTournaments('upcoming')).map(r => r.name)).toEqual(['Soon', 'Later'])
    expect((await listTournaments('ongoing')).map(r => r.name)).toEqual(['Running'])
    expect((await listTournaments('all')).map(r => r.name)).toEqual(['Over', 'Running', 'Soon', 'Cancelled', 'Later'])
    expect(await countOpenTournaments('org')).toBe(3)
    void later; void over
  })

  it('updates fields, and refuses config/link edits once a pool exists when requireUnlocked', async () => {
    const t = await mkTournament()
    const renamed = await updateTournament(t.id, { name: 'Renamed', endsAt: inDays(9) })
    expect(renamed.name).toBe('Renamed')
    expect(renamed.ends_at).toBeInstanceOf(Date)
    expect(renamed.updated_at.getTime()).toBeGreaterThanOrEqual(t.updated_at.getTime())

    const ok = await updateTournament(t.id, { config: { ...CONFIG, heroes: 'free' } }, { requireUnlocked: true })
    expect(ok.config.heroes).toBe('free')

    await query(
      `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce, tournament_ref, tournament_id, bound_at)
       VALUES ('alice', 'tournament', 'CYCLONE', 0, false, true, 0, 'n', $1, $2, now())`, [t.id, t.bga_tournament_id])
    expect(await countPoolsForTournament(t.id)).toBe(1)
    expect(await updateTournament(t.id, { config: CONFIG }, { requireUnlocked: true })).toBeNull()
    expect((await updateTournament(t.id, { description: 'still editable' })).description).toBe('still editable')
  })

  it('deletes only when no pool exists', async () => {
    const t = await mkTournament()
    const u = await mkTournament()
    await query(
      `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce, tournament_ref, tournament_id, bound_at)
       VALUES ('alice', 'tournament', 'CYCLONE', 0, false, true, 0, 'n', $1, $2, now())`, [t.id, t.bga_tournament_id])
    expect(await deleteTournamentIfNoPools(t.id)).toBe('has_pools')
    expect(await deleteTournamentIfNoPools(u.id)).toBe('deleted')
    expect(await deleteTournamentIfNoPools(u.id)).toBe('not_found')
  })

  it('serializes to the API shape', async () => {
    const t = await mkTournament({ bgaTournamentId: '42' })
    const json = toTournamentJson(t, { poolCount: 3 })
    expect(json).toMatchObject({
      id: t.id, name: 'Winter Cup', description: 'desc', format: 'sealed',
      bgaUrl: 'https://boardgamearena.com/tournament?id=42', bgaTournamentId: '42',
      status: 'upcoming', organizer: { name: 'Org' }, config: CONFIG, poolCount: 3,
      endsAt: null, cancelledAt: null, endedAt: null,
    })
    expect(typeof json.startsAt).toBe('string')
    expect(json).not.toHaveProperty('organizerSub')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- tests/integration/tournaments.test.js`
Expected: FAIL — unresolved import `tournamentStore.js`.

- [ ] **Step 3: Implement `src/lib/tournamentStore.js`**

```js
// Data access for user-created tournaments (docs/tournaments/user-tournaments-spec.md §4, §7).
// Server-side only. Status is never stored: see tournamentRules.js's tournamentStatus().
import { query } from './db.js'
import { tournamentStatus } from './tournamentRules.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function createTournament({ name, description, bgaUrl, bgaTournamentId, startsAt, endsAt, organizerSub, organizerName, config }) {
  try {
    const { rows } = await query(
      `INSERT INTO tournaments
         (name, description, bga_url, bga_tournament_id, starts_at, ends_at, organizer_sub, organizer_name, config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [name, description ?? '', bgaUrl, bgaTournamentId, startsAt, endsAt ?? null, organizerSub, organizerName, JSON.stringify(config)],
    )
    return rows[0]
  } catch (e) {
    if (e.code === '23505') {
      const err = new Error('a tournament already exists for this BGA tournament')
      err.code = 'bga_tournament_taken'
      throw err
    }
    throw e
  }
}

export async function getTournament(id) {
  if (!UUID_RE.test(String(id ?? ''))) return null
  const { rows } = await query('SELECT * FROM tournaments WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function getTournamentByBgaId(bgaId) {
  const { rows } = await query('SELECT * FROM tournaments WHERE bga_tournament_id = $1', [String(bgaId)])
  return rows[0] ?? null
}

// "Open" = neither cancelled nor ended (manually, or by a reached ends_at).
const OPEN_SQL = 'cancelled_at IS NULL AND ended_at IS NULL AND (ends_at IS NULL OR ends_at > now())'

/** @param {'open'|'upcoming'|'ongoing'|'all'} status */
export async function listTournaments(status = 'open') {
  const where = status === 'all' ? 'TRUE'
    : status === 'upcoming' ? `${OPEN_SQL} AND starts_at > now()`
    : status === 'ongoing' ? `${OPEN_SQL} AND starts_at <= now()`
    : OPEN_SQL
  const { rows } = await query(`SELECT * FROM tournaments WHERE ${where} ORDER BY starts_at ASC, created_at ASC`)
  return rows
}

export async function countOpenTournaments(sub) {
  const { rows } = await query(
    `SELECT count(*)::int AS count FROM tournaments WHERE organizer_sub = $1 AND ${OPEN_SQL}`,
    [sub],
  )
  return rows[0]?.count ?? 0
}

export async function countPoolsForTournament(id) {
  const { rows } = await query('SELECT count(*)::int AS count FROM sealed_pools WHERE tournament_ref = $1', [id])
  return rows[0]?.count ?? 0
}

const COLUMN_OF = {
  name: 'name',
  description: 'description',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  bgaUrl: 'bga_url',
  bgaTournamentId: 'bga_tournament_id',
  config: 'config',
  cancelledAt: 'cancelled_at',
  endedAt: 'ended_at',
}

/**
 * Partial update. With `requireUnlocked`, the UPDATE is conditioned on "no pool exists"
 * in the same statement, so a config/link change can't race a first pool creation.
 * @returns {Promise<object|null>} the updated row, or null when nothing matched
 */
export async function updateTournament(id, fields, { requireUnlocked = false } = {}) {
  const sets = ['updated_at = now()']
  const params = [id]
  for (const [key, column] of Object.entries(COLUMN_OF)) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
    params.push(key === 'config' ? JSON.stringify(fields[key]) : fields[key])
    sets.push(`${column} = $${params.length}`)
  }
  const lock = requireUnlocked ? 'AND NOT EXISTS (SELECT 1 FROM sealed_pools WHERE tournament_ref = $1)' : ''
  const { rows } = await query(
    `UPDATE tournaments SET ${sets.join(', ')} WHERE id = $1 ${lock} RETURNING *`,
    params,
  )
  return rows[0] ?? null
}

/** @returns {Promise<'deleted'|'has_pools'|'not_found'>} */
export async function deleteTournamentIfNoPools(id) {
  const { rows } = await query(
    'DELETE FROM tournaments WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM sealed_pools WHERE tournament_ref = $1) RETURNING id',
    [id],
  )
  if (rows[0]) return 'deleted'
  return (await getTournament(id)) ? 'has_pools' : 'not_found'
}

const iso = d => (d ? new Date(d).toISOString() : null)

/** API shape (spec §7). `extras` carries poolCount / locked / viewer / poolsByOrigin from the handler. */
export function toTournamentJson(row, extras = {}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    format: row.format,
    bgaUrl: row.bga_url,
    bgaTournamentId: row.bga_tournament_id,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    status: tournamentStatus(row),
    organizer: { name: row.organizer_name },
    config: row.config,
    cancelledAt: iso(row.cancelled_at),
    endedAt: iso(row.ended_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    ...extras,
  }
}
```

- [ ] **Step 4: Run the integration tests**

Run: `npm run test:integration -- tests/integration/tournaments.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournamentStore.js tests/integration/tournaments.test.js
git commit -m "Add tournamentStore: SQL access for declared tournaments

Create/read/list/update/delete with the derived-status filters, the
atomic "no pool exists" guard for locked fields, and the API shape.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Tournament pools in `poolStore.js` — get-or-create, BGA binding order, counters

**Files:**
- Modify: `src/lib/poolStore.js` (`bindTournamentId`, `listBoundTournamentPools`; add the functions below)
- Modify: `tests/integration/tournaments.test.js` (append)

**Interfaces:**
- Consumes: `insertPool` (Task 5), `getTournamentByBgaId` (Task 6).
- Produces:
  - `getPoolForTournament(sub, tournamentId) → row | null`
  - `getOrCreateTournamentPool(sub, tournamentRow, { createdBy = 'page' } = {}) → row` (adopts a legacy row bound to the same BGA id; absorbs insert races on either unique index)
  - `bindTournamentId(sub, bgaId, bgaName)` — same signature; new resolution order (spec §6)
  - `listBoundTournamentPools(sub) → rows` with extra `t_name, t_starts_at, t_ends_at, t_cancelled_at, t_ended_at` columns (LEFT JOIN)
  - `countPoolsByTournament(ids) → Record<id, number>`, `countPoolsByOrigin(tournamentId) → { page, bga, legacy }`, `poolSummariesForTournaments(sub, ids) → Record<tournamentId, { id, deckName, deckCardQuantity }>`

- [ ] **Step 1: Write the failing integration tests**

Add to the poolStore import line of `tests/integration/tournaments.test.js`:

```js
import {
  getOrCreateNormalPool, resetNormalPool, getOrCreatePreparationPool,
  getOrCreateTournamentPool, getPoolForTournament, bindTournamentId, listBoundTournamentPools,
  countPoolsByTournament, countPoolsByOrigin, poolSummariesForTournaments,
} from '../../src/lib/poolStore.js'
```

Append:

```js
describe('tournament pools', () => {
  it('creates a stored pool from the tournament config, attached and pre-bound to the BGA id', async () => {
    const t = await mkTournament({ bgaTournamentId: '1001', name: 'AD name' })
    const p = await getOrCreateTournamentPool('alice', t, { createdBy: 'page' })
    expect(p.tournament_ref).toBe(t.id)
    expect(p.tournament_id).toBe('1001')
    expect(p.tournament_name).toBe('AD name')
    expect(p.bound_at).toBeInstanceOf(Date)
    expect(p.config.source.setCode).toBe('CYCLONE')
    expect(p.cards['ALT_CYCLONE_B_AX_01_C']).toBe(2)
    expect(p.created_by).toBe('page')
    expect((await getOrCreateTournamentPool('alice', t)).id).toBe(p.id)
    expect((await getPoolForTournament('alice', t.id)).id).toBe(p.id)
    expect(await getPoolForTournament('bob', t.id)).toBeNull()
  })

  it('does not consume the generic pending pool, and keeps it mintable', async () => {
    const t = await mkTournament()
    await getOrCreateTournamentPool('alice', t)
    const pending = await getOrCreatePreparationPool('alice')
    expect(pending.tournament_ref).toBeNull()
    expect(pending.tournament_id).toBeNull()
  })

  it('BGA path: a known BGA id creates from the tournament config and keeps the altered-draft name', async () => {
    const t = await mkTournament({ bgaTournamentId: '2002', name: 'AD name' })
    const p = await bindTournamentId('alice', '2002', 'BGA name - Stage 2')
    expect(p.tournament_ref).toBe(t.id)
    expect(p.tournament_name).toBe('AD name')
    expect(p.created_by).toBe('bga')
    const again = await bindTournamentId('alice', '2002', 'BGA name - Stage 3')
    expect(again.id).toBe(p.id)
    expect(again.tournament_name).toBe('AD name')
  })

  it('BGA path: an unknown BGA id still binds the legacy pending pool and takes the BGA name', async () => {
    const pending = await getOrCreatePreparationPool('alice')
    const bound = await bindTournamentId('alice', '3003', 'Some BGA tournament')
    expect(bound.id).toBe(pending.id)
    expect(bound.tournament_id).toBe('3003')
    expect(bound.tournament_ref).toBeNull()
    expect(bound.tournament_name).toBe('Some BGA tournament')
  })

  it('adopts a legacy pool already bound to the BGA id when the tournament is declared later', async () => {
    const legacy = await bindTournamentId('alice', '4004', 'Early bird')
    const t = await mkTournament({ bgaTournamentId: '4004' })
    const p = await getOrCreateTournamentPool('alice', t)
    expect(p.id).toBe(legacy.id)
    expect(p.tournament_ref).toBe(t.id)
    expect(await countPoolsByTournament([t.id])).toEqual({ [t.id]: 1 })
  })

  it('absorbs concurrent creations: one row, every caller gets it', async () => {
    const t = await mkTournament()
    const results = await Promise.all([
      getOrCreateTournamentPool('alice', t, { createdBy: 'page' }),
      getOrCreateTournamentPool('alice', t, { createdBy: 'bga' }),
      getOrCreateTournamentPool('alice', t, { createdBy: 'page' }),
      bindTournamentId('alice', t.bga_tournament_id, 'x'),
    ])
    const ids = new Set(results.map(r => r.id))
    expect(ids.size).toBe(1)
    const { rows } = await query('SELECT count(*)::int AS n FROM sealed_pools WHERE sub = $1', ['alice'])
    expect(rows[0].n).toBe(1)
  })

  it('counts by origin, lists the player\'s pools per tournament, and joins the tournament into bound pools', async () => {
    const t = await mkTournament({ name: 'Joined' })
    await getOrCreateTournamentPool('alice', t, { createdBy: 'page' })
    await getOrCreateTournamentPool('bob', t, { createdBy: 'bga' })
    expect(await countPoolsByOrigin(t.id)).toEqual({ page: 1, bga: 1, legacy: 0 })
    const mine = await poolSummariesForTournaments('alice', [t.id])
    expect(mine[t.id]).toMatchObject({ deckName: null, deckCardQuantity: null })
    const bound = await listBoundTournamentPools('alice')
    expect(bound).toHaveLength(1)
    expect(bound[0].t_name).toBe('Joined')
    expect(bound[0].t_starts_at).toBeInstanceOf(Date)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- tests/integration/tournaments.test.js`
Expected: FAIL — `getOrCreateTournamentPool` is not exported.

- [ ] **Step 3: Implement in `src/lib/poolStore.js`**

Add the import:

```js
import { getTournamentByBgaId } from './tournamentStore.js'
```

Add after `getOrCreatePreparationPool`:

```js
/** The caller's pool for a declared tournament, owner-scoped. */
export async function getPoolForTournament(sub, tournamentId) {
  const { rows } = await query('SELECT * FROM sealed_pools WHERE sub = $1 AND tournament_ref = $2', [sub, tournamentId])
  return rows[0] ?? null
}

/**
 * Get-or-create the player's pool for a declared tournament (spec §6). Order:
 *  1. an existing attached pool;
 *  2. a LEGACY pool already bound to the tournament's BGA id (the tournament was declared
 *     after BGA started binding) — adopted, never replaced: its deck is already in play;
 *  3. a fresh stored pool from the tournament's config.
 * Two unique indexes guard creation ((sub, tournament_ref) and (sub, tournament_id)); a
 * race can surface as ON CONFLICT DO NOTHING or as a 23505 from the other index. Both
 * mean "someone else's row won" — re-select it.
 */
export async function getOrCreateTournamentPool(sub, tournament, { createdBy = 'page' } = {}) {
  const existing = await getPoolForTournament(sub, tournament.id)
  if (existing) return existing

  const legacy = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_ref IS NULL AND tournament_id = $2",
    [sub, tournament.bga_tournament_id],
  )
  if (legacy.rows[0]) {
    const { rows } = await query(
      'UPDATE sealed_pools SET tournament_ref = $2 WHERE id = $1 AND tournament_ref IS NULL RETURNING *',
      [legacy.rows[0].id, tournament.id],
    )
    return rows[0] ?? getPoolForTournament(sub, tournament.id)
  }

  try {
    const inserted = await insertPool(sub, 'tournament', { config: tournament.config, tournament, createdBy })
    if (inserted) return inserted
  } catch (e) {
    if (e.code !== '23505') throw e
  }
  return getPoolForTournament(sub, tournament.id)
}
```

Replace `bindTournamentId`'s beginning (up to and including the `getOrCreatePreparationPool` call) with:

```js
export async function bindTournamentId(sub, tournamentId, tournamentName) {
  const already = await query(
    "SELECT * FROM sealed_pools WHERE sub = $1 AND kind = 'tournament' AND tournament_id = $2",
    [sub, tournamentId],
  )
  if (already.rows[0]) {
    // Pools of a DECLARED tournament keep the altered-draft name; only legacy-bound rows
    // take BGA's (informative) name, refreshed on every call as before.
    if (tournamentName && !already.rows[0].tournament_ref) {
      const { rows } = await query(
        'UPDATE sealed_pools SET tournament_name = $2 WHERE id = $1 RETURNING *',
        [already.rows[0].id, tournamentName],
      )
      return rows[0]
    }
    return already.rows[0]
  }

  // A declared tournament for this BGA id (whatever its status — if BGA is playing it,
  // every player must get the same config) creates the player's pool from ITS config.
  const tournament = await getTournamentByBgaId(tournamentId)
  if (tournament) return getOrCreateTournamentPool(sub, tournament, { createdBy: 'bga' })

  const pending = await getOrCreatePreparationPool(sub, { createdBy: 'bga' })
```

(The rest of the function — the conditional UPDATE and the lost-race re-select — stays as is.)

Replace `listBoundTournamentPools`:

```js
/** Every bound tournament pool for a player (legacy-bound and declared), most recent first. */
export async function listBoundTournamentPools(sub) {
  const { rows } = await query(
    `SELECT p.*,
            t.name AS t_name, t.starts_at AS t_starts_at, t.ends_at AS t_ends_at,
            t.cancelled_at AS t_cancelled_at, t.ended_at AS t_ended_at
     FROM sealed_pools p
     LEFT JOIN tournaments t ON t.id = p.tournament_ref
     WHERE p.sub = $1 AND p.kind = 'tournament' AND p.tournament_id IS NOT NULL
     ORDER BY p.bound_at DESC`,
    [sub],
  )
  return rows
}
```

Add at the end of the file:

```js
/** Pool count per tournament id, for the public list. Missing ids are absent (treat as 0). */
export async function countPoolsByTournament(ids) {
  if (!ids.length) return {}
  const { rows } = await query(
    'SELECT tournament_ref, count(*)::int AS count FROM sealed_pools WHERE tournament_ref = ANY($1) GROUP BY tournament_ref',
    [ids],
  )
  return Object.fromEntries(rows.map(r => [r.tournament_ref, r.count]))
}

/** How a tournament's pools were created — 'bga' = minted by a BGA deck-list call. */
export async function countPoolsByOrigin(tournamentId) {
  const { rows } = await query(
    'SELECT created_by, count(*)::int AS count FROM sealed_pools WHERE tournament_ref = $1 GROUP BY created_by',
    [tournamentId],
  )
  const out = { page: 0, bga: 0, legacy: 0 }
  for (const r of rows) out[r.created_by ?? 'legacy'] = (out[r.created_by ?? 'legacy'] ?? 0) + r.count
  return out
}

/** The caller's pools for several tournaments at once (list view): id + deck summary. */
export async function poolSummariesForTournaments(sub, ids) {
  if (!ids.length) return {}
  const { rows } = await query(
    'SELECT id, tournament_ref, deck_name, deck_card_quantity FROM sealed_pools WHERE sub = $1 AND tournament_ref = ANY($2)',
    [sub, ids],
  )
  return Object.fromEntries(rows.map(r => [r.tournament_ref, { id: r.id, deckName: r.deck_name, deckCardQuantity: r.deck_card_quantity }]))
}
```

- [ ] **Step 4: Run the integration tests**

Run: `npm run test:integration -- tests/integration/tournaments.test.js`
Expected: PASS, including the concurrency test (run it three times: `for i in 1 2 3; do npm run test:integration -- tests/integration/tournaments.test.js -t concurrent || break; done`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/poolStore.js tests/integration/tournaments.test.js
git commit -m "Attach pools to declared tournaments and resolve them first on the BGA path

getOrCreateTournamentPool is the one-shot, race-safe creation for a
declared tournament (adopting a legacy pool bound earlier to the same
BGA id). bindTournamentId now checks the registry before the legacy
pending pool and never overwrites a declared tournament's name.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `verifyUser` + moderator check in `api/_lib/auth.js`

**Files:**
- Modify: `api/_lib/auth.js`
- Create: `api/_lib/auth.test.js`

**Interfaces:**
- Produces: `decodeJwtPayload(token) → object` (`{}` on any failure), `moderatorConfig(env = process.env) → { role: string|null, subs: string[] }`, `isModerator({ sub, roles }, cfg = moderatorConfig()) → boolean`, `verifyUser(req) → Promise<{ sub, name, roles: string[], isModerator: boolean } | null>`. `verifySub` and `bearerToken` unchanged.

- [ ] **Step 1: Write the failing test**

`api/_lib/auth.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'
import { decodeJwtPayload, moderatorConfig, isModerator, verifyUser } from './auth.js'

const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
const jwt = payload => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`

describe('decodeJwtPayload', () => {
  it('reads the payload of a well-formed token and returns {} otherwise', () => {
    expect(decodeJwtPayload(jwt({ realm_access: { roles: ['a'] } }))).toEqual({ realm_access: { roles: ['a'] } })
    expect(decodeJwtPayload('garbage')).toEqual({})
    expect(decodeJwtPayload('')).toEqual({})
  })
})

describe('isModerator', () => {
  it('matches the configured role or the allowlisted sub, and nothing when unconfigured', () => {
    const cfg = moderatorConfig({ TOURNAMENT_MODERATOR_ROLE: ' mod ', TOURNAMENT_MODERATORS: 'sub-a, sub-b' })
    expect(cfg).toEqual({ role: 'mod', subs: ['sub-a', 'sub-b'] })
    expect(isModerator({ sub: 'x', roles: ['mod'] }, cfg)).toBe(true)
    expect(isModerator({ sub: 'sub-b', roles: [] }, cfg)).toBe(true)
    expect(isModerator({ sub: 'x', roles: ['other'] }, cfg)).toBe(false)
    expect(isModerator({ sub: 'x', roles: ['mod'] }, moderatorConfig({}))).toBe(false)
  })
})

describe('verifyUser', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns sub, display name and roles once userinfo accepts the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sub: 's1', preferred_username: 'alice' }) })))
    const req = { method: 'GET', url: '/x', headers: { authorization: `Bearer ${jwt({ realm_access: { roles: ['mod'] } })}` } }
    const user = await verifyUser(req)
    expect(user).toMatchObject({ sub: 's1', name: 'alice', roles: ['mod'] })
    expect(typeof user.isModerator).toBe('boolean')
  })

  it('returns null without a bearer or when userinfo rejects it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
    expect(await verifyUser({ method: 'GET', url: '/x', headers: {} })).toBeNull()
    expect(await verifyUser({ method: 'GET', url: '/x', headers: { authorization: 'Bearer bad' } })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run api/_lib/auth.test.js`
Expected: FAIL — `decodeJwtPayload` / `verifyUser` not exported.

- [ ] **Step 3: Implement**

Rewrite `api/_lib/auth.js` as:

```js
// Shared auth helpers for the tournament endpoints. The access token is opaque to us — we
// verify it against Keycloak's userinfo endpoint (the same call the frontend makes in
// src/lib/reunion.js's fetchProfile) rather than validating signatures ourselves, so a
// `sub` is only ever trusted once Keycloak vouches for it. Roles are read from the
// token's payload ONLY after that check: userinfo accepting the exact same token string
// is what makes its claims trustworthy.
import { endpoints } from '../../src/lib/endpoints.js'

const USERINFO = `${endpoints().keycloakIssuer}/protocol/openid-connect/userinfo`

export function bearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match ? match[1] : null
}

/** The JWT payload, decoded without verification. `{}` for anything malformed. */
export function decodeJwtPayload(token) {
  try {
    const [, payload] = String(token).split('.')
    if (!payload) return {}
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Moderators: a Keycloak realm role (TOURNAMENT_MODERATOR_ROLE) and/or allowlisted subs. */
export function moderatorConfig(env = process.env) {
  const role = (env.TOURNAMENT_MODERATOR_ROLE || '').trim() || null
  const subs = (env.TOURNAMENT_MODERATORS || '').split(',').map(s => s.trim()).filter(Boolean)
  return { role, subs }
}

export function isModerator({ sub, roles = [] }, cfg = moderatorConfig()) {
  if (cfg.role && roles.includes(cfg.role)) return true
  return cfg.subs.includes(sub)
}

async function userinfo(req) {
  const token = bearerToken(req)
  if (!token) {
    console.log(`verify: no bearer token on ${req.method} ${req.url}`)
    return null
  }
  try {
    const res = await fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      console.log(`verify: userinfo returned ${res.status} on ${req.method} ${req.url}`)
      return null
    }
    const data = await res.json()
    return data?.sub ? { token, data } : null
  } catch (e) {
    console.log(`verify: userinfo call threw "${e?.message}" on ${req.method} ${req.url}`)
    return null
  }
}

/** Returns the verified Keycloak `sub` for this request's Bearer token, or null. */
export async function verifySub(req) {
  const u = await userinfo(req)
  return u?.data.sub ?? null
}

/** Verified identity + display name + realm roles (+ the moderator flag), or null. */
export async function verifyUser(req) {
  const u = await userinfo(req)
  if (!u) return null
  const payload = decodeJwtPayload(u.token)
  const roles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : []
  const sub = u.data.sub
  return {
    sub,
    name: u.data.pseudo || u.data.preferred_username || u.data.name || 'Player',
    roles,
    isModerator: isModerator({ sub, roles }),
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run api/_lib/auth.test.js && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/_lib/auth.js api/_lib/auth.test.js
git commit -m "Add verifyUser with display name, realm roles and the moderator check

Roles come from the access token payload, read only after Keycloak's
userinfo accepted that exact token. Moderators are a configurable realm
role and/or an env allowlist of subs.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: API handlers — `api/tournaments/*`, request helpers, Express mounts

**Files:**
- Create: `api/_lib/request.js`
- Create: `api/tournaments/index.js`, `api/tournaments/[id].js`, `api/tournaments/[id]/pool.js`
- Modify: `server/index.js` (imports + three `app.all` lines)
- Modify: `tests/integration/tournaments.test.js` (append; mock `api/_lib/auth.js`)

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 6, 7, 8.
- Produces: the endpoints of spec §7 (`GET/POST /api/tournaments`, `GET/PATCH/DELETE /api/tournaments/:id`, `GET /api/tournaments/:id/pool`); `queryParam(req, name) → string`, `jsonBody(req) → object`.

- [ ] **Step 1: Write the failing integration tests**

At the top of `tests/integration/tournaments.test.js`, add the auth mock next to the poolBuilder mock, and the handler imports:

```js
vi.mock('../../api/_lib/auth.js', async importOriginal => {
  const mod = await importOriginal()
  return { ...mod, verifyUser: vi.fn(async () => null), verifySub: vi.fn(async () => null) }
})
import { verifyUser } from '../../api/_lib/auth.js'
import tournamentsIndex from '../../api/tournaments/index.js'
import tournamentsItem from '../../api/tournaments/[id].js'
import tournamentPoolFor from '../../api/tournaments/[id]/pool.js'

function mockRes() {
  const res = {
    statusCode: null, body: undefined, headers: {},
    status(code) { res.statusCode = code; return res },
    json(payload) { res.body = payload; return res },
    end() { return res },
    setHeader(name, value) { res.headers[name] = value; return res },
  }
  return res
}

async function call(handler, { method = 'GET', body, query: q = {}, auth = true } = {}) {
  const req = { method, body, query: q, url: '/api/x', headers: auth ? { authorization: 'Bearer t' } : {} }
  const res = mockRes()
  await handler(req, res)
  return res
}

const ALICE = { sub: 'alice', name: 'Alice', roles: [], isModerator: false }
const MOD = { sub: 'mod', name: 'Mod', roles: ['mod'], isModerator: true }
const asUser = user => verifyUser.mockImplementation(async req => (req.headers.authorization ? user : null))
```

Append:

```js
describe('POST + GET /api/tournaments', () => {
  const body = {
    name: 'Winter Cup', description: 'Be there', bgaUrl: 'https://fr.boardgamearena.com/tournament/?id=9001',
    startsAt: inDays(3).toISOString(), endsAt: null, config: CONFIG,
  }

  it('creates for a logged-in user (201) and lists it publicly', async () => {
    asUser(ALICE)
    const created = await call(tournamentsIndex, { method: 'POST', body })
    expect(created.statusCode).toBe(201)
    expect(created.body).toMatchObject({ name: 'Winter Cup', bgaTournamentId: '9001', bgaUrl: 'https://boardgamearena.com/tournament?id=9001', status: 'upcoming', organizer: { name: 'Alice' }, poolCount: 0, locked: false })

    verifyUser.mockResolvedValue(null)
    const list = await call(tournamentsIndex, { method: 'GET', auth: false })
    expect(list.statusCode).toBe(200)
    expect(list.body.tournaments).toHaveLength(1)
    expect(list.body.tournaments[0]).not.toHaveProperty('viewer')
  })

  it('needs a login to create, validates fields + config, and rejects a reused BGA id', async () => {
    verifyUser.mockResolvedValue(null)
    expect((await call(tournamentsIndex, { method: 'POST', body })).statusCode).toBe(401)
    asUser(ALICE)
    const bad = await call(tournamentsIndex, { method: 'POST', body: { ...body, name: 'x', config: { ...CONFIG, heroes: 'nope' } } })
    expect(bad.statusCode).toBe(400)
    expect(bad.body).toEqual({ error: 'invalid_request', fields: { name: 'invalid_length' }, config: ['heroes'] })
    expect((await call(tournamentsIndex, { method: 'POST', body })).statusCode).toBe(201)
    const dup = await call(tournamentsIndex, { method: 'POST', body })
    expect(dup.statusCode).toBe(409)
    expect(dup.body).toEqual({ error: 'bga_tournament_taken' })
  })

  it('caps open tournaments at 10 per account, moderators exempt', async () => {
    asUser(ALICE)
    for (let i = 0; i < 10; i++) {
      expect((await call(tournamentsIndex, { method: 'POST', body: { ...body, bgaUrl: `https://boardgamearena.com/tournament?id=${100 + i}` } })).statusCode).toBe(201)
    }
    const eleventh = await call(tournamentsIndex, { method: 'POST', body: { ...body, bgaUrl: 'https://boardgamearena.com/tournament?id=999' } })
    expect(eleventh.statusCode).toBe(429)
    expect(eleventh.body).toEqual({ error: 'too_many_open_tournaments' })
    asUser(MOD)
    for (let i = 0; i < 11; i++) {
      expect((await call(tournamentsIndex, { method: 'POST', body: { ...body, bgaUrl: `https://boardgamearena.com/tournament?id=${200 + i}` } })).statusCode).toBe(201)
    }
  })

  it('a stale bearer on the public list still gets the anonymous view, not 401', async () => {
    await mkTournament()
    verifyUser.mockResolvedValue(null)
    const res = await call(tournamentsIndex, { method: 'GET', auth: true })
    expect(res.statusCode).toBe(200)
    expect(res.body.tournaments[0]).not.toHaveProperty('viewer')
  })

  it('adds the viewer block for a logged-in reader and filters by status', async () => {
    const t = await mkTournament({ startsAt: inDays(-1) })
    await mkTournament({ startsAt: inDays(4) })
    asUser(ALICE)
    await getOrCreateTournamentPool('alice', t)
    const ongoing = await call(tournamentsIndex, { method: 'GET', query: { status: 'ongoing' } })
    expect(ongoing.body.tournaments).toHaveLength(1)
    expect(ongoing.body.tournaments[0].viewer).toMatchObject({ hasPool: true })
    expect(ongoing.body.tournaments[0].poolCount).toBe(1)
    expect((await call(tournamentsIndex, { method: 'GET', query: { status: 'upcoming' } })).body.tournaments[0].viewer.hasPool).toBe(false)
    expect((await call(tournamentsIndex, { method: 'GET', query: { status: 'bogus' } })).statusCode).toBe(400)
  })
})

describe('GET/PATCH/DELETE /api/tournaments/:id', () => {
  it('404s unknown ids, exposes viewer/organizer data, hides poolsByOrigin from players', async () => {
    const t = await mkTournament({ organizerSub: 'alice', organizerName: 'Alice' })
    expect((await call(tournamentsItem, { query: { id: '00000000-0000-0000-0000-000000000000' }, auth: false })).statusCode).toBe(404)
    expect((await call(tournamentsItem, { query: { id: 'nope' }, auth: false })).statusCode).toBe(404)

    asUser({ ...ALICE, sub: 'bob', name: 'Bob' })
    const asBob = await call(tournamentsItem, { query: { id: t.id } })
    expect(asBob.body.viewer).toEqual({ isOrganizer: false, isModerator: false, hasPool: false, poolId: null, deck: null })
    expect(asBob.body).not.toHaveProperty('poolsByOrigin')

    asUser(ALICE)
    const asOrg = await call(tournamentsItem, { query: { id: t.id } })
    expect(asOrg.body.viewer.isOrganizer).toBe(true)
    expect(asOrg.body.poolsByOrigin).toEqual({ page: 0, bga: 0, legacy: 0 })
  })

  it('PATCH: organizer edits fields and actions; non-organizers get 403; locked fields 409', async () => {
    const t = await mkTournament({ organizerSub: 'alice', organizerName: 'Alice' })
    asUser({ ...ALICE, sub: 'bob' })
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'Hacked' } })).statusCode).toBe(403)

    asUser(ALICE)
    const renamed = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'Renamed', endsAt: inDays(10).toISOString() } })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.body.name).toBe('Renamed')
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { endsAt: inDays(-5).toISOString() } })).statusCode).toBe(400)

    const cancelled = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'cancel' } })
    expect(cancelled.body.status).toBe('cancelled')
    // A cancelled tournament stays editable: that is how a BGA link gets reused (restore + fix).
    const editedWhileCancelled = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'Edited while cancelled', bgaUrl: 'https://boardgamearena.com/tournament?id=778' } })
    expect(editedWhileCancelled.statusCode).toBe(200)
    expect(editedWhileCancelled.body).toMatchObject({ name: 'Edited while cancelled', bgaTournamentId: '778', status: 'cancelled' })
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'restore' } })).body.status).toBe('upcoming')
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'close' } })).body.status).toBe('ended')
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'reopen' } })).body.status).toBe('upcoming')
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'explode' } })).statusCode).toBe(400)

    const relinked = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { bgaUrl: 'https://boardgamearena.com/tournament?id=777', config: { ...CONFIG, heroes: 'free' } } })
    expect(relinked.body.bgaTournamentId).toBe('777')
    expect(relinked.body.config.heroes).toBe('free')

    await getOrCreateTournamentPool('carol', (await getTournament(t.id)))
    const locked = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { config: CONFIG } })
    expect(locked.statusCode).toBe(409)
    expect(locked.body).toEqual({ error: 'tournament_locked' })
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { description: 'fine' } })).statusCode).toBe(200)

    asUser(MOD)
    expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { name: 'Moderated' } })).statusCode).toBe(200)
  })

  it('DELETE: 204 when no pool, 409 otherwise, 403 for strangers', async () => {
    const t = await mkTournament({ organizerSub: 'alice' })
    asUser({ ...ALICE, sub: 'bob' })
    expect((await call(tournamentsItem, { method: 'DELETE', query: { id: t.id } })).statusCode).toBe(403)
    asUser(ALICE)
    await getOrCreateTournamentPool('carol', t)
    const blocked = await call(tournamentsItem, { method: 'DELETE', query: { id: t.id } })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.body).toEqual({ error: 'tournament_has_pools' })
    const u = await mkTournament({ organizerSub: 'alice' })
    expect((await call(tournamentsItem, { method: 'DELETE', query: { id: u.id } })).statusCode).toBe(204)
    expect(await getTournament(u.id)).toBeNull()
  })
})

describe('GET /api/tournaments/:id/pool', () => {
  it('creates the caller\'s pool once, returns the pool shape with the tournament block', async () => {
    const t = await mkTournament({ name: 'Pool me' })
    verifyUser.mockResolvedValue(null)
    expect((await call(tournamentPoolFor, { query: { id: t.id } })).statusCode).toBe(401)
    asUser(ALICE)
    const first = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(first.statusCode).toBe(200)
    expect(first.body).toMatchObject({ kind: 'tournament', tournamentRef: t.id, tournamentName: 'Pool me', tournament: { id: t.id, name: 'Pool me', status: 'upcoming' }, gamesPlayed: 0, deck: null })
    expect(first.body.boosters).toHaveLength(1)
    expect(first.body.cards['ALT_CYCLONE_B_AX_01_C']).toBe(2)
    const second = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(second.body.id).toBe(first.body.id)
  })

  it('refuses to CREATE on a cancelled/ended tournament but still returns an existing pool', async () => {
    const t = await mkTournament()
    asUser(ALICE)
    await call(tournamentPoolFor, { query: { id: t.id } })
    await updateTournament(t.id, { cancelledAt: new Date() })
    expect((await call(tournamentPoolFor, { query: { id: t.id } })).statusCode).toBe(200)
    asUser({ ...ALICE, sub: 'bob' })
    const refused = await call(tournamentPoolFor, { query: { id: t.id } })
    expect(refused.statusCode).toBe(409)
    expect(refused.body).toEqual({ error: 'tournament_closed', status: 'cancelled' })
    expect((await call(tournamentPoolFor, { query: { id: '00000000-0000-0000-0000-000000000000' } })).statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- tests/integration/tournaments.test.js`
Expected: FAIL — unresolved `api/tournaments/*` imports.

- [ ] **Step 3: Create `api/_lib/request.js`**

```js
// Small request helpers shared by handlers that run both as Vercel functions and inside
// server/index.js's Express app: query params live in req.query on both (Express's
// routeWithParam bridges :id), and a JSON body is already parsed on both, except when a
// client sends it as a raw string.
export function queryParam(req, name) {
  const fromQuery = req.query?.[name]
  if (fromQuery != null) return String(fromQuery).trim()
  try {
    return (new URL(req.url, 'http://x').searchParams.get(name) ?? '').trim()
  } catch {
    return ''
  }
}

export function jsonBody(req) {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body || '{}') } catch { return {} }
  }
  return typeof req.body === 'object' ? req.body : {}
}
```

- [ ] **Step 4: Create `api/tournaments/index.js`**

```js
// User-created tournaments: public list (GET, bearer optional) and creation (POST).
// See docs/tournaments/user-tournaments-spec.md §7.
import { verifyUser, bearerToken } from '../_lib/auth.js'
import { jsonBody, queryParam } from '../_lib/request.js'
import { validateTournamentFields, MAX_OPEN_TOURNAMENTS } from '../../src/lib/tournamentRules.js'
import { validateTournamentConfig } from '../../src/lib/tournamentConfig.js'
import { listTournaments, createTournament, countOpenTournaments, toTournamentJson } from '../../src/lib/tournamentStore.js'
import { countPoolsByTournament, poolSummariesForTournaments } from '../../src/lib/poolStore.js'

const STATUSES = ['open', 'upcoming', 'ongoing', 'all']

// Public GET: a bad/expired bearer just means "anonymous view", never a 401.
async function optionalUser(req) {
  return bearerToken(req) ? verifyUser(req) : null
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const status = queryParam(req, 'status') || 'open'
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_request', fields: { status: 'unknown_status' } })
    const rows = await listTournaments(status)
    const ids = rows.map(r => r.id)
    const user = await optionalUser(req)
    const [counts, mine] = await Promise.all([
      countPoolsByTournament(ids),
      user ? poolSummariesForTournaments(user.sub, ids) : {},
    ])
    const tournaments = rows.map(row => toTournamentJson(row, {
      poolCount: counts[row.id] ?? 0,
      ...(user ? {
        viewer: {
          isOrganizer: row.organizer_sub === user.sub,
          hasPool: !!mine[row.id],
          poolId: mine[row.id]?.id ?? null,
          deck: mine[row.id]?.deckName ? { name: mine[row.id].deckName, cardQuantity: mine[row.id].deckCardQuantity } : null,
        },
      } : {}),
    }))
    return res.status(200).json({ tournaments })
  }

  if (req.method === 'POST') {
    const user = await verifyUser(req)
    if (!user) return res.status(401).json({ error: 'unauthorized' })

    const body = jsonBody(req)
    const fields = validateTournamentFields(body, { isCreate: true })
    const config = validateTournamentConfig(body.config)
    if (!fields.ok || !config.ok) {
      return res.status(400).json({ error: 'invalid_request', fields: fields.errors, config: config.errors })
    }
    if (!user.isModerator && (await countOpenTournaments(user.sub)) >= MAX_OPEN_TOURNAMENTS) {
      return res.status(429).json({ error: 'too_many_open_tournaments' })
    }

    let row
    try {
      row = await createTournament({
        name: fields.values.name,
        description: fields.values.description,
        bgaUrl: fields.values.bgaUrl,
        bgaTournamentId: fields.values.bgaTournamentId,
        startsAt: fields.values.startsAt,
        endsAt: fields.values.endsAt,
        organizerSub: user.sub,
        organizerName: user.name,
        config: config.config,
      })
    } catch (e) {
      if (e.code === 'bga_tournament_taken') return res.status(409).json({ error: 'bga_tournament_taken' })
      throw e
    }
    return res.status(201).json(toTournamentJson(row, {
      poolCount: 0,
      locked: false,
      viewer: { isOrganizer: true, isModerator: user.isModerator, hasPool: false, poolId: null, deck: null },
    }))
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'method_not_allowed' })
}
```

- [ ] **Step 5: Create `api/tournaments/[id].js`**

```js
// One declared tournament: public detail (GET, bearer optional), organizer/moderator
// edits (PATCH) and hard delete when no pool exists (DELETE). Spec §3.2 / §7.
import { verifyUser, bearerToken } from '../_lib/auth.js'
import { jsonBody } from '../_lib/request.js'
import { validateTournamentFields } from '../../src/lib/tournamentRules.js'
import { validateTournamentConfig } from '../../src/lib/tournamentConfig.js'
import {
  getTournament, updateTournament, countPoolsForTournament, deleteTournamentIfNoPools, toTournamentJson,
} from '../../src/lib/tournamentStore.js'
import { getPoolForTournament, countPoolsByOrigin } from '../../src/lib/poolStore.js'

const ACTIONS = {
  cancel: { cancelledAt: () => new Date() },
  restore: { cancelledAt: () => null },
  close: { endedAt: () => new Date() },
  reopen: { endedAt: () => null },
}

function canManage(row, user) {
  return !!user && (row.organizer_sub === user.sub || user.isModerator)
}

async function detail(row, user) {
  const poolCount = await countPoolsForTournament(row.id)
  const extras = { poolCount, locked: poolCount > 0 }
  if (user) {
    const pool = await getPoolForTournament(user.sub, row.id)
    extras.viewer = {
      isOrganizer: row.organizer_sub === user.sub,
      isModerator: user.isModerator,
      hasPool: !!pool,
      poolId: pool?.id ?? null,
      deck: pool?.deck_id ? { id: pool.deck_id, name: pool.deck_name, cardQuantity: pool.deck_card_quantity } : null,
    }
    if (canManage(row, user)) extras.poolsByOrigin = await countPoolsByOrigin(row.id)
  }
  return toTournamentJson(row, extras)
}

export default async function handler(req, res) {
  const id = req.query?.id
  const row = await getTournament(id)
  if (!row) return res.status(404).json({ error: 'not_found' })

  if (req.method === 'GET') {
    const user = bearerToken(req) ? await verifyUser(req) : null
    return res.status(200).json(await detail(row, user))
  }

  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  if (!canManage(row, user)) return res.status(403).json({ error: 'forbidden' })

  if (req.method === 'PATCH') {
    const body = jsonBody(req)
    const fields = {}

    if (body.action !== undefined) {
      const action = ACTIONS[body.action]
      if (!action) return res.status(400).json({ error: 'invalid_request', fields: { action: 'unknown_action' } })
      for (const [key, value] of Object.entries(action)) fields[key] = value()
    }

    const validated = validateTournamentFields(body, { current: row })
    if (!validated.ok) return res.status(400).json({ error: 'invalid_request', fields: validated.errors })
    Object.assign(fields, validated.values)

    let configResult = null
    if (body.config !== undefined) {
      configResult = validateTournamentConfig(body.config)
      if (!configResult.ok) return res.status(400).json({ error: 'invalid_request', config: configResult.errors })
      fields.config = configResult.config
    }

    const touchesLocked = body.config !== undefined || body.bgaUrl !== undefined
    if (touchesLocked && (await countPoolsForTournament(row.id)) > 0) {
      return res.status(409).json({ error: 'tournament_locked' })
    }
    const updated = await updateTournament(row.id, fields, { requireUnlocked: touchesLocked })
    if (!updated) return res.status(409).json({ error: 'tournament_locked' })
    return res.status(200).json(await detail(updated, user))
  }

  if (req.method === 'DELETE') {
    const outcome = await deleteTournamentIfNoPools(row.id)
    if (outcome === 'has_pools') return res.status(409).json({ error: 'tournament_has_pools' })
    if (outcome === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(204).end()
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE')
  return res.status(405).json({ error: 'method_not_allowed' })
}
```

- [ ] **Step 6: Create `api/tournaments/[id]/pool.js`**

```js
// The caller's pool for a declared tournament: get-or-create (spec §3.2, §6, §7).
// Creation is refused once the tournament is cancelled or ended; an EXISTING pool is
// always returned so players keep editing their deck.
import { verifyUser } from '../../_lib/auth.js'
import { getTournament } from '../../../src/lib/tournamentStore.js'
import { tournamentStatus, OPEN_STATUSES } from '../../../src/lib/tournamentRules.js'
import { getPoolForTournament, getOrCreateTournamentPool, countGamesPlayed } from '../../../src/lib/poolStore.js'
import { loadPool, poolResponse } from '../../_lib/tournamentPool.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }
  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })

  const row = await getTournament(req.query?.id)
  if (!row) return res.status(404).json({ error: 'not_found' })

  const status = tournamentStatus(row)
  let pool = await getPoolForTournament(user.sub, row.id)
  if (!pool) {
    if (!OPEN_STATUSES.includes(status)) return res.status(409).json({ error: 'tournament_closed', status })
    pool = await getOrCreateTournamentPool(user.sub, row, { createdBy: 'page' })
  }

  const { counts, boosters } = await loadPool(user.sub, pool)
  const gamesPlayed = await countGamesPlayed(pool.id)
  return res.status(200).json(poolResponse(pool, counts, boosters, gamesPlayed, {
    tournament: { id: row.id, name: row.name, status },
  }))
}
```

- [ ] **Step 7: Mount in `server/index.js`**

Add the imports:

```js
import tournamentsIndexHandler from '../api/tournaments/index.js'
import tournamentsItemHandler from '../api/tournaments/[id].js'
import tournamentPoolForHandler from '../api/tournaments/[id]/pool.js'
```

Add the routes (before `app.all('/api/rooms', …)`; Express matches the more specific path first regardless of order, but keep them together):

```js
app.all('/api/tournaments', route(tournamentsIndexHandler))
app.all('/api/tournaments/:id', routeWithParam(tournamentsItemHandler, 'id'))
app.all('/api/tournaments/:id/pool', routeWithParam(tournamentPoolForHandler, 'id'))
```

- [ ] **Step 8: Run both suites**

Run: `npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 9: Smoke-test the Express mounts locally**

Run: `make dev` (needs Docker + the sibling dev env for a real token). Then:

```bash
curl -s http://localhost:8080/api/tournaments | head -c 200
```

Expected: `{"tournaments":[]}` (or your dev rows). A `405` from `curl -X PUT http://localhost:8080/api/tournaments/x` confirms the `:id` mount.

- [ ] **Step 10: Commit**

```bash
git add api/_lib/request.js api/tournaments server/index.js tests/integration/tournaments.test.js
git commit -m "Add the tournaments API: list/create, detail/edit/delete, and the player's pool

Public GETs accept an optional bearer for the viewer block; writes
require the organizer or a moderator. Pool creation is get-or-create
and refused only on cancelled/ended tournaments without a pool.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Bound-pools list with the tournament block; BGA path `createdBy`

**Files:**
- Modify: `api/tournament-bound-pools.js`
- Modify: `api/tournament-bga-decklist.js` (one argument)
- Modify: `tests/integration/tournaments.test.js` (append)

**Interfaces:**
- Produces: `GET /api/tournament-bound-pools` items gain `tournament: { id, name, startsAt, status } | null`.

- [ ] **Step 1: Write the failing test**

Add `import boundPools from '../../api/tournament-bound-pools.js'` next to the other handler imports, then append:

```js
describe('GET /api/tournament-bound-pools', () => {
  it('carries the tournament block for declared pools and null for legacy-bound ones', async () => {
    const t = await mkTournament({ name: 'Declared' })
    asUser(ALICE)
    await getOrCreateTournamentPool('alice', t)
    await bindTournamentId('alice', '5005', 'Legacy one')
    verifyUser.mockImplementation(async () => ALICE)
    const { verifySub } = await import('../../api/_lib/auth.js')
    verifySub.mockResolvedValue('alice')
    const res = await call(boundPools)
    expect(res.statusCode).toBe(200)
    const byName = Object.fromEntries(res.body.pools.map(p => [p.tournamentName, p]))
    expect(byName['Declared'].tournament).toMatchObject({ id: t.id, name: 'Declared', status: 'upcoming' })
    expect(byName['Legacy one'].tournament).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- tests/integration/tournaments.test.js -t bound-pools`
Expected: FAIL — `tournament` is undefined on the items.

- [ ] **Step 3: Implement**

In `api/tournament-bound-pools.js`, import `tournamentStatus` from `../src/lib/tournamentRules.js` and change the mapped item to:

```js
  const withGamesPlayed = await Promise.all(pools.map(async p => ({
    id: p.id,
    setCode: p.set_code,
    tournamentId: p.tournament_id,
    tournamentName: p.tournament_name,
    boundAt: p.bound_at,
    gamesPlayed: await countGamesPlayed(p.id),
    tournament: p.tournament_ref
      ? {
          id: p.tournament_ref,
          name: p.t_name,
          startsAt: p.t_starts_at,
          status: tournamentStatus({ starts_at: p.t_starts_at, ends_at: p.t_ends_at, cancelled_at: p.t_cancelled_at, ended_at: p.t_ended_at }),
        }
      : null,
    deck: p.deck_id
      ? { id: p.deck_id, name: p.deck_name, cardQuantity: p.deck_card_quantity }
      : null,
  })))
```

In `api/tournament-bga-decklist.js`, change `await getOrCreateNormalPool(sub)` to `await getOrCreateNormalPool(sub, { createdBy: 'bga' })` and update the header comment's first paragraph to mention: "`tournamentId` of a tournament declared on altered-draft resolves to (or creates) the player's pool for THAT tournament; other ids bind the legacy pending pool."

- [ ] **Step 4: Run the suites**

Run: `npm test && npm run test:integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/tournament-bound-pools.js api/tournament-bga-decklist.js tests/integration/tournaments.test.js
git commit -m "Expose the declared tournament on bound pools; tag BGA-created pools

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: `scripts/freeze-sealed-pools.mjs` (one-shot storage of legacy rows)

**Files:**
- Create: `scripts/freeze-sealed-pools.mjs`
- Modify: `Makefile` (one target), `tests/integration/tournaments.test.js` (append)

**Interfaces:**
- Consumes: `regeneratePool` (Task 4), `configFromLegacyFormat` (Task 2).
- Produces: `freezeSealedPools({ regenerate = regeneratePool } = {}) → { total, frozen, failed }` exported for the test; the script runs it when executed directly.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/tournaments.test.js` (import at the top: `import { freezeSealedPools } from '../../scripts/freeze-sealed-pools.mjs'`):

```js
describe('freeze-sealed-pools', () => {
  it('stores cards/boosters/config on rows that lack them, skips the others, survives one failure', async () => {
    await query(
      `INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce)
       VALUES ('a', 'normal', 'EOLE', 1, false, false, 1, 'n1'), ('b', 'normal', 'EOLE', 1, false, false, 1, 'n2')`)
    const stored = await getOrCreateNormalPool('c')
    const regenerate = vi.fn(async (sub, row) => {
      if (sub === 'b') throw new Error('network down')
      return { counts: { X: 1 }, boosters: [['X']] }
    })
    const result = await freezeSealedPools({ regenerate })
    expect(result).toEqual({ total: 2, frozen: 1, failed: 1 })
    const a = (await query("SELECT * FROM sealed_pools WHERE sub = 'a'")).rows[0]
    expect(a.cards).toEqual({ X: 1 })
    expect(a.config.source.setCode).toBe('EOLE')
    expect((await query("SELECT cards FROM sealed_pools WHERE sub = 'b'")).rows[0].cards).toBeNull()
    expect(regenerate).not.toHaveBeenCalledWith('c', expect.anything())
    void stored
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:integration -- tests/integration/tournaments.test.js -t freeze`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Implement `scripts/freeze-sealed-pools.mjs`**

```js
#!/usr/bin/env node
// One-shot (idempotent): stores the regenerated cards/boosters/config on every legacy
// sealed_pools row that has none, so no pool depends on the upstream set file's order
// anymore (docs/tournaments/user-tournaments-spec.md §10). Needs DATABASE_URL and network
// access to the card data. Run once after the lot-1 migration:
//   node --env-file=.env scripts/freeze-sealed-pools.mjs
import { fileURLToPath } from 'node:url'
import { query, getPool } from '../src/lib/db.js'
import { regeneratePool } from '../api/_lib/tournamentPool.js'
import { configFromLegacyFormat } from '../src/lib/tournamentConfig.js'

export async function freezeSealedPools({ regenerate = regeneratePool, log = console.log } = {}) {
  const { rows } = await query('SELECT * FROM sealed_pools WHERE cards IS NULL ORDER BY created_at')
  let frozen = 0
  let failed = 0
  for (const row of rows) {
    try {
      const { counts, boosters } = await regenerate(row.sub, row)
      await query(
        'UPDATE sealed_pools SET cards = $2, boosters = $3, config = $4 WHERE id = $1 AND cards IS NULL',
        [row.id, JSON.stringify(counts), JSON.stringify(boosters), JSON.stringify(configFromLegacyFormat(row))],
      )
      frozen++
    } catch (e) {
      failed++
      log(`pool ${row.id} (${row.kind}, ${row.set_code}): ${e?.message}`)
    }
  }
  log(`frozen ${frozen}/${rows.length} pools (${failed} failed)`)
  return { total: rows.length, frozen, failed }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  freezeSealedPools()
    .then(({ failed }) => getPool().end().then(() => process.exit(failed ? 1 : 0)))
    .catch(e => { console.error(e); process.exit(1) })
}
```

Add to the `Makefile`, after `db-migrate`:

```make
# One-shot after the lot-1 migration: store the contents of legacy pools (see the script).
db-freeze-pools: check-node env
	$(NODE) --env-file=.env scripts/freeze-sealed-pools.mjs
```

(Use the same `$(NODE)` variable the `api` target's `API_CMD` uses; check the top of the Makefile for its name.)

- [ ] **Step 4: Run the test**

Run: `npm run test:integration -- tests/integration/tournaments.test.js -t freeze`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/freeze-sealed-pools.mjs Makefile tests/integration/tournaments.test.js
git commit -m "Add the one-shot script that stores legacy pool contents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Frontend API client

**Files:**
- Modify: `src/lib/tournamentApi.js`

**Interfaces:**
- Produces: `listTournaments(status = 'open') → { tournaments }`, `getTournament(id) → tournament`, `createTournament(body) → tournament`, `updateTournament(id, body) → tournament`, `deleteTournament(id) → {}`, `fetchTournamentPool(id) → pool`. Public reads attach the bearer when logged in and work logged out. Errors: `Error` with `.status` and `.data` (existing `handle` convention).

> No unit test: the module is a thin fetch wrapper and the repo has no DOM/fetch test harness. Verified by the pages (Tasks 16–18) against `make dev`.

- [ ] **Step 1: Add the functions**

Add after `authHeaders`:

```js
// Public endpoints accept an optional bearer (it only adds the `viewer` block): attach
// one when a session exists, never fail when logged out.
async function optionalAuthHeaders() {
  try {
    const token = await getAccessToken()
    return token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' }
  } catch {
    return { Accept: 'application/json' }
  }
}
```

Change `handle` so a `204` resolves to `{}`:

```js
async function handle(res) {
  if (res.status === 204) return {}
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed (HTTP ${res.status}).`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}
```

Append:

```js
// ---- User-created tournaments (api/tournaments/*) ---------------------------------

/** @param {'open'|'upcoming'|'ongoing'|'all'} status */
export async function listTournaments(status = 'open') {
  const res = await fetch(`/api/tournaments?status=${encodeURIComponent(status)}`, { headers: await optionalAuthHeaders() })
  return handle(res)
}

export async function getTournament(id) {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}`, { headers: await optionalAuthHeaders() })
  return handle(res)
}

export async function createTournament(body) {
  const res = await fetch('/api/tournaments', {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle(res)
}

/** Partial update, or `{ action: 'cancel'|'restore'|'close'|'reopen' }`. */
export async function updateTournament(id, body) {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle(res)
}

export async function deleteTournament(id) {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await authHeaders() })
  return handle(res)
}

/** Get-or-create the caller's pool for a tournament. 409 `tournament_closed` when creation is no longer allowed. */
export async function fetchTournamentPool(id) {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(id)}/pool`, { headers: await authHeaders() })
  return handle(res)
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: vite build succeeds (no import errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/tournamentApi.js
git commit -m "Add the tournaments client functions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: Extract `SetPresetGrid` from the Lobby

**Files:**
- Create: `src/components/SetPresetGrid.jsx`
- Modify: `src/pages/Lobby.jsx` (presets tab, ~lines 846–876; the `SET_ASSETS` import)

**Interfaces:**
- Produces: `<SetPresetGrid selected={code|null} onSelect={(code|null) => void} disabled={bool} />` — clicking the selected set deselects it (same toggle as the Lobby today).

> No component test harness in the repo. Verified by `npm run build` and the manual check below.

- [ ] **Step 1: Create `src/components/SetPresetGrid.jsx`**

```jsx
import { SETS } from '../lib/cardData.js'
import { SET_ASSETS } from '../lib/assets.js'

// The "pick one set" grid (logo on the set's colour), shared by the Lobby's presets tab
// and the tournament form. Visible sets only (COREKS is hidden).
export default function SetPresetGrid({ selected, onSelect, disabled = false }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {SETS.filter(s => !s.hidden).map(set => {
        const isSelected = selected === set.code
        const assets = SET_ASSETS[set.code]
        const logoUrl = assets?.logo
        const iconUrl = assets?.icon
        return (
          <button
            key={set.code}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(isSelected ? null : set.code)}
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 p-3 h-32 transition-all overflow-hidden gap-1 disabled:opacity-60 ${
              isSelected ? 'border-accent shadow-lg shadow-accent/20' : 'border-line hover:border-line'}`}
            style={{ backgroundColor: set.color + 'cc' }}
          >
            {logoUrl ? (
              <img src={logoUrl} alt={set.name} className="h-14 w-full object-contain"
                onError={e => { e.currentTarget.style.display = 'none' }} />
            ) : iconUrl ? (
              <img src={iconUrl} alt={set.name} className="h-10 object-contain"
                onError={e => { e.currentTarget.style.display = 'none' }} />
            ) : null}
            <span className="text-xs text-ink text-center leading-tight font-medium px-1">{set.name}</span>
            {isSelected && (
              <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center text-xs text-on-accent font-bold">✓</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Use it in the Lobby**

In `src/pages/Lobby.jsx`, replace the whole `<div className="grid grid-cols-1 sm:grid-cols-2 gap-3"> … </div>` block inside the PRESETS TAB (keep the hint `<p>` above it) with:

```jsx
                  <SetPresetGrid selected={selectedPreset} onSelect={setSelectedPreset} disabled={loading} />
```

Add `import SetPresetGrid from '../components/SetPresetGrid.jsx'` next to the other component imports, and remove `import { SET_ASSETS } from '../lib/assets.js'` (confirm with `grep -n SET_ASSETS src/pages/Lobby.jsx` that nothing else uses it; `SETS` stays, it is used for the recap label).

- [ ] **Step 3: Build and check the Lobby manually**

Run: `npm run build`, then `make dev`, create a room, choose Sealed → Cards.
Expected: the set grid looks and toggles exactly as before (select, click again to deselect, "Next" disabled until a set is chosen).

- [ ] **Step 4: Commit**

```bash
git add src/components/SetPresetGrid.jsx src/pages/Lobby.jsx
git commit -m "Extract the set preset grid from the Lobby for reuse

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: `SettingsFields.showLang`, `TournamentUniqueFields`, `TournamentPoolView.backTo`

**Files:**
- Modify: `src/components/SettingsFields.jsx`
- Create: `src/components/TournamentUniqueFields.jsx`
- Modify: `src/components/TournamentPoolView.jsx` (props + the `<h1>` block)

**Interfaces:**
- Produces: `SettingsFields` prop `showLang = true` (the Lobby passes nothing → unchanged).
- Produces: `<TournamentUniqueFields uniques={{ inBoosters, guaranteed, evenFactions }} onChange={next => void} uniqueSupport={bool} disabled={bool} />`.
- Produces: `TournamentPoolView` prop `backTo?: { to: string, label: string }`.

> No component test harness; verified by build + the manual checks of Tasks 16–17.

- [ ] **Step 1: `showLang` in `SettingsFields.jsx`**

Add `showLang = true,` to the destructured props (after `lang, setLang,`) and wrap the "Card language" block:

```jsx
      {/* Card language — hidden for tournaments (refs are language-independent) */}
      {showLang && (
        <div>
          <label className="block text-sm text-muted mb-2">{t('settingsFields.cardLanguage')}</label>
          <div className="flex gap-2 flex-wrap">
            {LANGS.map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`px-3 py-1 rounded text-sm font-mono transition-colors ${lang === l
                  ? 'bg-accent text-on-accent font-bold'
                  : 'bg-surface2 hover:bg-surface3 text-ink2'}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
```

- [ ] **Step 2: Create `src/components/TournamentUniqueFields.jsx`**

```jsx
import { useLang } from '../lib/i18n/i18n.jsx'
import { MAX_UNIQUES } from '../lib/tournamentConfig.js'

function Stepper({ value, onChange, min = 0, max = MAX_UNIQUES, disabled }) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min}
        className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">−</button>
      <span className="w-6 text-center text-sm font-bold text-ink tabular-nums">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max}
        className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">+</button>
    </div>
  )
}

// The tournament-only unique knobs (spec §5.1 `uniques`): exact uniques inside boosters,
// guaranteed uniques outside, even factions. `uniqueSupport` is false for sets without
// faction-range data (FUGUE): both counts are forced to 0 and the controls disabled.
export default function TournamentUniqueFields({ uniques, onChange, uniqueSupport = true, disabled = false }) {
  const { t } = useLang()
  const off = disabled || !uniqueSupport
  const total = (uniques.inBoosters ?? 0) + (uniques.guaranteed ?? 0)
  const set = patch => onChange({ ...uniques, ...patch })

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink2">{t('tournaments.tournamentUniquesTitle')}</p>
      {!uniqueSupport && <p className="text-xs text-accent2">{t('tournaments.uniquesUnsupported')}</p>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">{t('tournaments.uniquesInBoosters')}</span>
        <Stepper value={uniqueSupport ? uniques.inBoosters : 0} onChange={v => set({ inBoosters: v })} disabled={off} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">{t('tournaments.uniquesGuaranteed')}</span>
        <Stepper value={uniqueSupport ? uniques.guaranteed : 0} onChange={v => set({ guaranteed: v })} disabled={off} />
      </div>
      <div className="flex items-center gap-3">
        <input type="checkbox" id="even-factions" checked={!!uniques.evenFactions && total >= 2}
          disabled={off || total < 2}
          onChange={e => set({ evenFactions: e.target.checked })}
          className="accent-accent w-4 h-4" />
        <label htmlFor="even-factions" className={`text-sm cursor-pointer ${total < 2 ? 'text-faint' : 'text-ink2'}`}>
          {t('tournaments.evenFactions')}
        </label>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: `backTo` in `TournamentPoolView.jsx`**

Change the signature to `export default function TournamentPoolView({ title, load, reset, backTo = null })` and, inside the returned JSX, insert right before `<div className="flex items-center gap-3 mb-3 flex-wrap">`:

```jsx
        {backTo && (
          <Link to={backTo.to} className="text-xs text-muted hover:text-ink transition-colors mb-2 inline-block">
            ← {backTo.label}
          </Link>
        )}
```

and add `import { Link } from 'react-router-dom'` at the top.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success. Open `make dev` → a room's Sealed settings step still shows the language row (default `showLang`).

- [ ] **Step 5: Commit**

```bash
git add src/components/SettingsFields.jsx src/components/TournamentUniqueFields.jsx src/components/TournamentPoolView.jsx
git commit -m "Add the tournament unique controls and small reuse hooks on shared components

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 15: i18n — the `tournaments` namespace (EN + FR)

**Files:**
- Modify: `src/lib/i18n/en.js`, `src/lib/i18n/fr.js` (add a top-level `tournaments: { … }` key right after `tournamentPages`)

**Interfaces:**
- Produces: the keys below, used by Tasks 14, 16, 17, 18. Plurals use the `tc` convention (`…One` / `…Many` with `{{n}}`).

- [ ] **Step 1: Add to `en.js`**

```js
  tournaments: {
    // menu
    upcomingTitle: 'Upcoming tournaments',
    ongoingTitle: 'Ongoing tournaments',
    noUpcoming: 'No upcoming tournament yet.',
    noOngoing: 'No ongoing tournament.',
    createButton: 'Create a tournament',
    myTournamentsTitle: 'My tournaments',
    genericPrepTitle: 'Tournament not listed here?',
    genericPrepHint: 'Prepare a pool with the default format. It binds to the first unlisted BGA tournament you play.',
    loading: 'Loading…',
    couldNotLoad: 'Could not load the tournaments.',
    // statuses
    statusUpcoming: 'Upcoming',
    statusOngoing: 'Ongoing',
    statusEnded: 'Ended',
    statusCancelled: 'Cancelled',
    // card / detail
    startsAt: 'Starts {{date}}',
    endsAt: 'Ends {{date}}',
    organizedBy: 'Organized by {{name}}',
    poolsPreparedOne: '{{n}} pool prepared',
    poolsPreparedMany: '{{n}} pools prepared',
    timezoneNote: 'Times are shown in your timezone ({{tz}}).',
    summaryBoosters: '{{n}} boosters · {{set}}',
    summaryUniquesInOne: '{{n}} unique in boosters',
    summaryUniquesInMany: '{{n}} uniques in boosters',
    summaryUniquesOutOne: '{{n}} guaranteed unique',
    summaryUniquesOutMany: '{{n}} guaranteed uniques',
    summaryEven: 'even factions',
    summaryHeroesFree: 'free hero choice',
    summaryBanlist: 'ban list excluded',
    youHavePool: 'Your pool is ready',
    yourDeck: 'Deck: {{name}} · {{n}} cards',
    connectToPrepare: 'Connect to prepare your pool',
    open: 'Open',
    // form
    createTitle: 'Create a tournament',
    editTitle: 'Edit the tournament',
    sectionInfo: 'Tournament',
    sectionCards: 'Cards',
    sectionSettings: 'Settings',
    nameLabel: 'Name',
    descriptionLabel: 'Description',
    bgaUrlLabel: 'BGA tournament link',
    bgaUrlHint: 'Paste the link of the MAIN tournament page (not a stage): https://boardgamearena.com/tournament?id=…',
    bgaIdDetected: 'Tournament id {{id}} detected',
    bgaUrlInvalid: 'This is not a BGA tournament link.',
    startsAtLabel: 'Start',
    endsAtLabel: 'End (optional)',
    cardsHint: 'Each player receives 7 boosters of this set.',
    lockedNotice: 'Cards, settings and the BGA link are locked: pools already exist.',
    tournamentUniquesTitle: 'Tournament uniques',
    uniquesInBoosters: 'Uniques inside boosters (each replaces a rare)',
    uniquesGuaranteed: 'Guaranteed uniques (outside the boosters)',
    evenFactions: 'Spread the uniques evenly across factions',
    uniquesUnsupported: 'No unique data for this set yet: uniques are disabled.',
    submitCreate: 'Create the tournament',
    submitSave: 'Save',
    saving: 'Saving…',
    errName: 'The name must be between 3 and 80 characters.',
    errDescription: 'The description is too long (2000 characters max).',
    errStartsAt: 'The start must be a valid date in the future.',
    errStartsAtBeforeEnd: 'The start must be before the end.',
    errEndsAt: 'The end must be after the start.',
    errBgaUrl: 'Paste a valid BGA tournament link.',
    errBgaTaken: 'A tournament already exists for this BGA link.',
    errTooMany: 'You already have 10 open tournaments. Close or cancel one first.',
    errLocked: 'Pools already exist: cards, settings and the BGA link can no longer change.',
    errGeneric: 'Something went wrong: {{msg}}',
    errSelectSet: 'Choose a set.',
    // detail / checklist
    notFound: 'Tournament not found.',
    checklistTitle: 'Your 3 steps',
    step1Title: 'Register on BGA',
    step1Desc: 'The tournament itself runs on BGA. Registration closes when it starts.',
    step1Button: 'Open the BGA tournament',
    step1Done: "I'm registered on BGA",
    step2Title: 'Open your pool',
    step2Desc: 'Your 7 boosters are generated once and locked. No re-roll.',
    step2Button: 'Open my pool',
    step2ButtonExisting: 'See my pool',
    step2Opening: 'Opening your boosters…',
    step2Closed: 'Pool creation is closed for this tournament.',
    step3Title: 'Build your deck',
    step3Desc: 'At least 30 cards, up to 3 factions, 1 hero. Saved to your Re:Union account automatically.',
    step3Button: 'Edit my deck',
    step3NoDeck: 'No deck yet.',
    // organizer panel
    organizerPanel: 'Organizer',
    poolsByOrigin: '{{page}} from this site · {{bga}} created by BGA games',
    bgaZeroWarning: 'The tournament started but no pool was created by a BGA game yet. Check that the BGA link points to the main tournament, not a stage.',
    edit: 'Edit',
    cancel: 'Cancel the tournament',
    restore: 'Restore',
    close: 'Mark as ended',
    reopen: 'Reopen',
    delete: 'Delete',
    cancelConfirm: 'Cancel this tournament? Existing pools and decks are kept.',
    deleteConfirm: 'Delete this tournament? This cannot be undone.',
    deleteBlocked: 'Cannot delete: pools exist. Cancel it instead.',
    backToTournament: 'Back to the tournament',
  },
```

- [ ] **Step 2: Add to `fr.js`**

```js
  tournaments: {
    upcomingTitle: 'Tournois à venir',
    ongoingTitle: 'Tournois en cours',
    noUpcoming: 'Aucun tournoi à venir pour le moment.',
    noOngoing: 'Aucun tournoi en cours.',
    createButton: 'Créer un tournoi',
    myTournamentsTitle: 'Mes tournois',
    genericPrepTitle: 'Votre tournoi n’est pas dans la liste ?',
    genericPrepHint: 'Préparez un pool au format par défaut. Il sera rattaché au premier tournoi BGA non listé que vous jouerez.',
    loading: 'Chargement…',
    couldNotLoad: 'Impossible de charger les tournois.',
    statusUpcoming: 'À venir',
    statusOngoing: 'En cours',
    statusEnded: 'Terminé',
    statusCancelled: 'Annulé',
    startsAt: 'Début {{date}}',
    endsAt: 'Fin {{date}}',
    organizedBy: 'Organisé par {{name}}',
    poolsPreparedOne: '{{n}} pool préparé',
    poolsPreparedMany: '{{n}} pools préparés',
    timezoneNote: 'Horaires affichés dans votre fuseau ({{tz}}).',
    summaryBoosters: '{{n}} boosters · {{set}}',
    summaryUniquesInOne: '{{n}} unique dans les boosters',
    summaryUniquesInMany: '{{n}} uniques dans les boosters',
    summaryUniquesOutOne: '{{n}} unique garantie',
    summaryUniquesOutMany: '{{n}} uniques garanties',
    summaryEven: 'factions équilibrées',
    summaryHeroesFree: 'héros au choix',
    summaryBanlist: 'cartes suspendues exclues',
    youHavePool: 'Votre pool est prêt',
    yourDeck: 'Deck : {{name}} · {{n}} cartes',
    connectToPrepare: 'Connectez-vous pour préparer votre pool',
    open: 'Ouvrir',
    createTitle: 'Créer un tournoi',
    editTitle: 'Modifier le tournoi',
    sectionInfo: 'Tournoi',
    sectionCards: 'Cartes',
    sectionSettings: 'Paramètres',
    nameLabel: 'Nom',
    descriptionLabel: 'Description',
    bgaUrlLabel: 'Lien du tournoi BGA',
    bgaUrlHint: 'Collez le lien de la page PRINCIPALE du tournoi (pas une étape) : https://boardgamearena.com/tournament?id=…',
    bgaIdDetected: 'Tournoi n° {{id}} détecté',
    bgaUrlInvalid: 'Ce n’est pas un lien de tournoi BGA.',
    startsAtLabel: 'Début',
    endsAtLabel: 'Fin (optionnel)',
    cardsHint: 'Chaque joueur reçoit 7 boosters de cette extension.',
    lockedNotice: 'Cartes, paramètres et lien BGA sont verrouillés : des pools existent déjà.',
    tournamentUniquesTitle: 'Uniques du tournoi',
    uniquesInBoosters: 'Uniques dans les boosters (chacune remplace une rare)',
    uniquesGuaranteed: 'Uniques garanties (hors boosters)',
    evenFactions: 'Répartir les uniques équitablement entre les factions',
    uniquesUnsupported: 'Pas encore de données d’uniques pour cette extension : uniques désactivées.',
    submitCreate: 'Créer le tournoi',
    submitSave: 'Enregistrer',
    saving: 'Enregistrement…',
    errName: 'Le nom doit faire entre 3 et 80 caractères.',
    errDescription: 'La description est trop longue (2000 caractères max).',
    errStartsAt: 'Le début doit être une date valide dans le futur.',
    errStartsAtBeforeEnd: 'Le début doit précéder la fin.',
    errEndsAt: 'La fin doit être après le début.',
    errBgaUrl: 'Collez un lien de tournoi BGA valide.',
    errBgaTaken: 'Un tournoi existe déjà pour ce lien BGA.',
    errTooMany: 'Vous avez déjà 10 tournois ouverts. Terminez-en ou annulez-en un d’abord.',
    errLocked: 'Des pools existent déjà : cartes, paramètres et lien BGA ne peuvent plus changer.',
    errGeneric: 'Une erreur est survenue : {{msg}}',
    errSelectSet: 'Choisissez une extension.',
    notFound: 'Tournoi introuvable.',
    checklistTitle: 'Vos 3 étapes',
    step1Title: 'Inscrivez-vous sur BGA',
    step1Desc: 'Le tournoi lui-même se joue sur BGA. Les inscriptions ferment au début.',
    step1Button: 'Ouvrir le tournoi BGA',
    step1Done: 'Je suis inscrit sur BGA',
    step2Title: 'Ouvrez votre pool',
    step2Desc: 'Vos 7 boosters sont générés une seule fois et verrouillés. Pas de relance.',
    step2Button: 'Ouvrir mon pool',
    step2ButtonExisting: 'Voir mon pool',
    step2Opening: 'Ouverture de vos boosters…',
    step2Closed: 'La création de pool est fermée pour ce tournoi.',
    step3Title: 'Construisez votre deck',
    step3Desc: 'Au moins 30 cartes, 3 factions max, 1 héros. Sauvegardé automatiquement sur votre compte Re:Union.',
    step3Button: 'Modifier mon deck',
    step3NoDeck: 'Pas encore de deck.',
    organizerPanel: 'Organisateur',
    poolsByOrigin: '{{page}} depuis ce site · {{bga}} créés par des parties BGA',
    bgaZeroWarning: 'Le tournoi a commencé mais aucun pool n’a été créé par une partie BGA. Vérifiez que le lien BGA pointe vers le tournoi principal, pas une étape.',
    edit: 'Modifier',
    cancel: 'Annuler le tournoi',
    restore: 'Rétablir',
    close: 'Marquer comme terminé',
    reopen: 'Rouvrir',
    delete: 'Supprimer',
    cancelConfirm: 'Annuler ce tournoi ? Les pools et decks existants sont conservés.',
    deleteConfirm: 'Supprimer ce tournoi ? Cette action est irréversible.',
    deleteBlocked: 'Suppression impossible : des pools existent. Annulez-le plutôt.',
    backToTournament: 'Retour au tournoi',
  },
```

- [ ] **Step 3: Check both dictionaries have the same keys**

Run:

```bash
node -e "
import('./src/lib/i18n/en.js').then(async en => {
  const fr = (await import('./src/lib/i18n/fr.js')).default
  const a = Object.keys(en.default.tournaments).sort(), b = Object.keys(fr.tournaments).sort()
  const missing = a.filter(k => !b.includes(k)).concat(b.filter(k => !a.includes(k)))
  console.log(missing.length ? 'MISSING: ' + missing.join(', ') : 'ok ' + a.length + ' keys')
})"
```

Expected: `ok 98 keys` (or the exact count; what matters is no `MISSING`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/i18n/en.js src/lib/i18n/fr.js
git commit -m "Add the tournaments i18n namespace (EN/FR)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 16: `TournamentForm` page (create + edit) and the routes

**Files:**
- Create: `src/pages/TournamentForm.jsx`
- Modify: `src/App.jsx` (four routes; the detail/pool pages of Task 17 are created in the next task — add their imports there, or add the routes in Task 17 if you prefer one route commit)

**Interfaces:**
- Consumes: `SetPresetGrid` (13), `SettingsFields` with `showLang={false}` (14), `TournamentUniqueFields` (14), `validateTournamentFields` + `parseBgaTournamentUrl` (1), `validateTournamentConfig` + `hasFactionRanges` (2), `createTournament`/`updateTournament`/`getTournament` (12), i18n (15).
- Produces: routes `/tournament/new` and `/tournament/t/:id/edit`.

> No component test harness; verified by build + the manual checklist in Step 4.

- [ ] **Step 1: Create `src/pages/TournamentForm.jsx`**

```jsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'
import { parseBgaTournamentUrl } from '../lib/bgaUrl.js'
import { validateTournamentFields } from '../lib/tournamentRules.js'
import { validateTournamentConfig } from '../lib/tournamentConfig.js'
import { hasFactionRanges } from '../lib/uniqueFactionRanges.js'
import { createTournament, updateTournament, getTournament } from '../lib/tournamentApi.js'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'
import SetPresetGrid from '../components/SetPresetGrid.jsx'
import SettingsFields from '../components/SettingsFields.jsx'
import TournamentUniqueFields from '../components/TournamentUniqueFields.jsx'

// <input type="datetime-local"> speaks local wall-clock time without a zone; the API
// speaks ISO/UTC. Convert at the edges only.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
function defaultStart() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(20, 0, 0, 0)
  return toLocalInput(d.toISOString())
}

const FIELD_ERROR_KEYS = {
  name: 'tournaments.errName',
  description: 'tournaments.errDescription',
  startsAt: 'tournaments.errStartsAt',
  endsAt: 'tournaments.errEndsAt',
  bgaUrl: 'tournaments.errBgaUrl',
}

export default function TournamentForm() {
  const { id } = useParams() // present in edit mode
  const navigate = useNavigate()
  const { user, login, loading: authLoading } = useAuth()
  const { t } = useLang()
  const isEdit = !!id

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [bgaUrl, setBgaUrl] = useState('')
  const [startsAt, setStartsAt] = useState(defaultStart)
  const [endsAt, setEndsAt] = useState('')
  const [setCode, setSetCode] = useState(null)
  const [heroes, setHeroes] = useState('packs')
  const [uniques, setUniques] = useState({ inBoosters: 1, guaranteed: 1, evenFactions: false })
  const [excludeBanlist, setExcludeBanlist] = useState(false)

  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  // Edit mode: prefill from the tournament; only its organizer or a moderator may be here.
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    getTournament(id)
      .then(tn => {
        if (cancelled) return
        if (!tn.viewer?.isOrganizer && !tn.viewer?.isModerator) { navigate(`/tournament/t/${id}`, { replace: true }); return }
        setName(tn.name); setDescription(tn.description); setBgaUrl(tn.bgaUrl)
        setStartsAt(toLocalInput(tn.startsAt)); setEndsAt(toLocalInput(tn.endsAt))
        setSetCode(tn.config.source.setCode); setHeroes(tn.config.heroes)
        setUniques(tn.config.uniques); setExcludeBanlist(!!tn.config.excludeBanlist)
        setLocked(!!tn.locked)
      })
      .catch(e => { if (!cancelled) setError(e.status === 404 ? t('tournaments.notFound') : t('tournaments.errGeneric', { msg: e.message })) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, isEdit, navigate, t, user])

  const bgaParsed = useMemo(() => parseBgaTournamentUrl(bgaUrl), [bgaUrl])
  const uniqueSupport = !setCode || hasFactionRanges(setCode)
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }, [])

  const config = {
    v: 1, format: 'sealed',
    source: { type: 'set', setCode, boosters: 7 },
    heroes,
    uniques: uniqueSupport ? uniques : { inBoosters: 0, guaranteed: 0, evenFactions: false },
    excludeBanlist,
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setFieldErrors({})
    const body = { name, description, bgaUrl, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt), config }

    // Same pure checks the server runs — surfaces errors before the round-trip.
    const fields = validateTournamentFields(body, { isCreate: !isEdit })
    const cfg = validateTournamentConfig(config)
    if (!fields.ok || (!locked && !cfg.ok)) {
      setFieldErrors(fields.errors)
      if (!locked && !cfg.ok) setError(cfg.errors.includes('source.setCode') ? t('tournaments.errSelectSet') : t('tournaments.errGeneric', { msg: cfg.errors.join(', ') }))
      return
    }

    setSaving(true)
    try {
      if (isEdit) {
        const patch = { name: body.name, description: body.description, startsAt: body.startsAt, endsAt: body.endsAt }
        if (!locked) { patch.bgaUrl = body.bgaUrl; patch.config = cfg.config }
        await updateTournament(id, patch)
        navigate(`/tournament/t/${id}`)
      } else {
        const created = await createTournament({ ...body, config: cfg.config })
        navigate(`/tournament/t/${created.id}`)
      }
    } catch (err) {
      if (err.status === 400 && err.data?.fields) setFieldErrors(err.data.fields)
      else if (err.status === 409 && err.data?.error === 'bga_tournament_taken') setFieldErrors({ bgaUrl: 'taken' })
      else if (err.status === 409 && err.data?.error === 'tournament_locked') setError(t('tournaments.errLocked'))
      else if (err.status === 429) setError(t('tournaments.errTooMany'))
      else setError(t('tournaments.errGeneric', { msg: err.message }))
    } finally {
      setSaving(false)
    }
  }

  const fieldMsg = key => {
    const code = fieldErrors[key]
    if (!code) return null
    if (key === 'bgaUrl' && code === 'taken') return t('tournaments.errBgaTaken')
    if (key === 'startsAt' && code === 'must_be_before_end') return t('tournaments.errStartsAtBeforeEnd')
    return t(FIELD_ERROR_KEYS[key] ?? 'tournaments.errGeneric', { msg: code })
  }
  const inputCls = 'w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent'
  const ErrorLine = ({ field }) => fieldMsg(field) ? <p className="text-xs text-red-400 mt-1">{fieldMsg(field)}</p> : null

  if (!authLoading && !user) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopNav />
        <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1">
          <div className="bg-surface rounded-xl p-6 text-center space-y-3">
            <p className="text-muted text-sm">{t('home.bgaConnectRequired')}</p>
            <button onClick={() => login(isEdit ? `/tournament/t/${id}/edit` : '/tournament/new')}
              className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors">
              {t('reunion.connect')}
            </button>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <form onSubmit={handleSubmit} className="max-w-2xl w-full mx-auto px-4 py-8 flex-1 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display">{isEdit ? t('tournaments.editTitle') : t('tournaments.createTitle')}</h1>
          <Link to={isEdit ? `/tournament/t/${id}` : '/tournament'} className="text-sm text-muted hover:text-ink">{t('lobby.back')}</Link>
        </div>
        {loading && <p className="text-muted text-sm">{t('tournaments.loading')}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {/* Section 1 — the tournament */}
        <section className="bg-surface rounded-xl border border-line p-5 space-y-4">
          <h2 className="font-semibold">{t('tournaments.sectionInfo')}</h2>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-name">{t('tournaments.nameLabel')}</label>
            <input id="tn-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} className={inputCls} />
            <ErrorLine field="name" />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-desc">{t('tournaments.descriptionLabel')}</label>
            <textarea id="tn-desc" value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={2000} className={`${inputCls} resize-y`} />
            <ErrorLine field="description" />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-bga">{t('tournaments.bgaUrlLabel')}</label>
            <input id="tn-bga" value={bgaUrl} onChange={e => setBgaUrl(e.target.value)} disabled={locked}
              placeholder="https://boardgamearena.com/tournament?id=…" className={`${inputCls} font-mono disabled:opacity-60`} />
            <p className="text-xs text-faint mt-1">{t('tournaments.bgaUrlHint')}</p>
            {bgaUrl.trim() && (
              <p className={`text-xs mt-1 ${bgaParsed ? 'text-green-400' : 'text-red-400'}`}>
                {bgaParsed ? t('tournaments.bgaIdDetected', { id: bgaParsed.id }) : t('tournaments.bgaUrlInvalid')}
              </p>
            )}
            <ErrorLine field="bgaUrl" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1" htmlFor="tn-start">{t('tournaments.startsAtLabel')}</label>
              <input id="tn-start" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className={inputCls} />
              <ErrorLine field="startsAt" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1" htmlFor="tn-end">{t('tournaments.endsAtLabel')}</label>
              <input id="tn-end" type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className={inputCls} />
              <ErrorLine field="endsAt" />
            </div>
          </div>
          <p className="text-xs text-faint">{t('tournaments.timezoneNote', { tz })}</p>
        </section>

        {/* Section 2 — cards */}
        <section className="bg-surface rounded-xl border border-line p-5 space-y-4">
          <h2 className="font-semibold">{t('tournaments.sectionCards')}</h2>
          {locked && <p className="text-xs text-accent2">{t('tournaments.lockedNotice')}</p>}
          <p className="text-sm text-muted">{t('tournaments.cardsHint')}</p>
          <SetPresetGrid selected={setCode} onSelect={setSetCode} disabled={locked || saving} />
        </section>

        {/* Section 3 — settings */}
        <section className="bg-surface rounded-xl border border-line p-5 space-y-6">
          <h2 className="font-semibold">{t('tournaments.sectionSettings')}</h2>
          <fieldset disabled={locked || saving} className="space-y-6 disabled:opacity-60">
            <SettingsFields
              mode="sealed"
              showLang={false}
              heroMode={heroes} setHeroMode={setHeroes}
              showUniques={false}
              excludeBanlist={excludeBanlist} setExcludeBanlist={setExcludeBanlist}
              showBanlist
            />
            <TournamentUniqueFields uniques={uniques} onChange={setUniques} uniqueSupport={uniqueSupport} disabled={locked || saving} />
          </fieldset>
        </section>

        <button type="submit" disabled={saving || loading}
          className="w-full py-2.5 bg-accent hover:bg-accent2 disabled:opacity-40 text-on-accent font-bold rounded-lg transition-colors">
          {saving ? t('tournaments.saving') : isEdit ? t('tournaments.submitSave') : t('tournaments.submitCreate')}
        </button>
      </form>
      <Footer />
    </div>
  )
}
```

`SettingsFields` is rendered without `lang`/`setLang`/timer props: they are only read inside the hidden language block and the draft-only timer block, so leaving them undefined is safe (`mode="sealed"` hides the timer).

- [ ] **Step 2: Routes in `src/App.jsx`**

Add the imports:

```jsx
import TournamentForm from './pages/TournamentForm.jsx'
import TournamentDetail from './pages/TournamentDetail.jsx'
import TournamentPoolPage from './pages/TournamentPoolPage.jsx'
```

Add the routes after `/tournament/pools/:id`:

```jsx
      <Route path="/tournament/new" element={<TournamentForm />} />
      <Route path="/tournament/t/:id" element={<TournamentDetail />} />
      <Route path="/tournament/t/:id/edit" element={<TournamentForm />} />
      <Route path="/tournament/t/:id/pool" element={<TournamentPoolPage />} />
```

(Until Task 17 lands, create the two page files as one-line placeholders returning `null` so the build passes — and replace them in Task 17. If you do Task 17 first, skip this.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Manual check in `make dev` (log in as `alice`)**

1. Open `http://localhost:5173/tournament/new`. Fill name "Test cup", paste `https://fr.boardgamearena.com/tournament/?id=123456` → green "Tournament id 123456 detected". Pick Skybound Odyssey. Leave uniques 1/1. Submit.
   Expected: redirect to `/tournament/t/<id>` (a blank page until Task 17; the URL is the check), and `curl -s localhost:8080/api/tournaments | jq '.tournaments[0] | {name, bgaTournamentId, status}'` shows the row.
2. Submit again with the same link in a new form → "A tournament already exists for this BGA link." under the link field.
3. Set the start to yesterday → "The start must be a valid date in the future." without a request (network tab idle).
4. Pick Neverending Journey → the unique steppers are disabled with the "No unique data…" hint; submitting succeeds with 0 uniques.

- [ ] **Step 5: Commit**

```bash
git add src/pages/TournamentForm.jsx src/App.jsx
git commit -m "Add the tournament create/edit form and its routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 17: Tournament page (checklist + organizer panel) and the pool page

**Files:**
- Create: `src/components/TournamentBits.jsx` (status pill, date formatting, config summary)
- Create: `src/components/TournamentChecklist.jsx`
- Create: `src/pages/TournamentDetail.jsx`
- Create: `src/pages/TournamentPoolPage.jsx`

**Interfaces:**
- Consumes: `getTournament`, `updateTournament`, `deleteTournament`, `fetchTournamentPool` (12); `tournamentStatus` not needed (the API sends `status`); `TournamentPoolView` with `backTo` (14); i18n (15).
- Produces: `<StatusPill status />`, `formatDateTime(iso) → string`, `summarizeConfig(config, t, tc) → string`, `<TournamentChecklist tournament viewer user onLogin onOpenPool opening openError />`; pages for `/tournament/t/:id` and `/tournament/t/:id/pool`.

> No component test harness; verified by build + the manual checklist in Step 6.

- [ ] **Step 1: Create `src/components/TournamentBits.jsx`**

```jsx
import { SETS } from '../lib/cardData.js'

const PILL = {
  upcoming: 'text-accent border-accent/50 bg-accent/10',
  ongoing: 'text-green-400 border-green-700 bg-green-900/25',
  ended: 'text-muted border-line bg-surface2',
  cancelled: 'text-red-400 border-red-800 bg-red-950/25',
}

export function StatusPill({ status, t }) {
  const key = { upcoming: 'statusUpcoming', ongoing: 'statusOngoing', ended: 'statusEnded', cancelled: 'statusCancelled' }[status] ?? 'statusUpcoming'
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${PILL[status] ?? PILL.upcoming}`}>{t(`tournaments.${key}`)}</span>
}

/** Viewer-local date + time (the API sends UTC ISO strings). */
export function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(iso)
  }
}

/** One line: "7 boosters · Skybound Odyssey · 1 unique in boosters · 1 guaranteed unique · free hero choice". */
export function summarizeConfig(config, t, tc) {
  if (!config) return ''
  const setName = SETS.find(s => s.code === config.source?.setCode)?.name ?? config.source?.setCode ?? ''
  const parts = [t('tournaments.summaryBoosters', { n: config.source?.boosters ?? 7, set: setName })]
  const u = config.uniques ?? {}
  if (u.inBoosters > 0) parts.push(tc('tournaments.summaryUniquesIn', u.inBoosters))
  if (u.guaranteed > 0) parts.push(tc('tournaments.summaryUniquesOut', u.guaranteed))
  if (u.evenFactions && (u.inBoosters + u.guaranteed) >= 2) parts.push(t('tournaments.summaryEven'))
  if (config.heroes === 'free') parts.push(t('tournaments.summaryHeroesFree'))
  if (config.excludeBanlist) parts.push(t('tournaments.summaryBanlist'))
  return parts.join(' · ')
}
```

- [ ] **Step 2: Create `src/components/TournamentChecklist.jsx`**

```jsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../lib/i18n/i18n.jsx'

const registeredKey = id => `tournament_bga_registered:${id}`

function Step({ n, title, desc, done, children }) {
  return (
    <div className={`flex gap-3 rounded-lg border p-3 ${done ? 'border-green-700 bg-green-900/10' : 'border-line bg-surface2'}`}>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
        done ? 'bg-green-700 text-white' : 'bg-accent text-on-accent'}`}>{done ? '✓' : n}</span>
      <div className="flex-1 space-y-1.5">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-faint">{desc}</p>
        <div className="pt-1">{children}</div>
      </div>
    </div>
  )
}

/**
 * The 3-step wizard of a tournament page (spec §3.3): register on BGA (remembered in
 * localStorage, since BGA registration can't be verified) → open the one-shot pool →
 * build the deck. `viewer` is the API's viewer block (null when logged out).
 */
export default function TournamentChecklist({ tournament, viewer, user, onLogin, onOpenPool, opening, openError }) {
  const { t } = useLang()
  const [registered, setRegistered] = useState(false)
  useEffect(() => {
    try { setRegistered(localStorage.getItem(registeredKey(tournament.id)) === '1') } catch { /* ignore */ }
  }, [tournament.id])
  function toggleRegistered(checked) {
    setRegistered(checked)
    try { localStorage.setItem(registeredKey(tournament.id), checked ? '1' : '0') } catch { /* ignore */ }
  }

  const open = tournament.status === 'upcoming' || tournament.status === 'ongoing'
  const hasPool = !!viewer?.hasPool
  const poolHref = `/tournament/t/${tournament.id}/pool`
  const btn = 'inline-block text-sm px-3 py-1.5 rounded-lg bg-accent hover:bg-accent2 text-on-accent font-semibold transition-colors disabled:opacity-40'
  const btn2 = 'inline-block text-sm px-3 py-1.5 rounded-lg bg-surface3 hover:bg-surface3 text-ink transition-colors'

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-lg">{t('tournaments.checklistTitle')}</h2>

      <Step n={1} title={t('tournaments.step1Title')} desc={t('tournaments.step1Desc')} done={registered}>
        <div className="flex flex-wrap items-center gap-3">
          <a href={tournament.bgaUrl} target="_blank" rel="noopener noreferrer" className={btn}>{t('tournaments.step1Button')} ↗</a>
          <label className="flex items-center gap-2 text-sm text-ink2 cursor-pointer">
            <input type="checkbox" checked={registered} onChange={e => toggleRegistered(e.target.checked)} className="accent-accent w-4 h-4" />
            {t('tournaments.step1Done')}
          </label>
        </div>
      </Step>

      <Step n={2} title={t('tournaments.step2Title')} desc={t('tournaments.step2Desc')} done={hasPool}>
        {!user ? (
          <button type="button" onClick={onLogin} className={btn}>{t('tournaments.connectToPrepare')}</button>
        ) : hasPool ? (
          <Link to={poolHref} className={btn2}>{t('tournaments.step2ButtonExisting')}</Link>
        ) : open ? (
          <button type="button" onClick={onOpenPool} disabled={opening} className={btn}>
            {opening ? t('tournaments.step2Opening') : t('tournaments.step2Button')}
          </button>
        ) : (
          <p className="text-xs text-muted">{t('tournaments.step2Closed')}</p>
        )}
        {openError && <p className="text-xs text-red-400 mt-1">{openError}</p>}
      </Step>

      <Step n={3} title={t('tournaments.step3Title')} desc={t('tournaments.step3Desc')} done={!!viewer?.deck?.cardQuantity}>
        {hasPool ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link to={poolHref} className={btn2}>{t('tournaments.step3Button')}</Link>
            <span className="text-xs text-muted">
              {viewer.deck ? t('tournaments.yourDeck', { name: viewer.deck.name, n: viewer.deck.cardQuantity ?? 0 }) : t('tournaments.step3NoDeck')}
            </span>
          </div>
        ) : (
          <p className="text-xs text-faint">{t('tournaments.step3NoDeck')}</p>
        )}
      </Step>
    </section>
  )
}
```

- [ ] **Step 3: Create `src/pages/TournamentDetail.jsx`**

```jsx
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'
import { getTournament, updateTournament, deleteTournament, fetchTournamentPool } from '../lib/tournamentApi.js'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'
import TournamentChecklist from '../components/TournamentChecklist.jsx'
import { StatusPill, formatDateTime, summarizeConfig } from '../components/TournamentBits.jsx'

export default function TournamentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const { t, tc } = useLang()
  const [tournament, setTournament] = useState(null)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    setError('')
    return getTournament(id)
      .then(setTournament)
      .catch(e => setError(e.status === 404 ? t('tournaments.notFound') : t('tournaments.errGeneric', { msg: e.message })))
  }, [id, t])

  // Re-fetch when the session changes: the viewer block depends on the bearer.
  useEffect(() => { reload() }, [reload, user])

  async function handleOpenPool() {
    setOpening(true); setOpenError('')
    try {
      await fetchTournamentPool(id)
      navigate(`/tournament/t/${id}/pool`)
    } catch (e) {
      setOpenError(e.status === 409 ? t('tournaments.step2Closed') : t('tournaments.errGeneric', { msg: e.message }))
    } finally {
      setOpening(false)
    }
  }

  async function act(action) {
    const confirmKey = action === 'cancel' ? 'tournaments.cancelConfirm' : null
    if (confirmKey && !window.confirm(t(confirmKey))) return
    setBusy(true)
    try {
      setTournament(await updateTournament(id, { action }))
    } catch (e) {
      setError(t('tournaments.errGeneric', { msg: e.message }))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('tournaments.deleteConfirm'))) return
    setBusy(true)
    try {
      await deleteTournament(id)
      navigate('/tournament')
    } catch (e) {
      setError(e.status === 409 ? t('tournaments.deleteBlocked') : t('tournaments.errGeneric', { msg: e.message }))
      setBusy(false)
    }
  }

  const viewer = tournament?.viewer ?? null
  const canManage = !!(viewer?.isOrganizer || viewer?.isModerator)
  const btn = 'text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 disabled:opacity-40 transition-colors'

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1 space-y-6">
        <Link to="/tournament" className="text-xs text-muted hover:text-ink">← {t('tournamentPages.menuTitle')}</Link>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!tournament && !error && <p className="text-muted text-sm">{t('tournaments.loading')}</p>}

        {tournament && (
          <>
            <header className="bg-surface rounded-xl border border-line p-5 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-display">{tournament.name}</h1>
                <StatusPill status={tournament.status} t={t} />
              </div>
              <p className="text-sm text-ink2">
                {t('tournaments.startsAt', { date: formatDateTime(tournament.startsAt) })}
                {tournament.endsAt ? ` · ${t('tournaments.endsAt', { date: formatDateTime(tournament.endsAt) })}` : ''}
              </p>
              <p className="text-xs text-faint">
                {t('tournaments.organizedBy', { name: tournament.organizer.name })} · {tc('tournaments.poolsPrepared', tournament.poolCount ?? 0)}
              </p>
              <p className="text-sm text-muted">{summarizeConfig(tournament.config, t, tc)}</p>
              {tournament.description && <p className="text-sm text-ink whitespace-pre-wrap pt-2">{tournament.description}</p>}
            </header>

            <TournamentChecklist
              tournament={tournament} viewer={viewer} user={user}
              onLogin={() => login(`/tournament/t/${id}`)}
              onOpenPool={handleOpenPool} opening={opening} openError={openError}
            />

            {canManage && (
              <section className="bg-surface2 rounded-xl border border-line p-4 space-y-3">
                <h2 className="font-semibold text-sm">{t('tournaments.organizerPanel')}</h2>
                {tournament.poolsByOrigin && (
                  <p className="text-xs text-muted">
                    {t('tournaments.poolsByOrigin', { page: tournament.poolsByOrigin.page + tournament.poolsByOrigin.legacy, bga: tournament.poolsByOrigin.bga })}
                  </p>
                )}
                {tournament.status === 'ongoing' && tournament.poolsByOrigin?.bga === 0 && (
                  <p className="text-xs text-accent2">{t('tournaments.bgaZeroWarning')}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Link to={`/tournament/t/${id}/edit`} className={btn}>{t('tournaments.edit')}</Link>
                  {tournament.cancelledAt
                    ? <button onClick={() => act('restore')} disabled={busy} className={btn}>{t('tournaments.restore')}</button>
                    : <button onClick={() => act('cancel')} disabled={busy} className={`${btn} hover:bg-red-900`}>{t('tournaments.cancel')}</button>}
                  {tournament.endedAt
                    ? <button onClick={() => act('reopen')} disabled={busy} className={btn}>{t('tournaments.reopen')}</button>
                    : <button onClick={() => act('close')} disabled={busy} className={btn}>{t('tournaments.close')}</button>}
                  <button onClick={handleDelete} disabled={busy || (tournament.poolCount ?? 0) > 0}
                    title={(tournament.poolCount ?? 0) > 0 ? t('tournaments.deleteBlocked') : undefined}
                    className={`${btn} hover:bg-red-900`}>{t('tournaments.delete')}</button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 4: Create `src/pages/TournamentPoolPage.jsx`**

```jsx
import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { fetchTournamentPool } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TournamentPoolView from '../components/TournamentPoolView.jsx'

// A player's pool for a declared tournament. TournamentPoolView shows the pool's
// tournamentName (the altered-draft name) as the title.
export default function TournamentPoolPage() {
  const { id } = useParams()
  const { t } = useLang()
  const load = useCallback(() => fetchTournamentPool(id), [id])
  return (
    <TournamentPoolView
      title={t('tournamentPages.boundDetailTitle')}
      load={load}
      reset={null}
      backTo={{ to: `/tournament/t/${id}`, label: t('tournaments.backToTournament') }}
    />
  )
}
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: success (remove the Task 16 placeholders if you created them).

- [ ] **Step 6: Manual check in `make dev`**

1. Logged out, open `/tournament/t/<id>` of the "Test cup" from Task 16: header, dates in your timezone, summary line, step 2 shows "Connect to prepare your pool"; no organizer panel.
2. Log in as `alice` (the organizer): organizer panel appears with "0 from this site · 0 created by BGA games", Delete enabled.
3. Click "Open my pool" → redirected to `/tournament/t/<id>/pool`: the pack reveal shows 7 boosters + the guaranteed unique; the title is "Test cup"; the back link returns to the tournament page where step 2 is ticked and the panel reads "1 from this site"; Delete is now disabled with the tooltip.
4. Log in as `bob` in another browser → "Open my pool" → a different pool; `alice`'s page shows "2 pools prepared".
5. As `alice`: Edit → the Cards/Settings sections and the BGA link are disabled with the locked notice; renaming works. Cancel → status pill "Cancelled", step 2 for a third account shows "Pool creation is closed"; the organizer panel and Edit are still available while cancelled (rename works); Restore brings it back.
6. BGA path: `curl -s "http://localhost:8080/api/tournament-bga-decklist?tournamentId=123456&tournamentName=X&gameId=g1" -H "Authorization: Bearer $TOKEN_OF_CAROL"` (a third account, no pool yet) → one `hydra:member` named "Random Test cup"; the organizer panel now shows "1 created by BGA games"; carol's `/tournament` "My tournaments" lists "Test cup".

- [ ] **Step 7: Commit**

```bash
git add src/components/TournamentBits.jsx src/components/TournamentChecklist.jsx src/pages/TournamentDetail.jsx src/pages/TournamentPoolPage.jsx
git commit -m "Add the tournament page with its 3-step checklist, organizer panel and pool page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 18: Rework `TournamentMenu` — public lists, "My tournaments", generic prep at the bottom

**Files:**
- Modify: `src/pages/TournamentMenu.jsx` (full rewrite)

**Interfaces:**
- Consumes: `listTournaments`, `fetchBoundPools` (12 + existing), `StatusPill`/`formatDateTime`/`summarizeConfig` (17), i18n (15 + existing `tournamentPages.*`).

> No component test harness; verified by build + Step 3.

- [ ] **Step 1: Rewrite `src/pages/TournamentMenu.jsx`**

```jsx
import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { fetchBoundPools, listTournaments } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'
import { StatusPill, formatDateTime, summarizeConfig } from '../components/TournamentBits.jsx'

const BGA_TOURNAMENT_LIST_URL = 'https://boardgamearena.com/tournamentlist?d&type=&players_per_match_min=0&players_per_match_max=0&status=future&gamecateg=3&game=1909&full=true&tournament_i_registered=0&time=0&prestige=0&order=recommended'

function TournamentCard({ tn, t, tc }) {
  const v = tn.viewer
  return (
    <Link to={`/tournament/t/${tn.id}`}
      className="block bg-surface border border-line hover:border-accent/60 rounded-lg px-4 py-3 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-semibold">{tn.name}</p>
        <StatusPill status={tn.status} t={t} />
        {v?.hasPool && <span className="text-xs text-green-400">✓ {t('tournaments.youHavePool')}</span>}
      </div>
      <p className="text-sm text-ink2">{t('tournaments.startsAt', { date: formatDateTime(tn.startsAt) })}</p>
      <p className="text-xs text-muted">{summarizeConfig(tn.config, t, tc)}</p>
      <p className="text-xs text-faint">
        {t('tournaments.organizedBy', { name: tn.organizer.name })} · {tc('tournaments.poolsPrepared', tn.poolCount ?? 0)}
        {v?.deck ? ` · ${t('tournaments.yourDeck', { name: v.deck.name, n: v.deck.cardQuantity ?? 0 })}` : ''}
      </p>
    </Link>
  )
}

// /tournament — the tournaments hub (spec §8): public upcoming/ongoing lists, creation,
// the player's own tournaments, and the legacy generic preparation flow at the bottom.
export default function TournamentMenu() {
  const navigate = useNavigate()
  const { user, login, loading: authLoading } = useAuth()
  const { t, tc } = useLang()
  const [tournaments, setTournaments] = useState(null)
  const [listError, setListError] = useState('')
  const [pools, setPools] = useState(null)
  const [error, setError] = useState('')

  // Public list; re-fetched when the session changes so the viewer flags appear.
  useEffect(() => {
    if (authLoading) return
    listTournaments('open')
      .then(data => setTournaments(data.tournaments))
      .catch(e => setListError(e.message || t('tournaments.couldNotLoad')))
  }, [user, authLoading, t])

  useEffect(() => {
    if (!user) return
    fetchBoundPools()
      .then(data => setPools(data.pools))
      .catch(e => setError(e.message || t('tournamentPages.couldNotLoadTournaments')))
  }, [user, t])

  const upcoming = tournaments?.filter(tn => tn.status === 'upcoming') ?? []
  const ongoing = tournaments?.filter(tn => tn.status === 'ongoing') ?? []

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1 space-y-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-display">{t('tournamentPages.menuTitle')}</h1>
          <button onClick={() => user ? navigate('/tournament/new') : login('/tournament/new')}
            className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors text-sm">
            {t('tournaments.createButton')}
          </button>
        </div>

        <div className="bg-surface2 border border-line rounded-lg p-3 text-sm text-muted">
          <p>
            {t('tournamentPages.registerNoticePrefix')}{' '}
            <a href={BGA_TOURNAMENT_LIST_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              {t('tournamentPages.registerNoticeLinkLabel')}
            </a>
          </p>
          <p className="mt-1">{t('tournamentPages.registerNoticeSchedule')}</p>
        </div>

        <section className="space-y-2">
          <h2 className="font-semibold text-lg">{t('tournaments.upcomingTitle')}</h2>
          {listError && <p className="text-red-400 text-sm">{listError}</p>}
          {!tournaments && !listError && <p className="text-muted text-sm">{t('tournaments.loading')}</p>}
          {tournaments && upcoming.length === 0 && <p className="text-muted text-sm">{t('tournaments.noUpcoming')}</p>}
          {upcoming.map(tn => <TournamentCard key={tn.id} tn={tn} t={t} tc={tc} />)}
        </section>

        {ongoing.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-lg">{t('tournaments.ongoingTitle')}</h2>
            {ongoing.map(tn => <TournamentCard key={tn.id} tn={tn} t={t} tc={tc} />)}
          </section>
        )}

        {!user && !authLoading ? (
          <div className="bg-surface rounded-xl p-6 text-center space-y-3">
            <p className="text-muted text-sm">{t('home.bgaConnectRequired')}</p>
            <button onClick={() => login('/tournament')}
              className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors">
              {t('reunion.connect')}
            </button>
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="font-semibold text-lg">{t('tournaments.myTournamentsTitle')}</h2>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              {!pools && !error && <p className="text-muted text-sm">{t('tournamentPages.loading')}</p>}
              {pools && pools.length === 0 && <p className="text-muted text-sm">{t('tournamentPages.noOngoingTournaments')}</p>}
              {pools?.map(p => {
                const href = p.tournament ? `/tournament/t/${p.tournament.id}/pool` : `/tournament/pools/${p.id}`
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 bg-surface border border-line rounded-lg px-4 py-3">
                    <div>
                      <p className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                        {p.tournamentName || t('tournamentPages.sealedPoolFallback', { set: p.setCode })}
                        {p.tournament && <StatusPill status={p.tournament.status} t={t} />}
                      </p>
                      <p className="text-xs text-faint">
                        {p.tournament
                          ? t('tournaments.startsAt', { date: formatDateTime(p.tournament.startsAt) })
                          : t('tournamentPages.boundAt', { date: p.boundAt ? new Date(p.boundAt).toLocaleString() : '—' })}
                        {p.deck ? ` · ${p.deck.name} · ${tc('tournamentPages.cardsInDeck', p.deck.cardQuantity ?? 0)}` : ` · ${t('tournamentPages.noDeckStartedYet')}`}
                      </p>
                    </div>
                    <Link to={href} className="shrink-0 text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 transition-colors">
                      {t('tournamentPages.changeMyDeck')}
                    </Link>
                  </div>
                )
              })}
            </section>

            <section className="border-t border-line pt-5 space-y-2">
              <h2 className="font-semibold text-sm text-ink2">{t('tournaments.genericPrepTitle')}</h2>
              <p className="text-xs text-faint">{t('tournaments.genericPrepHint')}</p>
              <button onClick={() => navigate('/tournament/prep')}
                className="text-sm px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface3 text-ink transition-colors">
                {t('tournamentPages.prepareNext')}
              </button>
            </section>
          </>
        )}
      </div>
      <Footer />
    </div>
  )
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Manual check in `make dev`**

1. Logged out: `/tournament` shows "Upcoming tournaments" with the "Test cup" card (status pill, start in local time, summary, organizer, pool count), the Create button sends to login, the "My tournaments" block is replaced by the Connect box.
2. As `alice`: the card shows "✓ Your pool is ready"; "My tournaments" lists "Test cup" with its pill and the "Change my deck" link going to `/tournament/t/<id>/pool`; the legacy "Prepare my next tournament" button sits at the bottom in a small block.
3. Edit the tournament's start to yesterday (as organizer) → it moves to the "Ongoing tournaments" section.

- [ ] **Step 4: Commit**

```bash
git add src/pages/TournamentMenu.jsx
git commit -m "Rework the tournaments menu around declared tournaments

Public upcoming/ongoing lists, creation entry point, the player's own
tournaments with the declared tournament's status, and the generic
preparation flow kept as a small block at the bottom.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 19: Env, docs, testing checklist

**Files:**
- Modify: `.env.example`, `docs/tournaments/README.md`, `CLAUDE.md`, `ROADMAP.md`, `TESTING.md`

- [ ] **Step 1: `.env.example`**

Append:

```bash
# User-created tournaments (docs/tournaments/user-tournaments-spec.md §9). Both optional.
# Moderators can edit/cancel/delete any tournament and have no creation limit.
# A Keycloak realm role name, read from the access token's realm_access.roles:
TOURNAMENT_MODERATOR_ROLE=
# ...and/or a comma-separated allowlist of Keycloak subs:
TOURNAMENT_MODERATORS=
```

- [ ] **Step 2: `docs/tournaments/README.md`**

Add a section `## 15. User-created tournaments (lot 1)` before the Glossary that: links `user-tournaments-spec.md` and this plan; summarizes the new resolution order of `bindTournamentId` (registered pool → registry → legacy pending); lists the new endpoints and routes (copy the two tables of spec §7/§8); states that pools created after the migration store `cards`/`boosters` and that `scripts/freeze-sealed-pools.mjs` (`make db-freeze-pools`) stores the older ones; and updates §7's table list with `tournaments` + the new `sealed_pools` columns. Also fix §2.2's route table to mention the new `/tournament/new`, `/tournament/t/:id`, `/tournament/t/:id/edit`, `/tournament/t/:id/pool` rows.

- [ ] **Step 3: `CLAUDE.md`**

In the "Database & Realtime" section (or right after "Re:Union authentication"), add a paragraph:

> **User-created tournaments (lot 1 shipped):** `tournaments` table + `sealed_pools.tournament_ref/config/cards/boosters/created_by` (`sealed-pools-schema.sql`). Pools are STORED at creation (`src/lib/poolBuilder.js` is the single generation entry point; legacy rows regenerate via `regeneratePool` until `scripts/freeze-sealed-pools.mjs` stores them). BGA resolution order in `poolStore.bindTournamentId`: `(sub, tournament_id)` → declared tournament by BGA id (`getOrCreateTournamentPool`, adopts a legacy row bound earlier) → legacy pending pool. Organizers = any logged-in account (10 open max); moderators via `TOURNAMENT_MODERATOR_ROLE` / `TOURNAMENT_MODERATORS`. Spec: `docs/tournaments/user-tournaments-spec.md`. Lot 2 (cubes, multi-set, live uniques through a shared Lobby "Cards" step) and lot 3 (Home block, polish) are next.

- [ ] **Step 4: `ROADMAP.md`**

Under "Now — active priorities", add item `2. User-created sealed tournaments` with a 3-line status (lot 1 shipped / lot 2 / lot 3) and the two open verifications (BGA parent id on a multi-stage tournament; moderator realm role from Re:Union).

- [ ] **Step 5: `TESTING.md`**

Append a section `## N. User-created tournaments (lot 1)` with the manual steps of Tasks 16 §4, 17 §6 and 18 §3 as checkboxes, plus:

```
- [ ] Deploy: `sealed-pools-schema.sql` applied on the target DB (Supabase SQL editor / AlteredOps migration), then `node --env-file=.env scripts/freeze-sealed-pools.mjs` once; the log reports `frozen N/N pools (0 failed)`.
- [ ] A legacy bound pool (created before the deploy) still opens from "My tournaments" and its deck validates on BGA (pool contents unchanged after freezing).
- [ ] **Verify with Re:Union on a real multi-stage BGA tournament** that the public URL's `id` equals the `tournamentParentId` altered-bga-api forwards (organizer panel: "created by BGA games" > 0 after round 1).
```

- [ ] **Step 6: Commit**

```bash
git add .env.example docs/tournaments/README.md CLAUDE.md ROADMAP.md TESTING.md
git commit -m "Document user-created tournaments (lot 1): env, feature README, project notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review (done while writing; kept for the executor)

**Spec coverage → tasks**

| Spec | Task(s) |
| --- | --- |
| §2 decisions (anyone creates, 10 cap, moderators, stored pools, no lang, tournament knobs, lifecycle, creation window, mandatory unique link, public list, pool count, soft cancel, checklist, generic prep kept, name authority, config lock, future start) | 1, 2, 5, 7, 8, 9, 16, 17, 18 |
| §3.2 lifecycle table | 6 (`listTournaments`, actions), 9 (PATCH actions, DELETE, pool creation window) |
| §3.3 player journey, §3.4 organizer journey | 17, 18, 16 |
| §4 data model | 4 |
| §5.1 config, §5.2 `buildPool` / `loadPool` / generate-then-insert | 2, 3, 4, 5 |
| §6 binding order, adoption, races | 7 |
| §7 endpoints | 9, 10 |
| §8 routes/pages, `SettingsFields.showLang`, `SetPresetGrid`, i18n | 13, 14, 15, 16, 17, 18 |
| §9 auth, limits, validation | 1, 2, 8, 9 |
| §10 migration, freeze script, env, mounts, docs | 4, 9, 11, 19 |
| §12 risk mitigations: form hint + "pools created by BGA" indicator | 15, 17 |

**Review Focus → tests**: 1 → `bgaUrl.test.js` (Task 1); 2 → `tournamentRules.test.js` patch cases (Task 1); 3 → "absorbs concurrent creations" (Task 7); 4 → "adopts a legacy pool" (Task 7); 5 → "a stale bearer on the public list" (Task 9).

**Type consistency checks**: `buildPool(sub, { config, nonce }, { fetchCards })` is called that way in Tasks 3, 4, 5; `loadPool(sub, row) → { counts, boosters }` in 4, 9; `poolResponse(row, counts, boosters, gamesPlayed, { tournament })` in 4, 9; `toTournamentJson(row, extras)` in 6, 9; `getOrCreateTournamentPool(sub, tournamentRow, { createdBy })` in 7, 9, tests; `verifyUser → { sub, name, roles, isModerator }` in 8, 9; `validateTournamentFields(body, { now, isCreate, current })` in 1, 9, 16; `validateTournamentConfig(input) → { ok, errors, config }` in 2, 9, 16; the i18n keys used in 14, 16, 17, 18 all exist in 15.

**Known deliberate gaps**: no component tests (the repo has no DOM harness); frontend tasks rely on `npm run build` + the manual checklists, consolidated in `TESTING.md` (Task 19). The Vercel nested dynamic route `api/tournaments/[id]/pool.js` is standard Vercel routing but is only exercised by the Express tests here — check it once on a Vercel preview.
