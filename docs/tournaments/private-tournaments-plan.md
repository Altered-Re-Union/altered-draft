# Private tournaments and the share box (V4) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer declare a tournament as private (listed only to its organizer, the players who have a pool on it and the moderators; reachable by its link and through BGA exactly as a public one), and give every tournament page a share box (link, copy, native share sheet, locally generated QR code), the Lobby's QR code moving to the same local component.

**Architecture:** One nullable-free column `tournaments.visibility` validated with the other fields in `tournamentRules.js`; one listing rule written once in SQL (`listTournaments(status, viewer)`) and once as a pure helper (`canSeeTournament`) for the single-item `?bgaId=` lookup, which is redacted instead of filtered; a `PrivateBadge` pill rendered after the status pill wherever a tournament card or header is drawn; a `ShareBox` component on the tournament page built on a pure `qrSvgPath` (dark modules as one SVG path, `qrcode-generator`) and small `share.js` helpers (copy, native share) extracted from `ExportMenu`.

**Tech Stack:** Node 22, Express 5 (same handler modules as the Vercel layout), `pg`, React 18 + react-router 6 + Tailwind semantic tokens, `qrcode-generator` 2.0.4 (new, MIT, no transitive dependency), vitest (`npm test`, `npm run test:integration` against Docker Postgres), Playwright (`make e2e`, fakes + card fixtures CYCLONE / EOLE / FUGUE).

**Spec:** `docs/tournaments/user-tournaments-spec.md` §14 (design, decisions, listing rule, API, pages, tests, non-goals). Read §14 first; §2, §3.2, §7 and §13 give the model it extends. V3's PR (#26, `feat/multiset-sealed`) and its plan `multiset-sealed-plan.md` are the pattern: same files, same test layers, same recette conventions.

## Global Constraints

- Branch `feat/private-tournaments`, created from `feat/multiset-sealed` (PR #26, a draft stacked on #25), checked out in its own git worktree at `/Users/alexandrewavelet/Perso/altered-reunion/altered-draft-private-tournaments` (another session works in the main checkout; never touch it). The PR is based on `feat/multiset-sealed` and retargeted to `main` as the stack merges. Never rebase: update with merge commits.
- Scope: declared tournaments and the share box only. No change to the pools, to `current_format`, to the legacy pools, to the BGA-facing contracts (`/api/tournament-bga-decklist`, `/api/tournament-pool*`), nor to `/api/tournaments/:id/pool`.
- "Private" is listing only (spec §14, first paragraph): the detail endpoint, the pool creation and the BGA path never look at `visibility`.
- `visibility` is `'public'` or `'private'`, default `'public'`, editable like `name` (every status but detached, never locked by pools).
- The QR code is generated locally; after Task 8 no code requests `api.qrserver.com`, and the e2e network rules treat a request there as a leak. The QR tile is always black modules on a white tile (`#000` / `#fff`), the one deliberate exception to the semantic-tokens rule.
- UI copy in both `src/lib/i18n/en.js` and `fr.js`, under `tournaments.*`; semantic Tailwind tokens only elsewhere (`surface*`, `ink*`, `muted`, `faint`, `line`, `accent*`, `ok`, `danger`), never raw `gray-*` / `green-*` / `red-*`.
- Docs travel with the code: `docs/tournaments/README.md` **and** `docs/tournaments/index.html`, `CLAUDE.md`, the spec (Task 11 gathers the doc pass; no doc may be stale at merge time).
- Recette conventions (`docs/tournaments/acceptance-multiset-sealed.html` is the template): every step that runs something carries its full copy-paste command, URLs quoted, no `!` inside double-quoted shell strings, checked with `zsh -n`; new steps start unchecked; ids are `pv-<group>-<slug>` and must not exist in another page; BGA ids 123500–123509.
- Code, comments, commit messages in English. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit only the files each task touches.
- Node ESM: JSON imports need `with { type: 'json' }`; `pg` jsonb parameters are `JSON.stringify`ed. Adding the dependency: `nvm use` first (Node 22's npm wrote `package-lock.json`; another npm rewrites it), then `npm install --save-exact qrcode-generator@2.0.4`, and check the lockfile diff only adds that package.

## Review Focus

Inputs the spec implies that a user will hit; each one gets a test in the task that owns the code.

1. **A private tournament whose only pools were minted by BGA calls** (`created_by = 'bga'`, the player never opened altered-draft) — those players still see it in Upcoming / Ongoing / My pools. → Task 2 (`bgaholder` in the list matrix).
2. **A stranger pastes the BGA link of a private tournament in the form** — refused ("A tournament already exists…") without leaking the name; the organizer editing that same tournament is not blocked by their own link. → Tasks 2, 10 (`@pv-e-dup`).
3. **Changing the visibility of a tournament that already has pools, or a cancelled one** — accepted (200), never 409 `tournament_locked`; a detached one answers 409 `tournament_detached`. → Task 2.
4. **Copy when the clipboard is refused** (permission denied, insecure context, `execCommand` unavailable) — no error, no stuck label: the URL text is selected so the user copies by hand. → Tasks 7, 10 (`@pv-g-copy-fallback`).
5. **The QR code in dark theme** — still black on white, hence scannable; a dark page must not invert it. → Tasks 6, 10 (`@pv-g-share`).

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/qr.js` (+ `.test.js`) | `qrSvgPath(text, { level })`: the QR modules of a string as one SVG path, pure. |
| `src/components/QrCode.jsx` | Renders `qrSvgPath` as an `<svg>` (white tile, black modules, quiet zone). |
| `src/lib/share.js` (+ `.test.js`) | `copyText` (moved from `ExportMenu.jsx`), `canNativeShare`, `nativeShare`, `tournamentShareUrl`. |
| `src/components/ShareBox.jsx` | The share box of the tournament page (URL, Copy, Share…, QR). |
| `tests/e2e/specs/private-tournaments.spec.js` | Playwright replay of the V4 acceptance steps. |
| `docs/tournaments/acceptance-private-tournaments.html` | The V4 recette page (`pv-` ids). |

**Modified**

| File | Change |
| --- | --- |
| `sealed-pools-schema.sql` | `tournaments.visibility` (idempotent `add column if not exists`, default `public`, check). |
| `src/lib/tournamentRules.js` (+ `.test.js`) | `VISIBILITIES`, `visibility` in `validateTournamentFields`, `canSeeTournament`. |
| `src/lib/tournamentStore.js` | `createTournament({ visibility })`, `listTournaments(status, viewer)`, `COLUMN_OF.visibility`, `toTournamentJson.visibility`. |
| `src/lib/poolStore.js` | `listBoundTournamentPools` selects `t.visibility`. |
| `api/tournaments/index.js` | Filtered list, `visibility` on POST, redacted `?bgaId=` item. |
| `api/tournament-bound-pools.js` | `tournament.visibility`. |
| `tests/integration/tournaments.test.js` | The V4 describe (schema, matrix, POST / PATCH, redaction, bound pools). |
| `src/lib/tournamentForm.js` (+ `.test.js`) | `visibility` in `FIELD_ORDER`. |
| `src/lib/i18n/en.js`, `fr.js` | The 15 `tournaments.*` keys of spec §14.2. |
| `src/pages/TournamentForm.jsx` | The radio group, state, draft, prefill, body. |
| `src/components/TournamentBits.jsx` (+ `.test.js`) | `PrivateBadge`. |
| `src/pages/TournamentMenu.jsx`, `src/pages/TournamentDetail.jsx` | Badge on every card and in the header; the share box. |
| `src/components/ExportMenu.jsx` | Imports `copyText` from `share.js`. |
| `src/pages/Lobby.jsx` | `<QrCode>` instead of the `api.qrserver.com` image. |
| `tests/e2e/support/network.js` | The `api.qrserver.com` exception removed. |
| `tests/e2e/support/api.js` | `privateTournamentBody()`. |
| `scripts/e2e-acceptance-coverage.mjs` | Fourth page in `ACCEPTANCE_PAGES`. |
| `package.json`, `package-lock.json` | `qrcode-generator` 2.0.4. |
| `docs/tournaments/README.md`, `index.html`, `CLAUDE.md`, `user-tournaments-spec.md` | §14.9, the V4 sentences, cross-checks. |

---

### Task 1: The `visibility` column and rule

**Files:**
- Modify: `sealed-pools-schema.sql` (append after the V2 `alter column set_code drop not null` line)
- Modify: `src/lib/tournamentRules.js`
- Test: `src/lib/tournamentRules.test.js`

**Interfaces:**
- Produces: `export const VISIBILITIES = ['public', 'private']`; `validateTournamentFields(body, opts)` returns `values.visibility` (`'public'` when absent on create; the given value when valid; error `visibility: 'invalid_visibility'` otherwise, including a present-but-null value on a patch; untouched on a patch when the key is absent); `export function canSeeTournament(row, viewer, { hasPool = false } = {}) → boolean` over a DB row (`visibility`, `organizer_sub`; `visibility` absent = public) and `viewer = { sub, isModerator } | null`.

- [ ] **Step 1: Write the failing tests** in `tournamentRules.test.js` (import `canSeeTournament` too):

```js
describe('validateTournamentFields (visibility)', () => {
  const good = { name: 'Winter Cup', description: 'd', startsAt: later, endsAt: null, bgaUrl: 'https://boardgamearena.com/tournament?id=7' }
  it('defaults to public on create and accepts both values', () => {
    expect(validateTournamentFields(good, { now: NOW, isCreate: true }).values.visibility).toBe('public')
    expect(validateTournamentFields({ ...good, visibility: 'private' }, { now: NOW, isCreate: true }).values.visibility).toBe('private')
    expect(validateTournamentFields({ visibility: 'public' }).values).toEqual({ visibility: 'public' })
  })
  it('rejects anything else; a patch validates it only when present', () => {
    for (const v of ['hidden', 'PRIVATE', 1, {}]) {
      expect(validateTournamentFields({ ...good, visibility: v }, { now: NOW, isCreate: true }).errors.visibility, String(v)).toBe('invalid_visibility')
    }
    expect(validateTournamentFields({ visibility: null }).errors).toEqual({ visibility: 'invalid_visibility' })
    expect(validateTournamentFields({ name: 'Winter Cup' })).toMatchObject({ ok: true, values: { name: 'Winter Cup' } })
    expect(validateTournamentFields({ name: 'Winter Cup' }).values).not.toHaveProperty('visibility')
  })
})

describe('canSeeTournament', () => {
  const pub = { visibility: 'public', organizer_sub: 'org' }
  const priv = { visibility: 'private', organizer_sub: 'org' }
  it('public for everyone; private for the organizer, a pool holder and a moderator only', () => {
    expect(canSeeTournament(pub, null)).toBe(true)
    expect(canSeeTournament({ organizer_sub: 'org' }, null)).toBe(true)
    expect(canSeeTournament(priv, null)).toBe(false)
    expect(canSeeTournament(priv, { sub: 'x', isModerator: false })).toBe(false)
    expect(canSeeTournament(priv, { sub: 'org', isModerator: false })).toBe(true)
    expect(canSeeTournament(priv, { sub: 'x', isModerator: false }, { hasPool: true })).toBe(true)
    expect(canSeeTournament(priv, { sub: 'x', isModerator: true })).toBe(true)
  })
})
```

Also update the existing `normalizes a valid payload` test: its `toEqual` on `r.values` now needs `visibility: 'public'`.

- [ ] **Step 2: Run them to see them fail** — `npm test -- tournamentRules` → `canSeeTournament` is not exported; `values.visibility` is undefined.

- [ ] **Step 3: Implement** — in `tournamentRules.js`: `VISIBILITIES`; in `validateTournamentFields`, after the `description` block: `if (isCreate || has('visibility'))` → absent / `null` / `''` on create ⇒ `values.visibility = 'public'`, absent-but-present-null on a patch ⇒ `errors.visibility = 'invalid_visibility'`, a value not in `VISIBILITIES` ⇒ the same error, else `values.visibility = value`; `canSeeTournament` = `row.visibility !== 'private' || (!!viewer && (!!viewer.isModerator || viewer.sub === row.organizer_sub || hasPool))`. In `sealed-pools-schema.sql`:

```sql
-- V4 (private tournaments): listing-only visibility; every existing row is public.
alter table tournaments add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'private'));
```

- [ ] **Step 4: Run the unit suite** — `npm test -- tournamentRules` → all pass.

- [ ] **Step 5: Commit**

```bash
git add sealed-pools-schema.sql src/lib/tournamentRules.js src/lib/tournamentRules.test.js
git commit -m "Tournaments: visibility column and the can-see rule"
```

---

### Task 2: Store, list and detail handlers, bound pools

**Files:**
- Modify: `src/lib/tournamentStore.js`, `src/lib/poolStore.js` (`listBoundTournamentPools`), `api/tournaments/index.js`, `api/tournament-bound-pools.js`
- Test: `tests/integration/tournaments.test.js`

**Interfaces:**
- Consumes: `canSeeTournament`, `VISIBILITIES` (Task 1).
- Produces: `createTournament({ …, visibility = 'public' })` (the INSERT's 10th column); `listTournaments(status = 'open', viewer = null)` with the spec §14.3 WHERE (`$1 = viewer?.sub ?? null`, `$2 = !!viewer?.isModerator`, `FROM tournaments t`); `COLUMN_OF.visibility = 'visibility'` (so the existing PATCH path in `api/tournaments/[id].js` stores it with no change there); `toTournamentJson(row).visibility` (`row.visibility ?? 'public'`); `listBoundTournamentPools` rows carry `t_visibility`; the bound-pools JSON `tournament.visibility` (`'public'` when null). In `api/tournaments/index.js`: GET passes `user && { sub: user.sub, isModerator: user.isModerator }` to `listTournaments`; POST passes `fields.values.visibility`; the `?bgaId=` item is `toTournamentJson(…)` when `canSeeTournament(row, user, { hasPool: !!mine[row.id] })`, else exactly `{ visibility: 'private' }`.

- [ ] **Step 1: Write the failing tests** — a new `describe('private tournaments (V4)')` at the end of the file. `mkTournament` passes `...over` to `createTournament`, so `visibility` flows through it. Local helpers: `const bga = id => \`https://boardgamearena.com/tournament?id=${id}\``, `const postBody = { name: 'Winter Cup', description: 'Be there', startsAt: inDays(3).toISOString(), endsAt: null, config: CONFIG }`.

```js
it('the schema adds visibility, public by default, checked', async () => {
  const { rows } = await query("SELECT column_default, is_nullable FROM information_schema.columns WHERE table_name = 'tournaments' AND column_name = 'visibility'")
  expect(rows[0].is_nullable).toBe('NO')
  expect(rows[0].column_default).toContain('public')
  const t = await mkTournament()
  expect(t.visibility).toBe('public')
  await expect(query("UPDATE tournaments SET visibility = 'hidden' WHERE id = $1", [t.id])).rejects.toMatchObject({ code: '23514' })
})

it('lists a private tournament to its organizer, a pool holder (page or BGA) and a moderator, to nobody else', async () => {
  const priv = await mkTournament({ visibility: 'private' })
  const pub = await mkTournament()
  await getOrCreateTournamentPool('holder', priv, { createdBy: 'page' })
  await getOrCreateTournamentPool('bgaholder', priv, { createdBy: 'bga' })
  const ids = async viewer => (await listTournaments('open', viewer)).map(r => r.id).sort()
  expect(await ids(null)).toEqual([pub.id])
  expect(await ids({ sub: 'stranger', isModerator: false })).toEqual([pub.id])
  for (const viewer of [{ sub: 'org', isModerator: false }, { sub: 'holder', isModerator: false }, { sub: 'bgaholder', isModerator: false }, { sub: 'mod', isModerator: true }]) {
    expect(await ids(viewer), viewer.sub).toEqual([priv.id, pub.id].sort())
  }
  expect((await listTournaments('upcoming', { sub: 'org', isModerator: false })).map(r => r.visibility)).toContain('private')
})

it('GET /api/tournaments filters by the caller; POST defaults to public and refuses other values', async () => {
  const priv = await mkTournament({ visibility: 'private' })
  verifyUser.mockResolvedValue(null)
  expect((await call(tournamentsIndex, { method: 'GET', auth: false })).body.tournaments).toEqual([])
  asUser(ALICE)
  expect((await call(tournamentsIndex, { method: 'GET' })).body.tournaments).toEqual([])
  asUser(MOD)
  expect((await call(tournamentsIndex, { method: 'GET' })).body.tournaments.map(t => [t.id, t.visibility])).toEqual([[priv.id, 'private']])
  asUser(ALICE)
  expect((await call(tournamentsIndex, { method: 'POST', body: { ...postBody, bgaUrl: bga('9101') } })).body.visibility).toBe('public')
  const created = await call(tournamentsIndex, { method: 'POST', body: { ...postBody, bgaUrl: bga('9102'), visibility: 'private' } })
  expect(created.statusCode).toBe(201)
  expect(created.body.visibility).toBe('private')
  expect((await call(tournamentsIndex, { method: 'GET', query: { mine: '1' } })).body.tournaments.map(t => t.visibility).sort()).toEqual(['private', 'public'])
  const bad = await call(tournamentsIndex, { method: 'POST', body: { ...postBody, bgaUrl: bga('9103'), visibility: 'hidden' } })
  expect(bad.statusCode).toBe(400)
  expect(bad.body.fields).toEqual({ visibility: 'invalid_visibility' })
})

it('PATCH visibility works whatever the status and on a locked tournament, not on a detached one', async () => {
  const t = await mkTournament({ organizerSub: 'alice' })
  await getOrCreateTournamentPool('bob', t)
  asUser(ALICE)
  const toPrivate = await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { visibility: 'private' } })
  expect(toPrivate.statusCode).toBe(200)
  expect(toPrivate.body).toMatchObject({ visibility: 'private', locked: true })
  expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'cancel', visibility: 'public' } })).body).toMatchObject({ visibility: 'public', status: 'cancelled' })
  expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { visibility: 'nope' } })).statusCode).toBe(400)
  expect((await call(tournamentsItem, { method: 'GET', query: { id: t.id } })).body.visibility).toBe('public')
  asUser(MOD)
  expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { action: 'detach' } })).statusCode).toBe(200)
  expect((await call(tournamentsItem, { method: 'PATCH', query: { id: t.id }, body: { visibility: 'private' } })).body).toEqual({ error: 'tournament_detached' })
})

it('?bgaId= redacts a private declaration the caller may not see', async () => {
  const priv = await mkTournament({ visibility: 'private', bgaTournamentId: '777', organizerSub: 'alice' })
  const lookup = () => call(tournamentsIndex, { method: 'GET', query: { bgaId: '777' } })
  verifyUser.mockResolvedValue(null)
  const anon = await call(tournamentsIndex, { method: 'GET', query: { bgaId: '777' }, auth: false })
  expect(anon.body).toEqual({ tournaments: [{ visibility: 'private' }], legacy: null })
  asUser({ ...ALICE, sub: 'stranger' })
  expect((await lookup()).body.tournaments).toEqual([{ visibility: 'private' }])
  asUser(ALICE)
  expect((await lookup()).body.tournaments[0]).toMatchObject({ id: priv.id, name: 'Winter Cup', visibility: 'private', viewer: { isOrganizer: true } })
  await getOrCreateTournamentPool('holder', priv)
  asUser({ ...ALICE, sub: 'holder' })
  expect((await lookup()).body.tournaments[0]).toMatchObject({ id: priv.id, viewer: { hasPool: true } })
  asUser(MOD)
  expect((await lookup()).body.tournaments[0].id).toBe(priv.id)
  const pub = await mkTournament({ bgaTournamentId: '778' })
  verifyUser.mockResolvedValue(null)
  expect((await call(tournamentsIndex, { method: 'GET', query: { bgaId: '778' }, auth: false })).body.tournaments[0].id).toBe(pub.id)
})

it('bound pools carry the tournament visibility', async () => {
  const priv = await mkTournament({ visibility: 'private' })
  await getOrCreateTournamentPool('alice', priv)
  const { verifySub } = await import('../../api/_lib/auth.js')
  verifySub.mockResolvedValue('alice')
  const res = await call(boundPools)
  expect(res.body.pools[0].tournament).toMatchObject({ id: priv.id, visibility: 'private' })
})
```

Also extend the existing `schema` test's column list check with a second query asserting `visibility` exists on `tournaments`.

- [ ] **Step 2: Run them to see them fail** — `npm run test:integration -- -t "private tournaments"` → the column is there (Task 1), the rest fails on `visibility` undefined / unfiltered lists / full `?bgaId=` items.

- [ ] **Step 3: Implement** the Interfaces above. In `listTournaments`, keep `OPEN_SQL` as is (unqualified columns resolve to `t`; the EXISTS subquery only names `p.*` and `t.id`). In the GET handler, compute `viewer` once and reuse `user` for the redaction (`mine` is already fetched for the caller).

- [ ] **Step 4: Run the whole integration suite** — `npm run test:integration` → all pass (the older list tests only create public rows).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournamentStore.js src/lib/poolStore.js api/tournaments/index.js api/tournament-bound-pools.js tests/integration/tournaments.test.js
git commit -m "Tournaments: private visibility in the lists, the duplicate-link lookup and bound pools"
```

---

### Task 3: i18n keys and the form issue order

**Files:**
- Modify: `src/lib/i18n/en.js`, `src/lib/i18n/fr.js` (the `tournaments` namespace), `src/lib/tournamentForm.js`
- Test: `src/lib/tournamentForm.test.js`

**Interfaces:**
- Produces: the keys below; `FIELD_ORDER` = `['name', 'description', 'visibility', 'bgaUrl', …]`.

EN:

```js
visibilityLabel: 'Visibility',
visibilityPublic: 'Public',
visibilityPublicHint: 'Listed in Upcoming and Ongoing for everyone.',
visibilityPrivate: 'Private',
visibilityPrivateHint: 'Listed only for you, the players who have a pool and the moderators. Share its link.',
errVisibility: 'Choose Public or Private.',
privateBadge: 'Private',
privateBadgeTitle: 'Private tournament: not listed publicly',
shareTitle: 'Share this tournament',
shareHint: 'Anyone with the link can open this page and prepare a pool.',
sharePrivateHint: 'This tournament is private: its link is the only way to find it.',
shareCopy: 'Copy',
shareCopied: '✓ Copied',
shareNative: 'Share…',
shareQrAlt: 'QR code of the tournament link',
```

FR:

```js
visibilityLabel: 'Visibilité',
visibilityPublic: 'Public',
visibilityPublicHint: 'Visible par tous dans À venir et En cours.',
visibilityPrivate: 'Privé',
visibilityPrivateHint: 'Visible seulement par vous, les joueurs qui ont un pool et les modérateurs. Partagez son lien.',
errVisibility: 'Choisissez Public ou Privé.',
privateBadge: 'Privé',
privateBadgeTitle: 'Tournoi privé : absent des listes publiques',
shareTitle: 'Partager ce tournoi',
shareHint: 'Toute personne qui a le lien peut ouvrir cette page et préparer un pool.',
sharePrivateHint: 'Ce tournoi est privé : son lien est le seul moyen de le trouver.',
shareCopy: 'Copier',
shareCopied: '✓ Copié',
shareNative: 'Partager…',
shareQrAlt: 'Code QR du lien du tournoi',
```

- [ ] **Step 1: Write the failing test** in `tournamentForm.test.js`:

```js
it('reports an invalid visibility under its own field, between the description and the link', () => {
  const issues = tournamentFormIssues({ body: { ...body, description: 'x'.repeat(2001), visibility: 'hidden', bgaUrl: 'nope' }, config, now: NOW, isCreate: true })
  expect(issues).toEqual([
    { field: 'description', code: 'too_long' },
    { field: 'visibility', code: 'invalid_visibility' },
    { field: 'bgaUrl', code: 'invalid_bga_url' },
  ])
})
```

- [ ] **Step 2: Run it to see it fail** — `npm test -- tournamentForm` → `visibility` sorts last (`indexOf` = -1).
- [ ] **Step 3: Implement** — `FIELD_ORDER` + the keys (same position in both files, after `descriptionLabel`'s block for the form keys and next to the `organizerPanel` block for the badge / share keys).
- [ ] **Step 4: Run** — `npm test -- tournamentForm` → pass; `npm test` → the i18n parity test, if any, still passes.
- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/en.js src/lib/i18n/fr.js src/lib/tournamentForm.js src/lib/tournamentForm.test.js
git commit -m "i18n: private tournaments and share box strings (EN, FR)"
```

---

### Task 4: The visibility radio group in the form

**Files:**
- Modify: `src/pages/TournamentForm.jsx`

**Interfaces:**
- Consumes: the Task 3 keys.
- Produces: state `visibility` (`'public'` by default); `FIELD_DOM_ID.visibility = 'tn-visibility'`, `FIELD_LABEL_KEY.visibility = 'tournaments.visibilityLabel'`, `issueMessage` case `'visibility'` → `t('tournaments.errVisibility')`; the draft (`reconnect` + `applyDraft`, outside `withConfig`) and the edit prefill (`setVisibility(tn.visibility ?? 'public')`) carry it; `body` = `{ name, description, visibility, bgaUrl, startsAt, endsAt }`, so both the create payload and the PATCH send it. Markup, right under the description block of section 1:

```jsx
<fieldset id="tn-visibility" tabIndex={-1} className="focus:outline-none">
  <legend className="block text-sm text-muted mb-1">{t('tournaments.visibilityLabel')}</legend>
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
    {VISIBILITIES.map(v => (
      <label key={v} className={…}>
        <input type="radio" name="visibility" value={v} checked={visibility === v} data-testid={`visibility-${v}`}
          aria-describedby={`tn-visibility-${v}-hint`} onChange={() => edit('visibility', setVisibility)(v)} className="accent-accent mt-0.5" />
        <span><span className="text-sm font-medium">{t(v === 'public' ? 'tournaments.visibilityPublic' : 'tournaments.visibilityPrivate')}</span>
          <span id={`tn-visibility-${v}-hint`} className="block text-xs text-faint">{t(v === 'public' ? 'tournaments.visibilityPublicHint' : 'tournaments.visibilityPrivateHint')}</span></span>
      </label>
    ))}
  </div>
</fieldset>
```

(`VISIBILITIES` from `tournamentRules.js`; the radios are never disabled, locked or not.)

- [ ] **Step 1: Implement** the above (no unit test: the page has none; Task 10's `@pv-a-radio` and `@pv-b-create` cover it).
- [ ] **Step 2: Check by hand** — `make dev`, `/tournament/new`: Public checked by default, both hints, Private selectable; create one of each and read `visibility` on `GET /api/tournaments/:id`; edit the private one: Private preselected, the radios enabled while the config section is locked.
- [ ] **Step 3: Build** — `npm run build` → ok.
- [ ] **Step 4: Commit**

```bash
git add src/pages/TournamentForm.jsx
git commit -m "Tournament form: public or private visibility"
```

---

### Task 5: The private badge on the hub cards and the tournament page

**Files:**
- Modify: `src/components/TournamentBits.jsx`, `src/pages/TournamentMenu.jsx`, `src/pages/TournamentDetail.jsx`
- Test: `src/components/TournamentBits.test.js`

**Interfaces:**
- Produces: `export function PrivateBadge({ t })` → `<span data-testid="tournament-private" title={t('tournaments.privateBadgeTitle')} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-muted border-line bg-surface2">` with an inline padlock `<svg aria-hidden="true" viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">` and the text `t('tournaments.privateBadge')`. Rendered right **after** `<StatusPill />` (and before the "✓ Your pool is ready" text) in `TournamentCard`, in the "My pools" card (`p.tournament?.visibility === 'private'`), in the header of `TournamentDetail`; and after the name in the "My ongoing tournaments" card (which has no status pill).

- [ ] **Step 1: Write the failing test** (`react-dom/server`, no JSX in a `.test.js`):

```js
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrivateBadge } from './TournamentBits.jsx'
it('PrivateBadge: a labelled, titled pill with an aria-hidden icon', () => {
  const html = renderToStaticMarkup(createElement(PrivateBadge, { t }))
  expect(html).toContain('data-testid="tournament-private"')
  expect(html).toContain('title="tournaments.privateBadgeTitle"')
  expect(html).toContain('aria-hidden="true"')
  expect(html).toContain('tournaments.privateBadge<')
})
```

- [ ] **Step 2: Run it to see it fail** — `npm test -- TournamentBits` → `PrivateBadge` is not exported.
- [ ] **Step 3: Implement** the badge and the four call sites.
- [ ] **Step 4: Run** — `npm test -- TournamentBits` → pass; `npm run build` → ok; by hand: a private tournament shows the pill on its page and in "My created tournaments", after the status pill.
- [ ] **Step 5: Commit**

```bash
git add src/components/TournamentBits.jsx src/components/TournamentBits.test.js src/pages/TournamentMenu.jsx src/pages/TournamentDetail.jsx
git commit -m "Tournaments: private badge on the hub cards and the tournament page"
```

---

### Task 6: Local QR code — dependency, `qrSvgPath`, `QrCode`

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/lib/qr.js`, `src/lib/qr.test.js`, `src/components/QrCode.jsx`

**Interfaces:**
- Produces: `export const QR_QUIET_ZONE = 4`; `export function qrSvgPath(text, { level = 'M' } = {}) → { size, d }` where `size` = module count + 2 × `QR_QUIET_ZONE` and `d` = one `M<x> <y>h1v1h-1z` command per dark module (`x`, `y` offset by the quiet zone, auto type number: `qrcode(0, level)`), throws on an empty string; `export default function QrCode({ value, label, size = 120, className = '', testId = 'qr-code' })` → `<svg role="img" aria-label={label} data-testid={testId} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" className={`rounded-lg ${className}`}><rect width={n} height={n} fill="#fff" /><path d={d} fill="#000" /></svg>` (the path memoized on `value`).

- [ ] **Step 1: Add the dependency** — `nvm use && npm install --save-exact qrcode-generator@2.0.4`; `git diff --stat package-lock.json` shows only that package; `npm ci` still succeeds.

- [ ] **Step 2: Write the failing tests** in `qr.test.js`:

```js
const URL1 = 'https://altered-draft.altered.re/tournament/t/00000000-0000-4000-8000-000000000000'
it('is deterministic, starts with the top-left finder pattern, and grows with the text', () => {
  const a = qrSvgPath(URL1)
  expect(a).toEqual(qrSvgPath(URL1))
  expect(a.d).toContain('M4 4h1v1h-1z')
  expect(qrSvgPath('x').size).toBe(21 + 2 * QR_QUIET_ZONE)
  expect(a.size).toBeGreaterThan(qrSvgPath('x').size)
})
it('keeps every module on the grid, inside the quiet zone', () => {
  const { size, d } = qrSvgPath('hello')
  const cells = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(m => [Number(m[1]), Number(m[2])])
  expect(cells.length).toBeGreaterThan(0)
  expect(d.replace(/M\d+ \d+h1v1h-1z/g, '')).toBe('')
  for (const [x, y] of cells) {
    expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE); expect(x).toBeLessThan(size - QR_QUIET_ZONE)
    expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE); expect(y).toBeLessThan(size - QR_QUIET_ZONE)
  }
})
it('refuses an empty text', () => {
  expect(() => qrSvgPath('')).toThrow()
})
```

- [ ] **Step 3: Run them to see them fail** — `npm test -- qr` → module not found.
- [ ] **Step 4: Implement** `qr.js` (`import qrcode from 'qrcode-generator'`; `qr.addData(text); qr.make(); qr.getModuleCount(); qr.isDark(row, col)`) and `QrCode.jsx`.
- [ ] **Step 5: Run** — `npm test -- qr` → pass; `npm run build` → ok.
- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/qr.js src/lib/qr.test.js src/components/QrCode.jsx
git commit -m "QR codes generated locally with qrcode-generator"
```

---

### Task 7: Share helpers and the share box on the tournament page

**Files:**
- Create: `src/lib/share.js`, `src/lib/share.test.js`, `src/components/ShareBox.jsx`
- Modify: `src/components/ExportMenu.jsx` (imports `copyText` from `share.js`, its local copy removed), `src/pages/TournamentDetail.jsx`

**Interfaces:**
- Consumes: `QrCode` (Task 6), the Task 3 keys.
- Produces, in `share.js`: `export async function copyText(text) → Promise<boolean>` (the body moved from `ExportMenu.jsx`: clipboard API, then the `execCommand` textarea fallback; one fix on the way: the fallback returns the boolean `document.execCommand('copy')` gives back instead of `true` unconditionally, so a refused copy is reported; `false` too when `text` is empty); `export function canNativeShare() → boolean` (`typeof navigator !== 'undefined' && typeof navigator.share === 'function'`); `export async function nativeShare({ title, url }) → Promise<boolean>` (`true` when `navigator.share` resolved, `false` when unsupported or rejected, an `AbortError` included); `export function tournamentShareUrl(id, origin = window.location.origin) → string` = `${origin}/tournament/t/${id}`.
- Produces, in `ShareBox.jsx`: `export default function ShareBox({ tournament })` → `<section data-testid="share-box" aria-labelledby="share-title" className="bg-surface rounded-xl border border-line p-4">`: `<h2 id="share-title">` = `shareTitle`; the hint = `sharePrivateHint` when `tournament.visibility === 'private'` (every status), else `shareHint` only while the tournament is `upcoming` or `ongoing` (a cancelled or ended public tournament shows no hint: nobody can prepare a pool there any more); `<input readOnly data-testid="share-url" aria-label={t('tournaments.shareTitle')} value={url} onFocus={e => e.target.select()} … font-mono>`; `<button type="button" data-testid="share-copy">` whose label is `shareCopied` for 2 s after a successful copy (`bg-ok-soft text-ok` then), `shareCopy` otherwise, and which on failure calls `input.select()` and keeps the label; `<button type="button" data-testid="share-native">` only when `canNativeShare()`, calling `nativeShare({ title: tournament.name, url })`; `<QrCode value={url} label={t('tournaments.shareQrAlt')} testId="share-qr" className="hidden sm:block shrink-0" />`. In `TournamentDetail.jsx`, between `<TournamentChecklist … />` and the organizer panel: `{!detached && <ShareBox tournament={tournament} />}`.

- [ ] **Step 1: Write the failing tests** in `share.test.js` (Node 22 defines a global `navigator` without `share`; a plain assignment to `globalThis.navigator` is silently ignored there, so stub it with `vi.stubGlobal`, which uses `defineProperty`):

```js
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canNativeShare, nativeShare, tournamentShareUrl } from './share.js'
afterEach(() => vi.unstubAllGlobals())
it('tournamentShareUrl builds the absolute page URL', () => {
  expect(tournamentShareUrl('abc', 'https://altered-draft.altered.re')).toBe('https://altered-draft.altered.re/tournament/t/abc')
})
it('native share: unsupported here, supported with navigator.share, false on AbortError', async () => {
  expect(canNativeShare()).toBe(false)
  expect(await nativeShare({ title: 'x', url: 'https://x.test' })).toBe(false)
  const share = vi.fn(async () => {})
  vi.stubGlobal('navigator', { share })
  expect(canNativeShare()).toBe(true)
  expect(await nativeShare({ title: 'x', url: 'https://x.test' })).toBe(true)
  expect(share).toHaveBeenCalledWith({ title: 'x', url: 'https://x.test' })
  vi.stubGlobal('navigator', { share: async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }) } })
  expect(await nativeShare({ title: 'x', url: 'https://x.test' })).toBe(false)
})
```

- [ ] **Step 2: Run them to see them fail** — `npm test -- share` → module not found.
- [ ] **Step 3: Implement** `share.js`, point `ExportMenu.jsx` at it, write `ShareBox.jsx`, mount it on the page.
- [ ] **Step 4: Run** — `npm test` → all pass (the ExportMenu behaviour is unchanged); `npm run build` → ok; by hand: the box on a public and on a private tournament (hints differ), Copy flips the label and the clipboard holds the URL, the QR scans with a phone to the tournament page, no box on a detached tournament.
- [ ] **Step 5: Commit**

```bash
git add src/lib/share.js src/lib/share.test.js src/components/ShareBox.jsx src/components/ExportMenu.jsx src/pages/TournamentDetail.jsx
git commit -m "Tournament page: share box with link, copy, native share and QR code"
```

---

### Task 8: The Lobby's QR code moves to the local component

**Files:**
- Modify: `src/pages/Lobby.jsx` (the `qrUrl` constant and the `<img>` of the share block), `tests/e2e/support/network.js`

- [ ] **Step 1: Implement** — remove `qrUrl`; replace the `<img src={qrUrl} …>` with `<QrCode value={joinUrl} label={t('lobby.qrCodeAlt')} className="hidden sm:block shrink-0" />` (same place, same 120 px); in `network.js` delete the `api.qrserver.com` fulfil line and its comment, so the hostname falls through to the leak list.
- [ ] **Step 2: Check** — `grep -rn qrserver src tests` → nothing; `npm run build` → ok; `npm run test:e2e -- lobby-regression` → passes (the Lobby renders the SVG, no leak).
- [ ] **Step 3: Commit**

```bash
git add src/pages/Lobby.jsx tests/e2e/support/network.js
git commit -m "Lobby: local QR code, api.qrserver.com no longer called"
```

---

### Task 9: The V4 recette page

**Files:**
- Create: `docs/tournaments/acceptance-private-tournaments.html` (copy `acceptance-multiset-sealed.html`, keep its CSS/JS shell; replace the `<title>` ("Private Tournaments Acceptance"), the `<h1>` ("Acceptance — private tournaments and the share box · V4"), `GROUPS`, `AUTO_STEPS = []`, `AUTO_PARTIAL = {}`, the page's own localStorage state key (search `localStorage` in the copied file; the theme key `tournois-recette-theme` is shared on purpose) and the recap title)
- Modify: `scripts/e2e-acceptance-coverage.mjs` (`ACCEPTANCE_PAGES` += the new page)

BGA ids: 123500 "Private cup" (private, groups B–G), 123501 "Public control" (public), 123502 the stranger's duplicate-link attempt (never created), 123503 "Toggle cup" (edited both ways in F), 123504 "Squat cup" (detached in G). Personas: alice (organizer), bob (moderator), carol (stranger, then a pool holder), a private window (anonymous).

| Group | Steps |
| --- | --- |
| 0 Setup | `pv-0-lot1` (lot 1 stack, bob moderator, carol), `pv-0-branch` (`git switch feat/private-tournaments`, `make install`), `pv-0-dev` (`make dev`, then `SELECT column_default FROM information_schema.columns WHERE table_name = 'tournaments' AND column_name = 'visibility'` → `'public'::text`), `pv-0-tests` (`npm test && npm run test:integration`), `pv-0-e2e` (`make e2e && npm run test:e2e:coverage`, four pages listed), `pv-0-clean` (ids 123500–123509, the same `DELETE` pair as V3 on `^12350[0-9]$`, alice under the cap) |
| A Form | `pv-a-radio` (`/tournament/new`: "Visibility" under the description, Public checked, both hints; Private selectable; on the edit form of a locked tournament the radios stay enabled), `pv-a-draft` (Private chosen, then the lot 1 `b-session-expired` flow: the draft comes back with Private) |
| B Create | `pv-b-create` (create "Private cup", 123500, Private: the page header shows the status pill then the "Private" pill; `curl` as alice `?bgaId=123500` → `"visibility":"private"` with the full item), `pv-b-created-tab` ("My created tournaments": the pill after the status pill) |
| C Lists | `pv-c-organizer` (alice's Upcoming lists it with the pill, counter included), `pv-c-moderator` (bob's Upcoming lists it with the pill), `pv-c-stranger` (carol's Upcoming does not; counter), `pv-c-anon` (private window: not listed; `curl` without bearer `?status=open` → not in the JSON), `pv-c-public-control` (create "Public control" 123501 as alice: listed for carol and anonymous, no pill) |
| D Link | `pv-d-url` (carol opens `/tournament/t/<id>` by URL: the page, the pill, step 2 available), `pv-d-pool` (carol opens her pool → her Upcoming and "My pools" now list it with the pill), `pv-d-bga` (the lot 1 group G `tournament-bga-decklist` curl as carol on 123500 answers 200 whatever the visibility), `pv-d-ongoing` (psql `UPDATE tournaments SET starts_at = now() - interval '1 hour' WHERE bga_tournament_id = '123500'` → carol's "My ongoing tournaments" shows it) |
| E Duplicate link | `pv-e-stranger` (carol's form with the 123500 link: "A tournament already exists for this BGA link.", no name anywhere; `curl` as carol `?bgaId=123500` → `{"tournaments":[{"visibility":"private"}],"legacy":null}`), `pv-e-owner` (alice's edit form of Private cup: no problem listed, Save enabled) |
| F Edit | `pv-f-public` (create "Toggle cup" 123503 private, carol prepares a pool, alice edits → Public: anonymous lists it), `pv-f-private` (alice edits → Private: anonymous no longer lists it, carol still does) |
| G Share box | `pv-g-box` (title, hint per visibility, the URL), `pv-g-copy` (Copy → "✓ Copied" 2 s, paste = the URL), `pv-g-native` (phone: "Share…" opens the sheet; desktop Chrome on macOS shows it too, Firefox does not), `pv-g-qr` (scan with a phone → the tournament page; black on white in dark theme), `pv-g-detached` ("Squat cup" 123504 declared by carol, detached by bob: no share box) |
| H Lobby | `pv-h-lobby-qr` (Home → create a room: the QR is an `<svg>`, scanning it joins the room; DevTools Network shows no `qrserver` request) |
| I Cross-cutting | `pv-i-fr`, `pv-i-theme`, `pv-i-mobile` (375 px: the radios stack, the share box without the QR, no horizontal scroll), `pv-i-console` |
| K Before production | `pv-k-preprod` (a private tournament on preprod: the hub as a moderator and as a stranger, the QR scanned) |

- [ ] **Step 1: Write the page** (new steps unchecked, V3 conventions, every `pre(...)` command `zsh -n` checked).
- [ ] **Step 2: Register it** in `ACCEPTANCE_PAGES`; `npm run test:e2e:coverage` → the page lists every id under "no tag", no id is declared twice.
- [ ] **Step 3: Commit**

```bash
git add docs/tournaments/acceptance-private-tournaments.html scripts/e2e-acceptance-coverage.mjs
git commit -m "Acceptance: private tournaments and share box recette page (V4)"
```

---

### Task 10: Playwright replay

**Files:**
- Create: `tests/e2e/specs/private-tournaments.spec.js`
- Modify: `tests/e2e/support/api.js` (`privateTournamentBody`), `docs/tournaments/acceptance-private-tournaments.html` (`AUTO_STEPS`, `AUTO_PARTIAL`)

**Interfaces:**
- `privateTournamentBody(overrides = {})` → `tournamentBody({ name: 'Private cup', bgaUrl: 'https://boardgamearena.com/tournament?id=123500', visibility: 'private', ...overrides })`.
- Locators: `page.getByTestId('visibility-private')` / `'visibility-public'` (or `getByRole('radio', { name: t('tournaments.visibilityPrivate') })`), `page.getByTestId('tournament-private')`, `tournamentLink(panel, 'Private cup')` (from `support/pages.js`; the pill sits after the status pill so the name pattern still matches), `page.getByTestId('share-box' | 'share-url' | 'share-copy' | 'share-native' | 'share-qr')`, `page.getByTestId('qr-code')` in the Lobby.

Tests (one per tag unless stated; `db.resetDb()` + `fakes.reset()` in `beforeEach`):

- `@pv-a-radio`: as alice on `/tournament/new`: `visibility-public` checked, `visibility-private` not, both hints visible; click private → checked.
- `@pv-b-create` + `@pv-b-created-tab`: fill a valid form, pick Private, create; `api('alice').get('/api/tournaments/<id>')` → `visibility === 'private'`; the header shows `tournament-status` then `tournament-private`; `openMenu(page, '?tab=created')` → `tournamentLink(panel, 'Private cup')` contains `tournament-private`.
- `@pv-c-lists` (tags `@pv-c-organizer`, `@pv-c-moderator`, `@pv-c-stranger`, `@pv-c-anon`, `@pv-c-public-control`): seed `privateTournamentBody()` as alice and a public "Public control" (id 123501); for alice and bob `openMenu` → both cards, the private one with the pill; for carol and anonymous → only "Public control", `tournamentLink(panel, 'Private cup')` count 0; the Upcoming tab counter reads 2 for alice, 1 for carol.
- `@pv-d-url` + `@pv-d-pool`: carol `goto` the URL → heading, pill, step 2 button; `seed.pool('carol', id)`; `openMenu` as carol → the card with the pill; `?tab=pools` → the card with the pill.
- `@pv-d-ongoing`: `db.query` moves `starts_at` an hour back → carol's hub shows the card inside `getByTestId('my-ongoing')`.
- `@pv-e-dup` (tags `@pv-e-stranger`, `@pv-e-owner`): as carol, `/tournament/new`, name + the 123500 link → `form-problems` contains `t('tournaments.errBgaTaken')`, the page body does not contain "Private cup"; `api('carol').get('/api/tournaments?bgaId=123500')` body `toEqual({ tournaments: [{ visibility: 'private' }], legacy: null })`; as alice on `/tournament/t/<id>/edit` → `form-problems` empty, Save enabled.
- `@pv-f-toggle` (tags `@pv-f-public`, `@pv-f-private`): seed private + `seed.pool('carol', id)`; alice edits → Public → Save; anonymous `openMenu` lists it; alice edits → Private; anonymous does not, carol still does.
- `@pv-g-share` (tags `@pv-g-box`, `@pv-g-copy`, `@pv-g-qr`): anonymous page: `share-box` visible, hint = `sharePrivateHint`, `share-url` value = `${APP_URL}/tournament/t/${id}`; `page.context().grantPermissions(['clipboard-read', 'clipboard-write'])`, click `share-copy` → label `shareCopied`, `page.evaluate(() => navigator.clipboard.readText())` = the URL, label back to `shareCopy` within 3 s; `share-native` count 0; `share-qr` visible with `rect[fill="#fff"]` and `path[fill="#000"]` whose `d` is non-empty; click the theme toggle (`t('theme.toggle')`) → same fills; a public tournament's hint = `shareHint`; after `api('alice').patch(…, { action: 'cancel' })` on that public one, the box is still there with no hint.
- `@pv-g-native`: a page with `addInitScript(() => { window.__shared = []; navigator.share = d => { window.__shared.push(d); return Promise.resolve() } })` → `share-native` visible; click → `evaluate(() => window.__shared[0])` `toEqual({ title: 'Private cup', url })`.
- `@pv-g-copy-fallback`: `addInitScript` stubs `navigator.clipboard.writeText` to reject and `document.execCommand` to return `false`; click `share-copy` → label still `shareCopy`, `share-url` is the active element with the whole value selected (`selectionStart === 0 && selectionEnd === value.length`), no console error (the guard).
- `@pv-g-detached`: seed as carol, `api('bob').patch('/api/tournaments/<id>', { action: 'detach' })` → the page shows no `share-box`.
- `@pv-h-lobby-qr`: `createRoom` as in `lobby-regression.spec.js` → `qr-code` visible with a non-empty path (the guard fails the test on any `api.qrserver.com` request).
- `@pv-i-mobile` (`@mobile`): the form's visibility radios stacked, `expectNoHorizontalScroll`; the tournament page: `share-box` visible, `share-qr` hidden, `expectNoHorizontalScroll`.
- `@pv-i-fr` (partial: "no English leftovers" stays manual): FR selected; `/tournament/new` shows `tFr('tournaments.visibilityLabel')`; the tournament page `tFr('tournaments.shareTitle')` and `tFr('tournaments.privateBadge')`; no raw key (the `RAW_KEY` regex of `i18n-fr.spec.js`).

- [ ] **Step 1: Write the helper and the spec.**
- [ ] **Step 2: Run** — `make e2e` → everything passes (lot 1, V2, V3 included). A step the app does not meet goes in as `test.fixme` with its tag and is listed in the PR, never silently fixed.
- [ ] **Step 3: Coverage** — `npm run test:e2e:coverage -- --write` rewrites the four `AUTO_STEPS` lines; add the `AUTO_PARTIAL` notes for `pv-g-qr` (scanning stays a human check), `pv-g-native` (a stubbed `navigator.share`; the real sheet stays a human check), `pv-i-fr`, `pv-i-mobile` by hand; re-run without `--write` → exit 0.
- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/private-tournaments.spec.js tests/e2e/support/api.js docs/tournaments/acceptance-private-tournaments.html
git commit -m "E2E: private tournaments and share box acceptance steps"
```

---

### Task 11: Docs and the final verification

**Files:**
- Modify: `docs/tournaments/README.md` (new §14.9 "Private tournaments and the share box (V4)" after §14.7, same structure: Format, Data, Listing rule, API, UI, QR code and Lobby, Recette, Merge; §14's intro sentence gains "V4 (§14.9) adds a public / private visibility and the share box"; §14.3's rows for `GET /api/tournaments` (the filter, the redacted `?bgaId=` item, `?mine=1` unchanged), `POST` (`visibility`), `PATCH` (`visibility`), `/api/tournament-bound-pools` (`tournament.visibility`); §14.4's `/tournament/new` ("visibility radio") and `/tournament/t/:id` ("share box") rows), `docs/tournaments/index.html` (the same §14.9 rendered with `id="s14-8"`, the §1 overview sentence, the lot paragraph before §14.1, the §14.3 / §14.4 rows), `CLAUDE.md` (a **Private tournaments + share box (V4)** sentence after the V3 one in "User-created tournaments": the column, the listing rule and `canSeeTournament`, the redacted lookup, `PrivateBadge`, `ShareBox` / `QrCode` / `qr.js` / `share.js`, the fourth acceptance page; and the Lobby line of "Pages / routes": "room share link + local QR code"), `docs/tournaments/user-tournaments-spec.md` (re-read §14 against what was built; fix any drift, mark "as built" where a builder choice was settled)

- [ ] **Step 1: Write the docs** (README and index.html together, same wording).
- [ ] **Step 2: Full verification** — `npm run build && npm test && npm run test:integration && make e2e && npm run test:e2e:coverage` → all green; keep the four summary lines for the PR description.
- [ ] **Step 3: Commit**

```bash
git add docs/tournaments/README.md docs/tournaments/index.html CLAUDE.md docs/tournaments/user-tournaments-spec.md
git commit -m "Docs: private tournaments and the share box (V4)"
```

- [ ] **Step 4: Draft PR** — push `feat/private-tournaments` and open a **draft** PR based on `feat/multiset-sealed` (English, the shape of #26: Why, What, Decisions of spec §14.2, the test counts table, Recette, Docs, Merge plan: retarget `main` once #25 and #26 merge, run group K of the V4 recette on preprod). Do not merge.

---

## Self-review (done while writing; kept for the executor)

- **Spec coverage:** §14.2 meaning / who sees → Tasks 1–2; data → Task 1; API field → Tasks 1–2; hub → Task 5; badge → Task 5; `?bgaId=` redaction → Task 2; form → Tasks 3–4; share box → Task 7; QR → Task 6; Lobby → Task 8; bound pools → Task 2; i18n → Task 3; recette → Task 9; branch → Global Constraints; §14.3 → Task 2; §14.4 → Task 2; §14.5 → Tasks 4, 5, 7, 8; §14.6 → Tasks 1, 2, 3, 5, 6, 7, 10; §14.7 non-goals → nothing to build; docs → Task 11. §14.9's builder choices are left open on purpose (Task 7 settles one: `share.js` is extracted and `ExportMenu` imports it).
- **Review Focus:** 1 → Task 2 (`bgaholder`); 2 → Tasks 2 (`redacts a private declaration`), 10 (`@pv-e-dup`); 3 → Task 2 (`PATCH visibility works whatever the status`); 4 → Tasks 7 (the select-on-failure branch), 10 (`@pv-g-copy-fallback`); 5 → Tasks 6 (literal fills), 10 (`@pv-g-share` after the theme toggle).
- **Names used across tasks:** `VISIBILITIES`, `canSeeTournament` (Task 1) consumed by Tasks 2, 4; `listTournaments(status, viewer)` (Task 2) consumed by the GET handler only; the i18n keys (Task 3) by Tasks 4, 5, 7; `PrivateBadge` (Task 5) by `TournamentMenu` / `TournamentDetail`; `QrCode`, `qrSvgPath`, `QR_QUIET_ZONE` (Task 6) by Tasks 7, 8; `copyText`, `canNativeShare`, `nativeShare`, `tournamentShareUrl` (Task 7) by `ShareBox` and `ExportMenu`; `privateTournamentBody` (Task 10) by the spec only; the `data-testid`s of Tasks 4, 5, 6, 7 by Task 10.
- **Proportion:** signatures, assertions, markup skeletons and commands; no function body except the SQL of §14.3 (in the spec) and the schema line.
- **Builder check (2026-11-01, fresh reviewer on spec §14 against the worktree):** "nothing important left". Its three low-stakes calls, settled here: the badge sits between the status pill and the "✓ Your pool is ready" text (Task 5); the public share hint is shown only while the tournament is open, the private one in every status (Task 7); `qrcode-generator` goes in `dependencies` next to React (Vite bundles it; `npm ci --omit=dev` in the Dockerfile would work either way, but a runtime UI library belongs with the others) (Task 6). `ROADMAP.md` is not touched: #25 and #26 did not touch it either.
