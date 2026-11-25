# Cube sealed and the player cap (V5) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The tasks are grouped in **waves** (see "Waves and file ownership"): every task of a wave touches its own files only, so the tasks of one wave can run in parallel (one agent each, in its own worktree, merged into `feat/cube-sealed` with merge commits) or one after the other; a wave starts when the previous one is merged.

**Goal:** Let an organizer declare a sealed tournament whose boosters are dealt from a cube (a community cube, their Re:Union decks or a pasted list), every copy of a card given to at most one player, with cube booster settings, a hero pool chosen in the form and a player cap that every source can use.

**Architecture:** A fourth `source.type`, `cube`, in the shared config validator (content snapshotted by refs, uniques and ban list forced off). The cube is **dealt once per tournament** at its first pool (`dealCubeSlots`, seeded, pure) into `max_players` lots stored in a new `tournament_cube_slots` table; every pool claims the next free lot under `FOR UPDATE` on the tournament row (`insertCappedPool`, which also enforces the cap for every source). The form gets a third "Cube" tab (`CubePicker`) and a cube-specific Settings section (`TournamentCubeSettings`, `HeroPicker`, `MaxPlayersField`); a public cube page shows the content; the reveal draws a booster cover from the bundled Altered logo.

**Tech Stack:** Node 22, Express 5 (same handler modules as the Vercel layout), `pg`, React 18 + react-router 6 + Tailwind semantic tokens, vitest (`npm test`, `npm run test:integration` against Docker Postgres), Playwright (`make e2e`, fakes + card fixtures).

**Spec:** `docs/tournaments/user-tournaments-spec.md` §15 (design, decisions, the deal, API, form, tests), §5.1 (config), §6 (binding and the BGA path). Read §15 first. V3's PR (#26) and its plan `multiset-sealed-plan.md`, V4's PR (#27) and `private-tournaments-plan.md` are the pattern: same files, same test layers, same recette conventions.

## Global Constraints

- Branch `feat/cube-sealed`, created from `main` (#25, #26, #27, #28, #30 merged). The spec, this plan and `public/images/altered-logo.png` are its first commit. Never rebase: update with merge commits. Parallel tasks run in their own git worktrees (`superpowers:using-git-worktrees`) and are merged back with merge commits.
- Scope: declared tournaments only. No change to the Lobby's own cube sealed (Task 15 is optional and must not change its behaviour), to `current_format`, to the legacy pools, nor to the BGA-facing contracts beyond the new 409 `tournament_full`.
- `CUBE_LIMITS` (spec §15.4): boosters 3–8, cards per booster 10–16, per faction 0–2 (2 needs ≥ 12 cards per booster), `boosters × cardsPerBooster ≥ 60`, Σ cards ≤ 1500, hero pool 1–200, `maxPlayers` 2–256.
- The six existing golden digests in `src/lib/__snapshots__/poolBuilder.golden.test.js.snap` **must not move**. Any task that touches `packGenerator.js` or `poolBuilder.js` runs `npm test -- poolBuilder.golden` before committing. The cube deal gets its own golden file.
- Rng contract of the deal (spec §15.3): per faction in `FACTIONS` order a shuffle of its copies, then one shuffle of the leftovers, then per lot a shuffle of the hero pool. Seed `${tournament.id}|cube|${nonce}` with a fresh nonce; the lots are stored, nothing is regenerated.
- UI copy in both `src/lib/i18n/en.js` and `fr.js` (Task 3 holds every key: later tasks read it, they never invent one); semantic Tailwind tokens only (`surface*`, `ink*`, `muted`, `faint`, `line`, `accent*`, `ok`, `danger`), never raw `gray-*` / `green-*` / `red-*`. The generated booster cover is the one place with literal colours.
- Docs travel with the code: `docs/tournaments/README.md` **and** `docs/tournaments/index.html`, `CLAUDE.md`, the spec, in the same PR (Task 14 gathers the doc pass).
- Recette conventions (`docs/tournaments/acceptance-private-tournaments.html` is the template): every step that runs something carries its full copy-paste command, URLs quoted, no `!` inside double-quoted shell strings, checked with `zsh -n`; new steps start unchecked; ids are `cu-<group>-<slug>` and must not exist in another page.
- Code, comments, commit messages in English. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit only the files each task touches.
- Node ESM: JSON imports need `with { type: 'json' }`; `pg` jsonb parameters are `JSON.stringify`ed; a `jsonb` read back has its keys in jsonb order, never rely on key order.

## Review Focus

Inputs the spec implies that a user will hit; each one gets a test in the task that owns the code.

1. **Two players opening the last place at the same time** (cap 2, three `Promise.all` creators): exactly two pools, the third call `tournament_full`, never three pools and never a pool without a slot. → Task 5 (`cube-pools.test.js`, "three creators on a cap of 2").
2. **A pasted list with an alt-art ref, a promo-only ref, an unknown ref, a mistyped unique serial and a hero** ("1 ALT_DUSTEROP_A_AX_98_C", "1 ALT_BISE_P_BR_64_C", "1 ALT_NOPE_B_AX_01_C", "1 ALT_CORE_B_AX_04_U_999999999", "1 ALT_CORE_B_AX_01_C"): the alt-art is stored as its `B` twin, the promo-only ref (no `B` twin) is resolved by reference and **kept as given**, the unknown ref is shown under the ref as given and left out, the unique that the cards API does not know is left out too (synthetic fallback = unresolved), the hero is split out and preselected, and the server refuses a config that still carries an unresolved ref. → Tasks 5a (`cubeSource.test.js`), 6 (behaviour), 13 (`@cu-a-paste`).
3. **A cube whose Yzmir cards are too few for the faction guarantee** (e.g. 5 YZ cards, 6 boosters × 1): the capacity names Yzmir, the form says "cannot serve 2 players", the API refuses with `source.capacity`, and the deal never runs short. → Tasks 1 (`cubeCapacity` faction-bound), 2 (`dealCubeSlots` throws), 5b (`source.capacity` 400).
4. **An organizer who lowers a set tournament's cap under its pool count** (3 pools, cap 2): 400 `below_pool_count`, the form says why, raising or clearing stays allowed. → Tasks 1 (`checkPlayerCap`), 4 (PATCH test), 13 (`@cu-g-lower`).
5. **A cube tournament edited after its first pool**: the chosen-cube card is read-only with Preview, the cube settings and the cap are disabled, the name stays editable, a PATCH with `maxPlayers` is 409 `tournament_locked`. → Tasks 5b (PATCH test), 7 (locked state), 13 (`@cu-i-locked`).

---

## Waves and file ownership

| Wave | Task | Files it owns (nobody else edits them in that wave) |
| --- | --- | --- |
| 1 | T1 Config, rules, capacity | `src/lib/tournamentConfig.js` + test, `src/lib/tournamentRules.js` + test, `src/lib/cubeSealed.js` (new) + test, `src/lib/tournamentForm.js` + test |
| 1 | T2 Dealer | `src/lib/packGenerator.js` + test, `src/lib/cubeDeal.golden.test.js` (new) + its snapshot, `src/lib/poolBuilder.js` + test |
| 1 | T3 i18n | `src/lib/i18n/en.js`, `src/lib/i18n/fr.js` |
| 1 | T4 Schema, store, `maxPlayers` through the API | `sealed-pools-schema.sql`, `src/lib/tournamentStore.js`, `api/tournaments/index.js`, `api/tournaments/[id].js`, `tests/integration/tournaments.test.js` |
| 1 | T5a Cube resolver | `src/lib/cubeSource.js` (new) + test, `src/lib/cardData.js` + test (the `synthetic` flag only) |
| 1 | T11 E2E fixtures and fakes | `scripts/e2e-card-fixtures.mjs`, `tests/e2e/fixtures/cards/**`, `tests/e2e/fakes/server.mjs`, `tests/e2e/fakes/decks.mjs`, `tests/e2e/fakes/cards.mjs`, `tests/e2e/support/fakes-client.js`, `tests/e2e/support/fixtures.js`, `tests/e2e/support/api.js`, `tests/e2e/specs/harness.spec.js` |
| 2 | T5 Pool creation and the cap | `src/lib/poolStore.js`, `api/tournaments/[id]/pool.js`, `api/tournament-bga-decklist.js`, `api/tournament-pool-counts.js`, `api/_lib/tournamentPool.js`, `tests/integration/cube-pools.test.js` (new) |
| 2 | T5b Cube checks on POST / PATCH | `api/_lib/cubeChecks.js` (new), `api/tournaments/index.js`, `api/tournaments/[id].js`, `server/index.js` (the JSON body limit), `tests/integration/cube-config.test.js` (new) |
| 2 | T6 CubePicker, HeroPicker | `src/components/CubePicker.jsx` (new), `src/components/HeroPicker.jsx` (new), `src/lib/cubeResolve.js`, `src/lib/heroCatalog.js` (new) + test |
| 2 | T8 Summary, hub, page, checklist | `src/components/TournamentBits.jsx` + test, `src/pages/TournamentMenu.jsx`, `src/pages/TournamentDetail.jsx`, `src/components/TournamentChecklist.jsx` |
| 2 | T9 Cube page | `src/components/CubeContents.jsx` (new), `src/components/CubePreviewModal.jsx`, `src/pages/TournamentCubePage.jsx` (new), `src/App.jsx` |
| 2 | T10 Reveal cover | `src/lib/cubeCover.js` (new) + test, `src/components/PackReveal.jsx`, `src/components/TournamentPoolView.jsx` |
| 2 | T12 Recette page | `docs/tournaments/acceptance-cube-sealed.html` (new), `scripts/e2e-acceptance-coverage.mjs` |
| 2b | T7 Form | `src/components/TournamentCardsSource.jsx`, `src/components/TournamentCubeSettings.jsx` (new), `src/components/MaxPlayersField.jsx` (new), `src/pages/TournamentForm.jsx` — starts with wave 2 against T6's interface, merges after T6 |
| 3 | T13 Playwright | `tests/e2e/specs/cube-sealed.spec.js` (new), the `AUTO_STEPS` / `AUTO_PARTIAL` lines of the recette page |
| 4 | T14 Docs, verification, PR | `docs/tournaments/README.md`, `docs/tournaments/index.html`, `CLAUDE.md`, `docs/tournaments/user-tournaments-spec.md`, `TESTING.md` |
| 4 | T15 Lobby adopts CubePicker (optional) | `src/pages/Lobby.jsx` |

Interfaces between tasks are fixed by this plan (each task's **Interfaces** block); a task that needs something another task did not produce stops and reports instead of editing that task's files.

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/cubeSealed.js` | `CUBE_LIMITS`, `CUBE_ORIGINS`, `CARD_REF_RE`, `cubeCapacity`, `expandCube`, `checkPlayerCap` (pure, shared by form and API). |
| `src/lib/cubeDeal.golden.test.js` | One digest pinning `dealCubeSlots`. |
| `src/lib/cubeSource.js` | `resolveCubeSource`: a stored cube source → card objects (server-safe, injectable fetchers). |
| `api/_lib/cubeChecks.js` | `checkCubeConfig`: the cube resolution + capacity + cap checks of POST / PATCH, one 400 body or null. |
| `src/lib/heroCatalog.js` | `loadAllHeroes(lang)`: every hero of every visible set, cached. |
| `src/lib/cubeCover.js` | `cubeBoosterCover`: the canvas-drawn booster cover (data URL), `wrapTitle`. |
| `src/components/CubePicker.jsx` | The Cube tab: community / Re:Union / paste panels and the chosen-cube card. |
| `src/components/HeroPicker.jsx` | The hero pool selection (closed summary + inline panel). |
| `src/components/TournamentCubeSettings.jsx` | The Settings section of a cube source. |
| `src/components/MaxPlayersField.jsx` | The "Players" block (every source). |
| `src/components/CubeContents.jsx` | The body of `CubePreviewModal`, reused by the cube page. |
| `src/pages/TournamentCubePage.jsx` | `/tournament/t/:id/cube`. |
| `tests/integration/cube-pools.test.js`, `tests/integration/cube-config.test.js` | V5 integration suites (deal, cap, BGA path; POST / PATCH cube checks). |
| `tests/e2e/specs/cube-sealed.spec.js` | Playwright replay of the V5 acceptance steps. |
| `docs/tournaments/acceptance-cube-sealed.html` | The V5 recette page (`cu-` ids). |
| `tests/e2e/fixtures/cards/{CORE,BISE,DUSTER,ALIZE}/<SET>_EN.json` | The "All commons" cube's sets, trimmed to its refs. |
| `public/images/altered-logo.png` | The bundled logo (already in the branch's first commit). |

**Modified**

| File | Change |
| --- | --- |
| `src/lib/tournamentConfig.js` (+ test) | `cube` source, forced uniques / ban list, `configSetCodes`, `legacyColumnsFromConfig`. |
| `src/lib/tournamentRules.js` (+ test) | `maxPlayers` field. |
| `src/lib/tournamentForm.js` (+ test) | `capacity` / `poolCount` inputs, the new issue fields. |
| `src/lib/packGenerator.js` (+ test) | `dealCubeSlots`, `dealHeroSlots(packs, heroRefs, rng)`. |
| `src/lib/poolBuilder.js` (+ test) | Throws on a cube source. |
| `src/lib/i18n/en.js`, `fr.js` | The keys of Task 3. |
| `sealed-pools-schema.sql` | `tournaments.max_players`, `tournament_cube_slots`, `sealed_pools.cube_slot`. |
| `src/lib/tournamentStore.js` | `maxPlayers` in create / update / JSON; detach deletes the slots. |
| `api/tournaments/index.js`, `[id].js` | `maxPlayers` (T4), the cube checks and the cube lock (T5b). |
| `src/lib/poolStore.js` | `insertCappedPool`, `tournament_full`, the slot claim. |
| `api/tournaments/[id]/pool.js`, `api/tournament-bga-decklist.js`, `api/tournament-pool-counts.js` | 409 `tournament_full`. |
| `api/_lib/tournamentPool.js` | `poolResponse.cube`. |
| `src/lib/cubeResolve.js` | `resolveCubeCards` (card objects, not only refs). |
| `src/components/TournamentCardsSource.jsx`, `src/pages/TournamentForm.jsx` | The Cube tab, the cube state, settings, cap, prefill, draft, issues. |
| `src/components/TournamentBits.jsx` (+ test) | Cube summary parts, `FullBadge`, `PlayersLine`. |
| `src/pages/TournamentMenu.jsx`, `src/pages/TournamentDetail.jsx`, `src/components/TournamentChecklist.jsx` | Players line, Full pill, cube link, "full" step 2. |
| `src/components/CubePreviewModal.jsx` | Thin modal around `CubeContents`. |
| `src/App.jsx` | The cube route. |
| `src/components/PackReveal.jsx`, `src/components/TournamentPoolView.jsx` | `coverImage`, the cube sublabel, the cube link. |
| `scripts/e2e-card-fixtures.mjs`, `tests/e2e/fixtures/cards/README.md` | `--cube <id>` trimming. |
| `tests/e2e/fakes/server.mjs`, `fakes/decks.mjs`, `support/fakes-client.js`, `support/fixtures.js`, `support/api.js`, `specs/harness.spec.js` | Deck seeding, `cubeTournamentBody`, the 404 check on a set without fixture. |
| `scripts/e2e-acceptance-coverage.mjs` | Fifth page in `ACCEPTANCE_PAGES`. |
| `docs/tournaments/README.md`, `index.html`, `CLAUDE.md`, `user-tournaments-spec.md`, `TESTING.md` | §14.10, the V5 paragraph, cross-checks. |

---

### Task 1: Config, rules, capacity (pure)

**Files:**
- Create: `src/lib/cubeSealed.js`, `src/lib/cubeSealed.test.js`
- Modify: `src/lib/tournamentConfig.js`, `src/lib/tournamentRules.js`, `src/lib/tournamentForm.js`
- Test: `src/lib/tournamentConfig.test.js`, `src/lib/tournamentRules.test.js`, `src/lib/tournamentForm.test.js`

**Interfaces:**
- Produces (`src/lib/cubeSealed.js`):
  - `CUBE_LIMITS = { boosters: [3, 8], cardsPerBooster: [10, 16], perFaction: [0, 2], perFaction2MinCards: 12, minPoolCards: 60, maxCards: 1500, maxHeroes: 200, maxPlayers: 256, nameMax: 80 }`, `CUBE_ORIGINS = ['community', 'reunion', 'paste']`, `CARD_REF_RE = /^ALT_[A-Z]+_[ABP]_[A-Z]{2}_\d+_(C|R1|R2|E|U_\d+)$/` (a stored ref: any printing letter, the set — `split('_')[1]` — must be a code `SETS` knows, hidden ones included; whether a non-`B` ref has a `B` twin is the resolver's business, not the validator's), `isHeroRefShape(ref)` = `CARD_REF_RE` and not `_U_`.
  - `cubeCapacity({ cards, boosters, cardsPerBooster, perFaction }) → { players, total, byFaction, limit: { by, have, needed } }` with `cards: { ref, qty, faction }[]` (faction `null` allowed: counts in `total` only), `byFaction` always the six keys, `players` capped at `CUBE_LIMITS.maxPlayers`, `limit.by` the binding term (`'total'` first on a tie, then `FACTIONS` order), `needed` per player.
  - `expandCube(cards) → { ref, faction }[]` (one entry per copy, input order, qty copies each).
  - `checkPlayerCap({ source, maxPlayers, capacity = null, poolCount = 0 }) → { fields: {}, config: [] }`: cube → `maxPlayers == null` ⇒ `fields.maxPlayers = 'required_for_cube'`; `capacity && capacity.players < 2` ⇒ `config` gets `'source.capacity'`; `capacity && maxPlayers > capacity.players` ⇒ `fields.maxPlayers = 'above_capacity'`. Other sources → `maxPlayers != null && maxPlayers < poolCount` ⇒ `'below_pool_count'`. Both objects empty otherwise.
- Produces (`tournamentConfig.js`): `SOURCE_TYPES = ['set', 'faction', 'multiset', 'cube']`; `validateTournamentConfig` accepts the cube source of spec §15.2 and returns `source: { type: 'cube', name, origin, cubeId, cards: { ref: qty } (keys sorted), heroPool: string[] (sorted, distinct), boosters, cardsPerBooster, perFaction }`, `uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null }`, `excludeBanlist: false`, no `banlist`; error codes `source.name`, `source.origin`, `source.cubeId`, `source.cards`, `source.heroPool`, `source.boosters`, `source.cardsPerBooster`, `source.perFaction`, `source.poolSize` (the uniques / ban-list keys are never an error for a cube). `configSetCodes` on a cube = the distinct `setCodeFromRef` of `cards` keys and `heroPool`, `SETS` order; `legacyColumnsFromConfig` = `{ set_code: null, unique_count: 0, even_factions: false, heroes_in_pool: heroes === 'packs', guaranteed_uniques: 0 }`.
- Produces (`tournamentRules.js`): `validateTournamentFields` → `values.maxPlayers` (`null` when absent / `null` / `''` on create; on a patch only when the key is sent; integer 2–256 else `errors.maxPlayers = 'invalid_max_players'`; `MAX_PLAYERS_MAX = 256`).
- Produces (`tournamentForm.js`): `tournamentFormIssues({ …, capacity = null, poolCount = 0 })` adds `{ field: 'maxPlayers', code }` from `fields.maxPlayers` and from `checkPlayerCap`, `{ field: 'cube', code: 'required' }` for `source.cards` / `source.name`, `{ field: 'cube', code: 'source.capacity' }`, `{ field: 'cubeSettings', code }` for `source.poolSize` / `source.perFaction` / `source.boosters` / `source.cardsPerBooster` (cube only), `{ field: 'heroPool', code: 'required' }` for `source.heroPool`; `FIELD_ORDER` gains `cube`, `cubeSettings`, `heroPool`, `maxPlayers` after `uniques`.

- [ ] **Step 1: Write the failing tests** — `src/lib/cubeSealed.test.js` (new) with a helper `card = (ref, qty, faction) => ({ ref, qty, faction })` and a cube of 36 cards, 6 per faction (`AX` … `YZ`, refs `ALT_CORE_B_<F>_<n>_C`):

```js
it('cubeCapacity is bound by the total when every faction is plentiful', () => {
  const c = cubeCapacity({ cards: big(60), boosters: 3, cardsPerBooster: 10, perFaction: 1 }) // 360 cards, 60 per faction
  expect(c).toMatchObject({ players: 12, total: 360, limit: { by: 'total', have: 360, needed: 30 } })
})
it('cubeCapacity is bound by the scarcest faction with a faction guarantee', () => {
  const cards = [...big(10), ...Array.from({ length: 20 }, (_, i) => card(`ALT_CORE_B_AX_${100 + i}_C`, 1, 'AX'))] // YZ: 10 cards
  const c = cubeCapacity({ cards, boosters: 6, cardsPerBooster: 10, perFaction: 1 })
  expect(c.limit).toEqual({ by: 'YZ', have: 10, needed: 6 })
  expect(c.players).toBe(1)
  expect(cubeCapacity({ cards, boosters: 6, cardsPerBooster: 10, perFaction: 0 }).limit.by).toBe('total')
})
it('cubeCapacity counts an unknown faction in the total only, and caps at 256', () => {
  expect(cubeCapacity({ cards: [card('ALT_CORE_B_AX_1_U_9', 1, null), ...big(10)], boosters: 3, cardsPerBooster: 10, perFaction: 0 }).total).toBe(61)
  expect(cubeCapacity({ cards: big(1000), boosters: 3, cardsPerBooster: 10, perFaction: 0 }).players).toBe(256)
})
it('expandCube repeats a ref qty times', () => {
  expect(expandCube([card('A', 2, 'AX'), card('B', 1, 'BR')])).toEqual([{ ref: 'A', faction: 'AX' }, { ref: 'A', faction: 'AX' }, { ref: 'B', faction: 'BR' }])
})
it('checkPlayerCap: cube required, above capacity, capacity below 2; other sources below the pool count', () => {
  const cube = { type: 'cube' }, set = { type: 'set' }
  expect(checkPlayerCap({ source: cube, maxPlayers: null, capacity: { players: 4 } })).toEqual({ fields: { maxPlayers: 'required_for_cube' }, config: [] })
  expect(checkPlayerCap({ source: cube, maxPlayers: 5, capacity: { players: 4 } })).toEqual({ fields: { maxPlayers: 'above_capacity' }, config: [] })
  expect(checkPlayerCap({ source: cube, maxPlayers: 2, capacity: { players: 1 } })).toEqual({ fields: {}, config: ['source.capacity'] })
  expect(checkPlayerCap({ source: cube, maxPlayers: 4, capacity: { players: 4 } })).toEqual({ fields: {}, config: [] })
  expect(checkPlayerCap({ source: set, maxPlayers: 2, poolCount: 3 })).toEqual({ fields: { maxPlayers: 'below_pool_count' }, config: [] })
  expect(checkPlayerCap({ source: set, maxPlayers: null, poolCount: 3 })).toEqual({ fields: {}, config: [] })
})
```

In `tournamentConfig.test.js`, `describe('validateTournamentConfig cube source')` with `const cube = over => ({ format: 'sealed', source: { type: 'cube', name: 'My cube', origin: 'paste', cubeId: null, cards: { ALT_CORE_B_AX_01_C: 1, ALT_CORE_B_BR_02_R1: 2, ALT_CORE_B_AX_04_U_1437: 1 }, heroPool: ['ALT_CORE_B_BR_01_C', 'ALT_CORE_B_AX_01_C'], boosters: 7, cardsPerBooster: 12, perFaction: 1, ...over }, heroes: 'packs', uniques: { inBoosters: 3, guaranteed: 2, evenFactions: true, randomOneIn: 4 }, excludeBanlist: true })`:

```js
it('accepts a cube, sorts its keys and hero pool, forces the uniques and the ban list off', () => {
  const r = validateTournamentConfig(cube())
  expect(r.ok).toBe(true)
  expect(r.config.source).toEqual({ type: 'cube', name: 'My cube', origin: 'paste', cubeId: null, cards: { ALT_CORE_B_AX_01_C: 1, ALT_CORE_B_AX_04_U_1437: 1, ALT_CORE_B_BR_02_R1: 2 }, heroPool: ['ALT_CORE_B_AX_01_C', 'ALT_CORE_B_BR_01_C'], boosters: 7, cardsPerBooster: 12, perFaction: 1 })
  expect(r.config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null })
  expect(r.config.excludeBanlist).toBe(false)
  expect(r.config).not.toHaveProperty('banlist')
})
it('trims the name, coerces strings, keeps a community cube id, nulls it otherwise, keeps a non-B printing', () => {
  expect(validateTournamentConfig(cube({ name: '  Commons  ', origin: 'community', cubeId: 'all-commons', boosters: '6', cardsPerBooster: '10', perFaction: '0' })).config.source).toMatchObject({ name: 'Commons', cubeId: 'all-commons', boosters: 6, cardsPerBooster: 10, perFaction: 0 })
  expect(validateTournamentConfig(cube({ cubeId: 'x' })).config.source.cubeId).toBeNull()
  expect(validateTournamentConfig(cube({ cards: { ALT_BISE_P_BR_64_C: 1, ALT_CORE_A_AX_02_C: 1 } })).config.source.cards).toEqual({ ALT_BISE_P_BR_64_C: 1, ALT_CORE_A_AX_02_C: 1 })
})
it('refuses each cube problem with its code', () => {
  const cases = [
    [{ name: '' }, 'source.name'], [{ name: 'x'.repeat(81) }, 'source.name'],
    [{ origin: 'web' }, 'source.origin'], [{ origin: 'community', cubeId: '' }, 'source.cubeId'],
    [{ cards: {} }, 'source.cards'], [{ cards: [] }, 'source.cards'], [{ cards: { ALT_CORE_X_AX_01_C: 1 } }, 'source.cards'], [{ cards: { ALT_NOPE_B_AX_01_C: 1 } }, 'source.cards'],
    [{ cards: { ALT_CORE_B_AX_01_C: 0 } }, 'source.cards'], [{ cards: { ALT_CORE_B_AX_01_C: 100 } }, 'source.cards'],
    [{ cards: { ALT_CORE_B_AX_01_C: 1501 } }, 'source.cards'],
    [{ heroPool: [] }, 'source.heroPool'], [{ heroPool: ['ALT_CORE_B_AX_04_U_1437'] }, 'source.heroPool'], [{ heroPool: 'x' }, 'source.heroPool'],
    [{ boosters: 2 }, 'source.boosters'], [{ boosters: 9 }, 'source.boosters'],
    [{ cardsPerBooster: 9 }, 'source.cardsPerBooster'], [{ cardsPerBooster: 17 }, 'source.cardsPerBooster'],
    [{ perFaction: 3 }, 'source.perFaction'], [{ perFaction: 2, cardsPerBooster: 11 }, 'source.perFaction'],
    [{ boosters: 3, cardsPerBooster: 10 }, 'source.poolSize'],
  ]
  for (const [over, code] of cases) expect(validateTournamentConfig(cube(over)).errors, JSON.stringify(over)).toEqual([code])
})
it('configSetCodes and legacyColumnsFromConfig on a cube', () => {
  const { config } = validateTournamentConfig(cube({ cards: { ALT_EOLE_B_AX_01_C: 1, ALT_CORE_B_AX_01_C: 1 }, heroPool: ['ALT_CYCLONE_B_AX_01_C'] }))
  expect(configSetCodes(config)).toEqual(['CORE', 'CYCLONE', 'EOLE'])
  expect(legacyColumnsFromConfig(config)).toEqual({ set_code: null, unique_count: 0, even_factions: false, heroes_in_pool: true, guaranteed_uniques: 0 })
})
```

In `tournamentRules.test.js`: `maxPlayers` absent / `null` / `''` → `values.maxPlayers === null` on create; `'8'` → `8`; `1`, `257`, `2.5`, `'x'`, `true` → `errors.maxPlayers === 'invalid_max_players'`; a patch without the key leaves `values.maxPlayers` undefined. In `tournamentForm.test.js`: a cube config with no cards → `[{ field: 'cube', code: 'required' }]`; `boosters: 3, cardsPerBooster: 10` → `[{ field: 'cubeSettings', code: 'source.poolSize' }]`; `heroPool: []` → `[{ field: 'heroPool', code: 'required' }]`; a valid cube with `maxPlayers: null` → `[{ field: 'maxPlayers', code: 'required_for_cube' }]`; with `capacity: { players: 1 }` → `[{ field: 'cube', code: 'source.capacity' }, …]` in `FIELD_ORDER` order; a set config with `maxPlayers: 2, poolCount: 3` → `[{ field: 'maxPlayers', code: 'below_pool_count' }]`.

- [ ] **Step 2: Run them to see them fail** — `npm test -- cubeSealed tournamentConfig tournamentRules tournamentForm` → the new tests fail (`cubeSealed.js` missing, `source.type` refused, `maxPlayers` ignored).
- [ ] **Step 3: Implement** `cubeSealed.js`; the `cube` branch in `validateTournamentConfig` (shape and range checks only, `toInt` per number; sort `cards` keys and `heroPool`; skip every uniques / ban-list check and force the normalized values); `maxPlayers` in `validateTournamentFields`; the issue mapping in `tournamentForm.js` (pass `source`, `maxPlayers: body.maxPlayers`, `capacity`, `poolCount` to `checkPlayerCap`; a locked form checks nothing of the config, as today).
- [ ] **Step 4: Run** — `npm test -- cubeSealed tournamentConfig tournamentRules tournamentForm poolBuilder.golden` → pass, snapshot unchanged.
- [ ] **Step 5: Commit**

```bash
git add src/lib/cubeSealed.js src/lib/cubeSealed.test.js src/lib/tournamentConfig.js src/lib/tournamentConfig.test.js src/lib/tournamentRules.js src/lib/tournamentRules.test.js src/lib/tournamentForm.js src/lib/tournamentForm.test.js
git commit -m "Tournament config: cube source, player cap field, cube capacity"
```

---

### Task 2: The dealer (pure) and its golden

**Files:**
- Modify: `src/lib/packGenerator.js`, `src/lib/poolBuilder.js`
- Create: `src/lib/cubeDeal.golden.test.js` (+ `src/lib/__snapshots__/cubeDeal.golden.test.js.snap`, written on first run)
- Test: `src/lib/packGenerator.test.js`, `src/lib/poolBuilder.test.js`

**Interfaces:**
- Produces (exported from `packGenerator.js`):
  - `dealCubeSlots({ cards, heroPool, slots, boosters, cardsPerBooster, perFaction, heroesInBoosters }, rng) → string[][][]` — `cards: { ref, faction }[]` (one per copy, from `expandCube`), rng order of spec §15.3 (per faction in `FACTIONS` order `shuffle(copies, rng)`; the stacks are cut by count, then `rest = shuffle(leftovers, rng)`; booster `s × boosters + i` = `perFaction` refs per faction in `FACTIONS` order, then `cardsPerBooster − 6 × perFaction` refs from `rest`; then, when `heroesInBoosters`, per slot `bag = shuffle(heroPool, rng)` and booster `i` gets `bag[i % bag.length]` prepended). Throws `Error('cube too small: <AX|…|total> <have>/<needed>')` when a stack is short, before any booster is built. A copy with `faction: null` goes to `rest` only.
  - `dealHeroSlots(packs, heroRefs, rng = Math.random)` — same behaviour, the shuffle takes `rng`.
- `buildPool` (`poolBuilder.js`) throws `Error('cube pools are dealt per tournament: poolStore.insertCappedPool')` when `config.source.type === 'cube'`, before any fetch.

- [ ] **Step 1: Write the failing tests** — in `packGenerator.test.js`, `describe('dealCubeSlots')` with `mulberry32` from `./prng.js` and a cube builder `cubeOf(perFaction = 10, extra = 0)` (10 copies per faction `ALT_CORE_B_<F>_<n>_C` plus `extra` faction-less copies `ALT_CORE_B_AX_<n>_U_<n>`):

```js
it('deals slots × boosters boosters of cardsPerBooster (+1 hero), every copy at most once', () => {
  const cards = cubeOf(10)                              // 60 copies
  const lots = dealCubeSlots({ cards, heroPool: ['H1', 'H2', 'H3'], slots: 2, boosters: 3, cardsPerBooster: 10, perFaction: 1, heroesInBoosters: true }, mulberry32(1))
  expect(lots).toHaveLength(2)
  for (const lot of lots) { expect(lot).toHaveLength(3); for (const b of lot) expect(b).toHaveLength(11) }
  const bodies = lots.flat().flatMap(b => b.slice(1))
  expect(new Set(bodies).size).toBe(bodies.length)       // every copy once (the refs are distinct in this cube)
  expect(bodies.every(r => cards.some(c => c.ref === r))).toBe(true)
})
it('guarantees perFaction cards of each faction at the front of every booster', () => {
  const lots = dealCubeSlots({ cards: cubeOf(12), heroPool: ['H1'], slots: 2, boosters: 2, cardsPerBooster: 14, perFaction: 2, heroesInBoosters: false }, mulberry32(2))
  for (const b of lots.flat()) expect(b.slice(0, 12).map(r => r.split('_')[3])).toEqual(['AX', 'AX', 'BR', 'BR', 'LY', 'LY', 'MU', 'MU', 'OR', 'OR', 'YZ', 'YZ'])
})
it('gives a lot distinct heroes until the pool is exhausted, independently per lot', () => {
  const lots = dealCubeSlots({ cards: cubeOf(20), heroPool: ['H1', 'H2', 'H3'], slots: 6, boosters: 5, cardsPerBooster: 10, perFaction: 0, heroesInBoosters: true }, mulberry32(3))
  for (const lot of lots) { expect(new Set(lot.slice(0, 3).map(b => b[0])).size).toBe(3); expect(lot[3][0]).toBe(lot[0][0]) }
  expect(new Set(lots.map(l => l.map(b => b[0]).join())).size).toBeGreaterThan(1)
})
it('is deterministic for a seed and throws, naming the short stack, before dealing', () => {
  const args = { cards: cubeOf(10), heroPool: ['H1'], slots: 2, boosters: 3, cardsPerBooster: 10, perFaction: 1, heroesInBoosters: true }
  expect(dealCubeSlots(args, mulberry32(7))).toEqual(dealCubeSlots(args, mulberry32(7)))
  expect(() => dealCubeSlots({ ...args, slots: 3 }, mulberry32(7))).toThrow('cube too small: total 60/90')
  const fewYz = args.cards.filter(c => c.faction !== 'YZ' || c.ref.endsWith('_1_C'))
  expect(() => dealCubeSlots({ ...args, cards: [...fewYz, ...cubeOf(0, 40)] }, mulberry32(7))).toThrow('cube too small: YZ 1/6')
})
it('dealHeroSlots takes an rng and keeps its default', () => {
  const packs = [['a'], ['b'], ['c']]
  expect(dealHeroSlots(packs, ['H1', 'H2'], mulberry32(1))).toEqual(dealHeroSlots(packs, ['H1', 'H2'], mulberry32(1)))
  expect(dealHeroSlots(packs, ['H1', 'H2']).map(p => p.length)).toEqual([2, 2, 2])
})
```

In `cubeDeal.golden.test.js`: `cubeOf`-style fixture with 3 heroes, `dealCubeSlots({ …, slots: 4, boosters: 6, cardsPerBooster: 12, perFaction: 1, heroesInBoosters: true }, mulberry32(42))`, `crypto.createHash('sha256').update(JSON.stringify(lots)).digest('hex')` → `toMatchSnapshot()` (the same digest style as `poolBuilder.golden.test.js`). In `poolBuilder.test.js`: `await expect(buildPool(SUB, { config: { source: { type: 'cube' } }, nonce: 'n' }, { fetchCards })).rejects.toThrow('cube pools are dealt per tournament')` and `fetchCards` not called.

- [ ] **Step 2: Run to see them fail** — `npm test -- packGenerator cubeDeal poolBuilder`.
- [ ] **Step 3: Implement** `dealCubeSlots`, the `rng` parameter of `dealHeroSlots`, the `buildPool` guard.
- [ ] **Step 4: Run** — `npm test -- packGenerator cubeDeal poolBuilder` → pass; the new snapshot is written on the first run (never `-u`); the six old digests unchanged.
- [ ] **Step 5: Commit**

```bash
git add src/lib/packGenerator.js src/lib/packGenerator.test.js src/lib/cubeDeal.golden.test.js src/lib/__snapshots__/cubeDeal.golden.test.js.snap src/lib/poolBuilder.js src/lib/poolBuilder.test.js
git commit -m "Pack generator: deal a cube into player lots, every copy once"
```

---

### Task 3: i18n keys (EN + FR)

**Files:**
- Modify: `src/lib/i18n/en.js`, `src/lib/i18n/fr.js`

Add, verbatim, in the `tournaments` block (after the V4 keys), plus the two keys of other blocks at the end. Plurals follow the file's `One` / `Many` convention (`tc`), `Zero` looked up by hand.

| Key | EN | FR |
| --- | --- | --- |
| `sourceCube` | `Cube` | `Cube` |
| `cubeHint` | `Every card of the cube is dealt at most once across all players. Pick a community cube, load your Re:Union decks, or paste a list.` | `Chaque carte du cube n’est distribuée qu’une seule fois, tous joueurs confondus. Choisissez un cube communautaire, chargez vos decks Re:Union ou collez une liste.` |
| `cubeCommunityTitle` | `Community cubes` | `Cubes communautaires` |
| `cubeCommunityHint` | `Curated card pools, ready to play.` | `Des pools de cartes sélectionnés, prêts à jouer.` |
| `cubeUse` | `Use this cube` | `Utiliser ce cube` |
| `cubePreview` | `Preview` | `Aperçu` |
| `cubeReunionTitle` | `Load from your Re:Union decks` | `Charger depuis vos decks Re:Union` |
| `cubeReunionHint` | `Tick one or several decks: several decks merge into one bigger cube.` | `Cochez un ou plusieurs decks : plusieurs decks fusionnent en un cube plus grand.` |
| `cubeReunionLoad` | `Load my decks` | `Charger mes decks` |
| `cubeReunionRefresh` | `Refresh` | `Actualiser` |
| `cubeReunionImportZero` | `Use the ticked decks` | `Utiliser les decks cochés` |
| `cubeReunionImportOne` | `Use {{n}} deck as the cube` | `Utiliser {{n}} deck comme cube` |
| `cubeReunionImportMany` | `Use {{n}} decks as the cube` | `Utiliser {{n}} decks comme cube` |
| `cubeReunionNone` | `No deck in your Re:Union account.` | `Aucun deck dans votre compte Re:Union.` |
| `cubeReunionNoCards` | `Those decks have no cards.` | `Ces decks n’ont aucune carte.` |
| `cubeReunionSearch` | `Search by name…` | `Rechercher par nom…` |
| `cubeReunionNoMatch` | `No deck matches.` | `Aucun deck ne correspond.` |
| `cubePasteTitle` | `Paste your own cube` | `Collez votre propre cube` |
| `cubePasteHint` | `One card per line as qty REF (e.g. 3 ALT_CORE_B_MU_06_R2), the Export format. Heroes in the list are set aside and preselected below.` | `Une carte par ligne au format qté REF (ex. 3 ALT_CORE_B_MU_06_R2), le format de l’Export. Les héros de la liste sont mis de côté et présélectionnés plus bas.` |
| `cubePasteName` | `Cube name (optional)` | `Nom du cube (facultatif)` |
| `cubePasteParse` | `Parse the list` | `Analyser la liste` |
| `cubePasteParsing` | `Parsing…` | `Analyse…` |
| `cubePasteNoRefs` | `No card reference found. Paste lines like "1 ALT_CORE_B_YZ_03_C".` | `Aucune référence trouvée. Collez des lignes comme « 1 ALT_CORE_B_YZ_03_C ».` |
| `cubePasteNoCards` | `No card resolved: check the references.` | `Aucune carte reconnue : vérifiez les références.` |
| `cubeLoadFailed` | `Could not load the card data: {{msg}}` | `Impossible de charger les données des cartes : {{msg}}` |
| `cubePastedName` | `Pasted cube` | `Cube collé` |
| `cubeDecksName` | `{{n}} decks` | `{{n}} decks` |
| `cubeChosenTitle` | `Chosen cube` | `Cube choisi` |
| `cubeNameLabel` | `Cube name` | `Nom du cube` |
| `cubeOriginCommunity` | `Community cube` | `Cube communautaire` |
| `cubeOriginReunion` | `From your Re:Union decks` | `Depuis vos decks Re:Union` |
| `cubeOriginPaste` | `Pasted list` | `Liste collée` |
| `cubeCountOne` | `{{n}} card ({{distinct}} distinct)` | `{{n}} carte ({{distinct}} distincte)` |
| `cubeCountMany` | `{{n}} cards ({{distinct}} distinct)` | `{{n}} cartes ({{distinct}} distinctes)` |
| `cubeHeroesFoundZero` | `no hero in the list` | `aucun héros dans la liste` |
| `cubeHeroesFoundOne` | `{{n}} hero found in the list, preselected below` | `{{n}} héros trouvé dans la liste, présélectionné plus bas` |
| `cubeHeroesFoundMany` | `{{n}} heroes found in the list, preselected below` | `{{n}} héros trouvés dans la liste, présélectionnés plus bas` |
| `cubeUnresolvedOne` | `{{n}} reference could not be resolved and is left out:` | `{{n}} référence n’a pas pu être reconnue et est écartée :` |
| `cubeUnresolvedMany` | `{{n}} references could not be resolved and are left out:` | `{{n}} références n’ont pas pu être reconnues et sont écartées :` |
| `cubeChange` | `Change cube` | `Changer de cube` |
| `cubeTooLarge` | `A cube holds at most {{n}} cards.` | `Un cube contient au plus {{n}} cartes.` |
| `errSelectCube` | `Choose a cube.` | `Choisissez un cube.` |
| `errCubeName` | `Give the cube a name (80 characters max).` | `Donnez un nom au cube (80 caractères max).` |
| `errCubeTooSmall` | `This cube cannot serve 2 players with these boosters ({{limit}}).` | `Ce cube ne peut pas servir 2 joueurs avec ces boosters ({{limit}}).` |
| `capacityLimitTotal` | `{{have}} cards, {{needed}} needed per player` | `{{have}} cartes, {{needed}} nécessaires par joueur` |
| `capacityLimitFaction` | `{{have}} {{faction}} cards, {{needed}} needed per player` | `{{have}} cartes {{faction}}, {{needed}} nécessaires par joueur` |
| `cubeBoostersTitle` | `Boosters` | `Boosters` |
| `cubeBoostersPerPlayer` | `Boosters per player` | `Boosters par joueur` |
| `cubeCardsPerBooster` | `Cards per booster` | `Cartes par booster` |
| `cubeCardsPerBoosterHint` | `Not counting the hero.` | `Héros non compris.` |
| `cubePerFactionLabel` | `Faction guarantee` | `Garantie par faction` |
| `cubePerFaction0` | `None` | `Aucune` |
| `cubePerFaction0Hint` | `Every card drawn at random from the cube.` | `Chaque carte tirée au hasard dans le cube.` |
| `cubePerFaction1` | `One of each faction` | `Une de chaque faction` |
| `cubePerFaction1Hint` | `Six cards, one per faction, then the rest at random.` | `Six cartes, une par faction, puis le reste au hasard.` |
| `cubePerFaction2` | `Two of each faction` | `Deux de chaque faction` |
| `cubePerFaction2Hint` | `Twelve cards, two per faction, then the rest at random (12 cards per booster at least).` | `Douze cartes, deux par faction, puis le reste au hasard (12 cartes par booster au minimum).` |
| `cubePoolLine` | `{{cards}} cards per player ({{boosters}} × {{perBooster}})` | `{{cards}} cartes par joueur ({{boosters}} × {{perBooster}})` |
| `cubePoolLineHero` | `, plus a hero in each booster` | `, plus un héros dans chaque booster` |
| `cubeRarityNote` | `Rarity plays no part: commons, rares and uniques of the cube are all dealt the same way. Every copy is given to one player at most.` | `La rareté ne joue pas : communes, rares et uniques du cube sont distribuées de la même façon. Chaque exemplaire n’est donné qu’à un seul joueur au plus.` |
| `errCubePoolSize` | `A player must receive at least 60 cards ({{n}} now): add boosters or cards per booster.` | `Un joueur doit recevoir au moins 60 cartes ({{n}} pour l’instant) : ajoutez des boosters ou des cartes par booster.` |
| `errCubePerFaction` | `Two of each faction needs at least 12 cards per booster.` | `Deux de chaque faction demande au moins 12 cartes par booster.` |
| `cubeHeroesTitle` | `Heroes` | `Héros` |
| `cubeHeroesPacks` | `In boosters` | `Dans les boosters` |
| `cubeHeroesPacksHint` | `One hero per booster, drawn from the selected heroes; a player’s boosters hold distinct heroes.` | `Un héros par booster, tiré parmi les héros sélectionnés ; les boosters d’un joueur ont des héros distincts.` |
| `cubeHeroesFree` | `Free choice` | `Choix libre` |
| `cubeHeroesFreeHint` | `Every selected hero goes into each player’s pool.` | `Chaque héros sélectionné va dans le pool de chaque joueur.` |
| `heroPoolLabel` | `Available heroes` | `Héros disponibles` |
| `heroPoolCountOne` | `{{n}} hero selected` | `{{n}} héros sélectionné` |
| `heroPoolCountMany` | `{{n}} heroes selected` | `{{n}} héros sélectionnés` |
| `heroPoolChoose` | `Choose heroes` | `Choisir les héros` |
| `heroPoolClose` | `Done` | `Terminé` |
| `heroPoolSearch` | `Search a hero…` | `Rechercher un héros…` |
| `heroPoolAll` | `All` | `Tous` |
| `heroPoolNone` | `None` | `Aucun` |
| `heroPoolLoading` | `Loading the heroes…` | `Chargement des héros…` |
| `heroPoolFromCube` | `The heroes found in the cube are preselected.` | `Les héros trouvés dans le cube sont présélectionnés.` |
| `errCubeNoHero` | `Select at least one hero.` | `Sélectionnez au moins un héros.` |
| `playersTitle` | `Players` | `Joueurs` |
| `maxPlayersLabel` | `Maximum players` | `Nombre maximum de joueurs` |
| `maxPlayersNoLimit` | `No limit` | `Sans limite` |
| `maxPlayersHint` | `Once reached, nobody else can open a pool, from this site or through a BGA game. Set the same limit on the BGA tournament.` | `Une fois atteint, personne d’autre ne peut ouvrir de pool, depuis ce site ou via une partie BGA. Mettez la même limite sur le tournoi BGA.` |
| `maxPlayersCubeHint` | `Required for a cube: it is dealt once into that many sets of boosters.` | `Obligatoire pour un cube : il est distribué une seule fois en autant de lots de boosters.` |
| `cubeCapacityLine` | `This cube allows up to {{n}} players with these boosters.` | `Ce cube permet jusqu’à {{n}} joueurs avec ces boosters.` |
| `cubeCapacityLimit` | `Limiting: {{limit}}.` | `Limite : {{limit}}.` |
| `cubeCapacityPending` | `Resolving the cube…` | `Résolution du cube…` |
| `errMaxPlayers` | `The maximum must be a whole number between 2 and 256.` | `Le maximum doit être un entier entre 2 et 256.` |
| `errMaxPlayersRequired` | `Set the maximum number of players.` | `Indiquez le nombre maximum de joueurs.` |
| `errMaxPlayersCapacity` | `At most {{n}} players with this cube and these boosters.` | `Au plus {{n}} joueurs avec ce cube et ces boosters.` |
| `errMaxPlayersBelowPools` | `{{n}} players already have a pool: the maximum cannot go below.` | `{{n}} joueurs ont déjà un pool : le maximum ne peut pas descendre en dessous.` |
| `errCubeUnresolved` | `Unknown references in the cube: {{refs}}` | `Références inconnues dans le cube : {{refs}}` |
| `summaryCube` | `{{n}} boosters of {{cards}} · cube “{{name}}” ({{total}} cards)` | `{{n}} boosters de {{cards}} · cube « {{name}} » ({{total}} cartes)` |
| `summaryPerFaction1` | `1 of each faction per booster` | `1 de chaque faction par booster` |
| `summaryPerFaction2` | `2 of each faction per booster` | `2 de chaque faction par booster` |
| `playersOf` | `{{n}} / {{max}} players` | `{{n}} / {{max}} joueurs` |
| `fullBadge` | `Full` | `Complet` |
| `fullBadgeTitle` | `Every place is taken` | `Toutes les places sont prises` |
| `step2Full` | `This tournament is full: {{max}} players already have a pool.` | `Ce tournoi est complet : {{max}} joueurs ont déjà un pool.` |
| `cubeLink` | `View the cube ({{n}} cards) →` | `Voir le cube ({{n}} cartes) →` |
| `cubePageTitle` | `Cube` | `Cube` |
| `cubePageOf` | `Cube of “{{name}}”` | `Cube de « {{name}} »` |
| `cubePageHeroesTitle` | `Available heroes ({{n}})` | `Héros disponibles ({{n}})` |
| `cubePageHeroesPacks` | `One of them in each booster.` | `Un d’entre eux dans chaque booster.` |
| `cubePageHeroesFree` | `All of them in every pool, free choice.` | `Tous dans chaque pool, au choix.` |
| `packReveal.cubeBooster` | `Cube “{{name}}”` | `Cube « {{name}} »` |
| `tournamentPoolView.cubeLink` | `Cube` | `Cube` |

Also reword `lockedNotice` to `Cards, settings, the player cap and the BGA link are locked: pools already exist.` / `Cartes, réglages, nombre maximum de joueurs et lien BGA sont verrouillés : des pools existent déjà.` and `errLocked` likewise (`Pools already exist: cards, settings, the player cap and the BGA link can no longer change.`).

- [ ] **Step 1: Add the keys** in both files, same order.
- [ ] **Step 2: Verify** — `node -e "import('./src/lib/i18n/en.js').then(async en => { const fr = await import('./src/lib/i18n/fr.js'); const a = Object.keys(en.default.tournaments), b = Object.keys(fr.default.tournaments); console.log(a.filter(k => !b.includes(k)), b.filter(k => !a.includes(k))) })"` → `[] []` (adapt the default-export access to the files' export). `npm run build` passes.
- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/en.js src/lib/i18n/fr.js
git commit -m "i18n: cube sealed and player cap strings (EN, FR)"
```

---

### Task 4: Schema, store, `maxPlayers` through the API

**Files:**
- Modify: `sealed-pools-schema.sql`, `src/lib/tournamentStore.js`, `api/tournaments/index.js`, `api/tournaments/[id].js`
- Test: `tests/integration/tournaments.test.js`

**Interfaces:**
- Consumes: `validateTournamentFields` → `values.maxPlayers` (Task 1), `checkPlayerCap` (Task 1).
- Produces:
  - Schema, appended idempotently: `alter table tournaments add column if not exists max_players int check (max_players between 2 and 256);` `create table if not exists tournament_cube_slots (tournament_ref uuid not null references tournaments(id) on delete cascade, slot int not null, boosters jsonb not null, dealt_at timestamptz not null default now(), primary key (tournament_ref, slot));` `alter table sealed_pools add column if not exists cube_slot int;` `create unique index if not exists sealed_pools_one_pool_per_cube_slot on sealed_pools (tournament_ref, cube_slot) where cube_slot is not null;`
  - `createTournament({ …, maxPlayers = null })` inserts `max_players`; `COLUMN_OF.maxPlayers = 'max_players'`; `toTournamentJson` adds `maxPlayers: row.max_players ?? null`; `detachTournament` runs `DELETE FROM tournament_cube_slots WHERE tournament_ref = $1` before deleting the pools.
  - POST: `maxPlayers: fields.values.maxPlayers` passed to `createTournament`; for a non-cube source `checkPlayerCap({ source: finalConfig.source, maxPlayers, poolCount: 0 })` (nothing to refuse, kept for symmetry). The cube branch is Task 5b's.
  - PATCH: `maxPlayers` sent on a non-cube effective source (`fields.config?.source ?? row.config.source`) → `checkPlayerCap({ source, maxPlayers: validated.values.maxPlayers, poolCount: await countPoolsForTournament(row.id) })` → 400 `{ error: 'invalid_request', fields: { maxPlayers: 'below_pool_count' } }`; the cube lock is Task 5b's. `fields.maxPlayers` goes through `updateTournament`.

- [ ] **Step 1: Write the failing tests** — `describe('V5: player cap (schema and field)')` in `tournaments.test.js`:

```js
it('has max_players, tournament_cube_slots and cube_slot', ...)         // information_schema: the column with its check, the table's primary key, the partial unique index
it('createTournament stores maxPlayers and toTournamentJson returns it, null by default', ...)
it('POST accepts maxPlayers 2..256, refuses 1, 257 and "x" with invalid_max_players, stores null when absent', ...)
it('PATCH raises, lowers to the pool count and clears maxPlayers on a set tournament; refuses below the pool count', ...)
   // 3 pools via getOrCreateTournamentPool, PATCH { maxPlayers: 2 } → 400 fields.maxPlayers 'below_pool_count'; { maxPlayers: 3 } → 200; { maxPlayers: null } → 200 null; on a cancelled tournament → 200; detached → 409 tournament_detached
it('detachTournament deletes the tournament_cube_slots rows', ...)          // insert two slot rows by SQL, detach, count = 0
```

- [ ] **Step 2: Run** — `npm run test:integration` (Docker up) → the new ones fail.
- [ ] **Step 3: Implement** the schema, the store and the two handlers.
- [ ] **Step 4: Run** — `npm run test:integration` → pass.
- [ ] **Step 5: Commit**

```bash
git add sealed-pools-schema.sql src/lib/tournamentStore.js api/tournaments/index.js api/tournaments/[id].js tests/integration/tournaments.test.js
git commit -m "Tournaments: player cap column, cube slot table, maxPlayers through the API"
```

---

### Task 5a: The cube resolver (server-safe), the synthetic-unique flag

**Files:**
- Create: `src/lib/cubeSource.js`, `src/lib/cubeSource.test.js`
- Modify: `src/lib/cardData.js` (`fetchUnique`'s synthetic fallback only), `src/lib/cardData.test.js`

**Interfaces:**
- Produces (`cardData.js`): the synthetic card `fetchUnique` falls back to (after the retries and the bundled snapshot) carries `synthetic: true`; nothing else changes (the bundled snapshot and live cards have no such key).
- Produces (`cubeSource.js`, isomorphic: no server-only import):
  - `resolveRefs(refs, { fetchSet = cardData.fetchSet, fetchUniques = cardData.fetchUniques, lang = 'EN' } = {}) → Promise<{ byRef: Map<string, { ref: string, card: object }>, unresolved: string[] }>` — spec §15.2 "Resolving a ref": for each distinct given ref, `canon = canonicalCardRef(given)`; the sets of the canon refs that `SETS` knows are fetched once each (`fetchSet(code, lang)` in a loop, never `.map(fetchSet)`); a canon found in its set's data → `{ ref: canon, card }`; else, when `needsCardApi(given)` (a unique or a non-`B` printing), the given ref joins one `fetchUniques(list, lang)` call and a returned card without `synthetic: true` → `{ ref: given, card }`; anything else → `unresolved` (the given ref, in input order, distinct). A ref of a set `SETS` does not know is unresolved without a fetch. Never throws on a missing ref; a `fetchSet` failure on a known set throws (transient).
  - `resolveCubeSource(source, deps) → Promise<{ cards: { ref, qty, faction, cardType }[], heroes: { ref, faction, cardType }[], unresolved: string[], heroesInCards: string[], nonHeroesInPool: string[], stored: { cards: { ref: qty }, heroPool: string[] } }>` — `source` is a validated cube source. `cards` and `heroes` carry the **stored** ref (`byRef.get(given).ref`), `cards` in key order with the quantities of two given refs that map to one stored ref merged; `stored` = the source re-keyed that way (`heroPool` sorted, distinct); `heroesInCards` = `cards` refs whose `cardType === 'HERO'`; `nonHeroesInPool` = `heroPool` refs whose `cardType !== 'HERO'`.

- [ ] **Step 1: Write the failing tests** — in `cardData.test.js`: with `fetch` mocked to fail, `fetchUnique('ALT_CORE_B_AX_04_U_999999999')` resolves a card with `synthetic: true`; a bundled unique (`UNIQUES_EN`'s first ref) resolves without the key. In `cubeSource.test.js`, fakes `fetchSet = vi.fn(async code => code === 'CORE' ? [hero('ALT_CORE_B_AX_01_C'), card('ALT_CORE_B_AX_02_C', 'AX'), card('ALT_CORE_B_YZ_45_R2', 'AX')] : code === 'BISE' ? [card('ALT_BISE_B_BR_01_C', 'BR')] : [])`, `fetchUniques = vi.fn(async refs => refs.map(r => r === 'ALT_CORE_B_AX_04_U_1437' ? unique(r, 'AX') : r === 'ALT_BISE_P_BR_64_C' ? card(r, 'BR') : { reference: r, faction: 'XX', cardType: '', synthetic: true }))`:

```js
it('resolveRefs: canonical B when it exists, by reference otherwise, unresolved as given', async () => {
  const r = await resolveRefs(['ALT_CORE_A_AX_02_C', 'ALT_CORE_B_AX_02_C', 'ALT_BISE_P_BR_64_C', 'ALT_CORE_B_AX_04_U_1437', 'ALT_CORE_B_AX_99_C', 'ALT_NOPE_B_AX_01_C', 'ALT_CORE_B_AX_04_U_999999999'], { fetchSet, fetchUniques })
  expect(r.byRef.get('ALT_CORE_A_AX_02_C').ref).toBe('ALT_CORE_B_AX_02_C')          // alt-art → its B twin
  expect(r.byRef.get('ALT_BISE_P_BR_64_C').ref).toBe('ALT_BISE_P_BR_64_C')          // promo-only → kept, fetched by reference
  expect(r.byRef.get('ALT_CORE_B_AX_04_U_1437').card.faction).toBe('AX')
  expect(r.unresolved).toEqual(['ALT_CORE_B_AX_99_C', 'ALT_NOPE_B_AX_01_C', 'ALT_CORE_B_AX_04_U_999999999'])
  expect(fetchSet).toHaveBeenCalledTimes(2)                                           // CORE, BISE; NOPE never
  expect(fetchUniques).toHaveBeenCalledTimes(1)
  expect(fetchUniques.mock.calls[0][0]).toEqual(['ALT_BISE_P_BR_64_C', 'ALT_CORE_B_AX_04_U_1437', 'ALT_CORE_B_AX_04_U_999999999'])
})
it('resolveCubeSource: real factions, merged quantities, the stored source, the unresolved list', async () => {
  const r = await resolveCubeSource({ cards: { ALT_CORE_B_AX_02_C: 2, ALT_CORE_A_AX_02_C: 1, ALT_CORE_B_YZ_45_R2: 1, ALT_BISE_P_BR_64_C: 1, ALT_CORE_B_AX_04_U_1437: 1, ALT_CORE_B_AX_99_C: 1 }, heroPool: ['ALT_CORE_B_AX_01_C'] }, { fetchSet, fetchUniques })
  expect(r.cards.map(c => [c.ref, c.qty, c.faction])).toEqual([['ALT_CORE_B_AX_02_C', 3, 'AX'], ['ALT_CORE_B_YZ_45_R2', 1, 'AX'], ['ALT_BISE_P_BR_64_C', 1, 'BR'], ['ALT_CORE_B_AX_04_U_1437', 1, 'AX']])
  expect(r.stored).toEqual({ cards: { ALT_CORE_B_AX_02_C: 3, ALT_CORE_B_YZ_45_R2: 1, ALT_BISE_P_BR_64_C: 1, ALT_CORE_B_AX_04_U_1437: 1 }, heroPool: ['ALT_CORE_B_AX_01_C'] })
  expect(r.heroes).toEqual([{ ref: 'ALT_CORE_B_AX_01_C', faction: 'AX', cardType: 'HERO' }])
  expect(r.unresolved).toEqual(['ALT_CORE_B_AX_99_C'])
})
it('flags a hero among the cards and a non-hero in the hero pool', async () => {
  const r = await resolveCubeSource({ cards: { ALT_CORE_B_AX_01_C: 1 }, heroPool: ['ALT_CORE_B_AX_02_C'] }, { fetchSet, fetchUniques })
  expect(r.heroesInCards).toEqual(['ALT_CORE_B_AX_01_C']); expect(r.nonHeroesInPool).toEqual(['ALT_CORE_B_AX_02_C'])
})
```

- [ ] **Step 2: Run to see them fail** — `npm test -- cubeSource cardData`.
- [ ] **Step 3: Implement** the flag and the resolver.
- [ ] **Step 4: Run** — `npm test -- cubeSource cardData` → pass.
- [ ] **Step 5: Commit**

```bash
git add src/lib/cubeSource.js src/lib/cubeSource.test.js src/lib/cardData.js src/lib/cardData.test.js
git commit -m "Cube source: resolve a stored cube into card objects, flag synthetic uniques"
```

---

### Task 5: Pool creation under the cap, the deal, 409 `tournament_full`

**Files:**
- Modify: `src/lib/poolStore.js`, `api/tournaments/[id]/pool.js`, `api/tournament-bga-decklist.js`, `api/tournament-pool-counts.js`, `api/_lib/tournamentPool.js`
- Create: `tests/integration/cube-pools.test.js` (same mocks and helpers as `tournaments.test.js`: copy its `vi.mock` blocks, `mkTournament`, `call`, `mockRes`, `asUser`; the `buildPool` mock is unchanged, the cube path never calls it; the `cardData` mock's `fetchSet` must return, for the test cube's set, the refs the tests use: 6 heroes `ALT_TEST_B_<F>_01_C` and 20 cards per faction `ALT_TEST_B_<F>_<n>_C` with `faction` set, `fetchUniques` → `[]`; `SETS` must know `TEST`: mock `SETS` too, or use `CYCLONE` refs)

**Interfaces:**
- Consumes: `dealCubeSlots`, `expandCube` (Tasks 1–2), `resolveCubeSource` (Task 5a), `withTransaction` (`db.js`), `hashSeed` / `mulberry32` (`prng.js`).
- Produces:
  - `poolStore.js`: `getOrCreateTournamentPool` routes the insert to `insertCappedPool(sub, { config, tournament, createdBy })` when `tournament.max_players != null`, else to `insertPool` (unchanged); the adoption step before it is untouched (never refused by the cap, spec §15.2 "Full"). `insertCappedPool` is spec §15.3 verbatim: resolve (cube; a non-empty `unresolved` → throw `codedError('cube_unresolved', …)`) or build (other) **before** `withTransaction`; inside: `FOR UPDATE` on the row with the same four conditions as `insertPool`'s `FOR SHARE` (null → return null); `count(*)` of **every** pool of the tournament (adopted ones included) `>= max_players` → throw `codedError('tournament_full', …)`; cube: deal `max_players` lots when `tournament_cube_slots` is empty (`dealCubeSlots({ cards: expandCube(resolved.cards), heroPool: source.heroPool, slots: row.max_players, boosters, cardsPerBooster, perFaction, heroesInBoosters: config.heroes === 'packs' }, mulberry32(hashSeed(`${row.id}|cube|${nonce}`)))`, one `INSERT` per lot), claim the lowest free slot (the `NOT EXISTS` query of §15.3; none → `tournament_full`), `cards` = counts of the lot's refs + `heroPool` × 1 when `heroes === 'free'`, `boosters` = the lot; the `INSERT INTO sealed_pools` of `insertPool` with a `cube_slot` column (null for other sources), through `q`. The thrown error has `code: 'tournament_full'`.
  - `api/tournaments/[id]/pool.js`: `e.code === 'tournament_full'` → 409 `{ error: 'tournament_full', maxPlayers: row.max_players }`; `e.code === 'cube_unresolved'` → 409 `{ error: 'pool_unavailable' }`. `tournament-bga-decklist.js` and `tournament-pool-counts.js`: 409 `{ error: 'tournament_full' }` and 409 `{ error: 'pool_unavailable' }` for `cube_unresolved` (next to the two existing codes).
  - `poolResponse`: `...(poolRow.config?.source?.type === 'cube' ? { cube: { name: poolRow.config.source.name, cardCount: Σ Object.values(poolRow.config.source.cards) } } : {})`.
  - `buildCardMap(refs)` (`api/_lib/tournamentPool.js`): the by-reference pass covers `refs.filter(r => needsCardApi(r) && !map[r])` (uniques **and** non-`B` printings), not only `isUniqueRef`, so a cube pool's random deck and name reconciliation see every card.

- [ ] **Step 1: Write the failing tests** — `cube-pools.test.js`, with `CUBE_CONFIG` (a validated cube config over the mocked set: 120 cards, 6 heroes, `boosters: 3, cardsPerBooster: 10, perFaction: 1`, `heroes: 'packs'`) and `mkCube = over => mkTournament({ config: CUBE_CONFIG, maxPlayers: 3, ...over })`:

```js
it('the first pool deals max_players lots, every copy once across the lots, and takes slot 0', ...)
   // getOrCreateTournamentPool('alice', t) → row.cube_slot 0; SELECT count(*) FROM tournament_cube_slots = 3; every lot 3 boosters of 11; slot 0 of each booster ∈ heroPool; the union of the lots' bodies has no duplicate and ⊆ CUBE_CONFIG.cards with qty respected; row.cards = counts of its boosters; row.boosters = lot 0
it('later pools take the next free slots and nobody re-deals', ...)         // bob → 1, carol → 2; slots count still 3; the three pools' bodies are disjoint
it('free heroes: every hero of the pool in cards, none in the boosters', ...)
it('the (max + 1)-th pool is refused with tournament_full, an existing pool is still returned', ...)
   // dave → rejects code 'tournament_full'; alice again → her row
it('three creators racing for a cap of 2 end with two pools and one tournament_full', async () => {
  const t = await mkCube({ maxPlayers: 2 })
  const results = await Promise.allSettled(['a', 'b', 'c'].map(s => getOrCreateTournamentPool(s, t)))
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(2)
  expect(results.find(r => r.status === 'rejected').reason.code).toBe('tournament_full')
  expect((await query('SELECT count(*)::int AS n FROM sealed_pools WHERE tournament_ref = $1', [t.id])).rows[0].n).toBe(2)
})
it('a set tournament with a cap: insertCappedPool enforces it; without a cap insertPool is untouched', ...)
   // mkTournament({ maxPlayers: 1 }) → second player tournament_full; mkTournament() → three players fine
it('an adopted legacy pool is never refused by the cap and counts towards it', ...)
   // a legacy pool bound to the BGA id (insert by SQL as tournaments.test.js's adoption tests do), cap 1 → adoption 200 (no cube_slot), then a new player tournament_full
it('a synthetic unique at deal time refuses the first pool with cube_unresolved, nothing is dealt', ...)
   // vi.mocked(fetchUniques) returning { synthetic: true } → rejects code 'cube_unresolved'; tournament_cube_slots empty; sealed_pools empty
it('GET /api/tournaments/:id/pool answers 409 tournament_full with maxPlayers; the BGA endpoints 409 tournament_full', ...)
it('poolResponse carries sourceType cube and cube { name, cardCount }', ...)
it('the BGA path on a cube tournament creates a slot pool and mints a deck from it', ...)   // as the existing BGA-path test, then every deck ref ∈ pool.cards
it('a config edit racing the first pool: the pool is built from the committed config or refused', ...) // mirrors tournaments.test.js's race test with a delay injected in resolveCubeSource (vi.mock cubeSource)
```

- [ ] **Step 2: Run** — `npm run test:integration` → the new file fails (no `insertCappedPool`).
- [ ] **Step 3: Implement** `insertCappedPool`, the routing, the three handlers, `poolResponse.cube`.
- [ ] **Step 4: Run** — `npm run test:integration` → pass (the old file too).
- [ ] **Step 5: Commit**

```bash
git add src/lib/poolStore.js api/tournaments/[id]/pool.js api/tournament-bga-decklist.js api/tournament-pool-counts.js api/_lib/tournamentPool.js tests/integration/cube-pools.test.js
git commit -m "Tournament pools: deal a cube once into slots, enforce the player cap, 409 tournament_full"
```

---

### Task 5b: Cube checks on POST and PATCH, the cube lock

**Files:**
- Create: `api/_lib/cubeChecks.js`
- Modify: `api/tournaments/index.js`, `api/tournaments/[id].js`, `server/index.js` (`express.json({ limit: '1mb' })`: a maximal cube config is about 45 KB, the default limit is 100 KB)
- Create: `tests/integration/cube-config.test.js` (same setup as Task 5's file)

**Interfaces:**
- Consumes: `resolveCubeSource` (Task 5a), `cubeCapacity`, `checkPlayerCap` (Task 1).
- Produces: `checkCubeConfig(config, { maxPlayers }) → Promise<{ refused: { status: 400, body } } | { config }>` in `api/_lib/cubeChecks.js`: for a non-cube config returns `{ config }` at once; otherwise resolves (`resolveCubeSource`), then `unresolved.length` → refused `{ error: 'invalid_request', config: ['source.cards.unresolved' and/or 'source.heroPool.unresolved'], unresolved }`; `heroesInCards.length` → `config: ['source.cards']`; `nonHeroesInPool.length` → `config: ['source.heroPool']`; else `capacity = cubeCapacity({ cards: resolved.cards, …source })` and `checkPlayerCap({ source, maxPlayers, capacity })` → refused `{ error: 'invalid_request', fields, config, capacity }` when either is non-empty; else `{ config: { ...config, source: { ...config.source, ...resolved.stored } } }` (the source re-keyed by stored forms, what gets stored).
  - POST (`index.js`): after the legacy check (an imposed config skips the cube checks), `const checked = await checkCubeConfig(finalConfig, { maxPlayers: fields.values.maxPlayers })` → `checked.refused` ⇒ `res.status(400).json(checked.refused.body)`, else `createTournament({ …, config: checked.config })`.
  - PATCH (`[id].js`): `effectiveSource = fields.config?.source ?? row.config.source`; `touchesLocked` also when `body.maxPlayers !== undefined && effectiveSource.type === 'cube'`; when `fields.config` is a cube or (`maxPlayers` sent and the stored source is a cube): `checkCubeConfig(fields.config ?? row.config, { maxPlayers: validated.values.maxPlayers ?? row.max_players })` → 400 when refused, else `fields.config = checked.config` when a config was sent.

- [ ] **Step 1: Write the failing tests** — `cube-config.test.js` (`cubeBody = over => ({ name: 'Commons', bgaUrl: …, startsAt: inDays(2).toISOString(), maxPlayers: 3, config: CUBE_INPUT, ...over })`, the cards API mocked as in Task 5):

```js
it('POST stores a cube tournament with its cap and the forced uniques', ...)          // 201, config.source.type 'cube', uniques zeroed, maxPlayers 3
it('POST stores an alt-art ref as its B twin and keeps a promo-only ref as given', ...) // mocked fetchUniques answering the P ref; stored cards keys
it('POST refuses an unresolved ref with the list', ...)                               // 400 config ['source.cards.unresolved'], unresolved ['ALT_TEST_B_AX_99_C']
it('POST refuses a hero among the cards and a non-hero in the hero pool', ...)
it('POST refuses a cube without a cap, above the capacity, and a cube below 2 players', ...) // fields.maxPlayers 'required_for_cube' / 'above_capacity' + capacity.players; config ['source.capacity']
it('PATCH a cube cap while unlocked, 409 tournament_locked once a pool exists', ...)
it('PATCH switching a set tournament to a cube runs the cube checks against the sent or stored cap', ...)
```

- [ ] **Step 2: Run** — `npm run test:integration` → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — `npm run test:integration` → pass.
- [ ] **Step 5: Commit**

```bash
git add api/_lib/cubeChecks.js api/tournaments/index.js api/tournaments/[id].js server/index.js tests/integration/cube-config.test.js
git commit -m "Tournaments API: verify a cube's refs and capacity, lock a cube's cap with its config"
```

---

### Task 6: `CubePicker`, `HeroPicker`, the client resolvers

**Files:**
- Create: `src/components/CubePicker.jsx`, `src/components/HeroPicker.jsx`, `src/lib/heroCatalog.js`, `src/lib/heroCatalog.test.js`
- Modify: `src/lib/cubeResolve.js`

**Interfaces:**
- Consumes: `COMMUNITY_CUBES` (`cubes.js`), `parseDecklist`, `listDecks` / `getDeck` / `deckCardsToRefs` (`decks.js`), `useAuth`, `useLang`, `CubePreviewModal`, `FACTION_ICONS`, `SET_ABBREV`, the Task 3 keys.
- Produces:
  - `resolveCubeCards(rawRefs, lang = 'EN') → Promise<{ cards: { ref, qty, faction, cardType, name }[], heroes: { ref, faction, name }[], unresolved: string[] }>` in `cubeResolve.js`, built on Task 5a's `resolveRefs` (`ref` = the stored form; duplicates and two given refs that map to one stored ref folded into `qty`; the heroes split out by `cardType`; `unresolved` as `resolveRefs` lists it). The picker always calls it with `'EN'` for the card data (the preview and the pool page do the same; the e2e fixtures are EN only), whatever the UI language. `resolveCubeRefs` stays as it is (the Lobby).
  - `loadAllHeroes(lang = 'EN') → Promise<{ ref, name, faction, set }[]>` in `heroCatalog.js`: every `cardType === 'HERO'`, `rarity !== 'U'` card of every visible set (`fetchSet` per set, one loop), deduplicated by `reference`, sorted by faction (`FACTIONS` order) then name; memoized per lang.
  - `<CubePicker value onChange disabled lang />`: `value` = `null | { name, origin, cubeId, cards, heroesFound, unresolved, resolved: true }` (`cards` / `heroesFound` as `resolveCubeCards` returns them, `heroesFound` = its `heroes`). `onChange(next)` with that shape or `null` ("Change cube"). Three panels as spec §15.2 "Cube tab" when `value` is null; the chosen-cube card otherwise (name input `data-testid="cube-name"` → `onChange({ ...value, name })`; origin; `tc('tournaments.cubeCount', total, { n: total, distinct })` in `cube-count`; six `cube-faction-<F>` counts; `cube-unresolved` (first 8 refs, `… (+N)`); `cube-preview` → `CubePreviewModal` with `{ name, author: origin label, cardCount, refs: expanded cards ++ heroesFound refs }`; `cube-change`). A community cube: `resolveCubeCards([...cube.refs, ...cube.heroes])` with `name = cube.name`, `origin 'community'`, `cubeId = cube.id`. Re:Union: the Lobby's flow (`listDecks`, search `cube-reunion-search`, format chips, tick `cube-reunion-deck-<id>`, `cube-reunion-import`), `name` = the deck's name or `t('tournaments.cubeDecksName', { n })`. Paste: `cube-paste-name`, `cube-paste-text`, `cube-paste-parse`; `name` = the typed name or `t('tournaments.cubePastedName')`. Disabled: every control disabled, the chosen card still shows Preview.
  - `<HeroPicker value onChange preselected disabled lang />`: `value: string[]`; closed state `hero-pool-count` (`tc('tournaments.heroPoolCount', n)`) + `hero-pool-open` ("Choose heroes"); open: `hero-pool-search`, one group per faction in `FACTIONS` order with the faction icon, `n / total`, `hero-faction-all-<F>` / `hero-faction-none-<F>`, chips `hero-chip-<REF>` (`aria-pressed`, the name and `SET_ABBREV`), `hero-pool-close`; `heroPoolLoading` while `loadAllHeroes` runs; the hint `heroPoolFromCube` when `preselected.length`. The search filters by name (case-insensitive) without changing the selection.

- [ ] **Step 1: Write the failing test** for the pure part — `heroCatalog.test.js` with a mocked `fetchSet` (`vi.mock('./cardData.js')` keeping `SETS` / `FACTIONS`): two sets each with one hero per faction plus a duplicate reference and a unique hero → `loadAllHeroes()` returns 12 heroes, no duplicate, no unique, `FACTIONS` order then name; a second call does not call `fetchSet` again.
- [ ] **Step 2: Run** — `npm test -- heroCatalog` → fail.
- [ ] **Step 3: Implement** `heroCatalog.js`, `resolveCubeCards`, `HeroPicker.jsx`, `CubePicker.jsx` (no unit layer for components in this repo; Task 13's `@cu-a-*` and `@cu-b-heroes` pin them).
- [ ] **Step 4: Run** — `npm test -- heroCatalog cubeParser`, `npm run build`.
- [ ] **Step 5: Commit**

```bash
git add src/components/CubePicker.jsx src/components/HeroPicker.jsx src/lib/heroCatalog.js src/lib/heroCatalog.test.js src/lib/cubeResolve.js
git commit -m "Tournament form: cube picker (community, Re:Union decks, paste) and hero picker"
```

---

### Task 7: The form — Cube tab, cube settings, the cap

**Files:**
- Create: `src/components/TournamentCubeSettings.jsx`, `src/components/MaxPlayersField.jsx`
- Modify: `src/components/TournamentCardsSource.jsx`, `src/pages/TournamentForm.jsx`

**Interfaces:**
- Consumes: Task 6's components and `resolveCubeCards`, Task 1's `cubeCapacity` / `CUBE_LIMITS` / `tournamentFormIssues` inputs, Task 3's keys, `Stepper`, `FACTION_NAMES`.
- Produces:
  - `TournamentCardsSource` gains the tab `['cube', 'sourceCube']` and the props `cube, onCube, lang`: the cube tab renders the `cubeHint` paragraph and `<CubePicker value={cube} onChange={onCube} disabled={disabled} lang={lang} />`.
  - `<MaxPlayersField value onChange required capacity disabled resolving />`: label `maxPlayersLabel`, `<input type="number" id="tn-max-players" data-testid="max-players" min={2} max={capacity?.players ?? 256}>`, placeholder `maxPlayersNoLimit` when not required, the hint (`maxPlayersCubeHint` + `maxPlayersHint` when required, `maxPlayersHint` otherwise), and when `capacity`: `max-players-capacity` = `cubeCapacityLine { n }` or `errCubeTooSmall { limit }` under 2, `max-players-limit` = `cubeCapacityLimit { limit }` with `limit` = `capacityLimitTotal { have, needed }` or `capacityLimitFaction { have, needed, faction: FACTION_NAMES[by] }`; `cubeCapacityPending` while `resolving`.
  - `<TournamentCubeSettings settings onSettings heroes onHeroes heroPool onHeroPool cubeHeroes disabled lang />` (the Players block is rendered by the form after it, so both branches share `MaxPlayersField`): the Boosters block (`cube-boosters` / `cube-cards-per-booster` Steppers with `CUBE_LIMITS` bounds, `cube-per-faction-0|1|2` option cards, the third disabled with `errCubePerFaction` as its hint when `cardsPerBooster < 12`, `cube-pool-line` = `cubePoolLine` + `cubePoolLineHero` when `heroes === 'packs'`, `cubeRarityNote`), the Heroes block (`hero-mode-packs` / `hero-mode-free` option cards in the style of `SettingsFields`, then `<HeroPicker value={heroPool} onChange={onHeroPool} preselected={cubeHeroes} />` under `id="tn-hero-pool"`).
  - `TournamentForm.jsx`: state `cube` (null), `cubeSettings` (`{ boosters: 7, cardsPerBooster: 12, perFaction: 1 }`), `heroPool` (`[]`), `maxPlayers` (`''`); `isCube = sourceType === 'cube'`; choosing a cube (`onCube` with a non-null value whose `cards` differ from the previous) sets `heroPool` to its `heroesFound` refs; `capacity = isCube && cube?.resolved ? cubeCapacity({ cards: cube.cards, ...cubeSettings }) : null`; the prefill rule: whenever `capacity` changes and (`maxPlayers === ''` or `Number(maxPlayers) > capacity.players`) → `setMaxPlayers(capacity.players)`; config for a cube = `{ v: 1, format: 'sealed', source: { type: 'cube', name: cube?.name ?? '', origin: cube?.origin ?? 'paste', cubeId: cube?.cubeId ?? null, cards: Object.fromEntries(cube.cards.map(c => [c.ref, c.qty])) (or {}), heroPool, ...cubeSettings }, heroes, uniques: zeroed, excludeBanlist: false }`; `body.maxPlayers = maxPlayers === '' ? null : Number(maxPlayers)`; `tournamentFormIssues({ …, capacity, poolCount })` (`poolCount` from the loaded tournament in edit mode, 0 on create); `issueMessage`: `cube` → `errSelectCube` / `errCubeName` / `errCubeTooSmall { limit }`; `cubeSettings` → `errCubePoolSize { n: boosters × cardsPerBooster }` / `errCubePerFaction` / `errGeneric`; `heroPool` → `errCubeNoHero`; `maxPlayers` → `errMaxPlayers` / `errMaxPlayersRequired` / `errMaxPlayersCapacity { n }` / `errMaxPlayersBelowPools { n: poolCount }`; `FIELD_DOM_ID` / `FIELD_LABEL_KEY` for the four fields (`tn-cards`, `tn-cube-boosters`, `tn-hero-pool`, `tn-max-players`; labels `sectionCards`, `cubeBoostersTitle`, `heroPoolLabel`, `maxPlayersLabel`); the Settings section renders `<TournamentCubeSettings …>` instead of `SettingsFields` + `TournamentUniqueFields` when `isCube`, and `<MaxPlayersField required={isCube} capacity={capacity} resolving={isCube && !!cube && !cube.resolved} disabled={(isCube && configFrozen) || saving} />` under a `playersTitle` heading in both branches; the draft adds `cube`, `cubeSettings`, `heroPool`, `maxPlayers`; edit prefill of a cube source: `setSourceType('cube')`, `setCube({ name, origin, cubeId, cards: Object.entries(cards).map(([ref, qty]) => ({ ref, qty, faction: null, cardType: null })), heroesFound: [], unresolved: [], resolved: false })`, `setCubeSettings({ boosters, cardsPerBooster, perFaction })`, `setHeroPool(src.heroPool)`, `setMaxPlayers(tn.maxPlayers ?? '')`, then when `!tn.locked` → `resolveCubeCards(Object.keys(cards))` → `setCube(prev => ({ ...prev, cards: resolved.cards, resolved: true }))`; every source prefills `maxPlayers`; the server 400 handler maps `err.data.config` codes through `issueMessage` too (`source.cards.unresolved` → `errCubeUnresolved { refs: err.data.unresolved.join(', ') }`); submit sends `maxPlayers` on create and on a PATCH when `!locked || !isCube`.

- [ ] **Step 1: Implement** the four files.
- [ ] **Step 2: Smoke it by hand** — `make dev`, `/tournament/new`: Cube tab → pick "All commons" → the chosen card, 12 heroes preselected, capacity 2 at 7 × 12 and `max-players` prefilled 2; set 6 boosters of 10 → capacity 3, the cap follows; lower the cap to 2; create → the page (Task 8 shows the players line once merged). Edit it: the cube card with Preview, the settings prefilled. Console clean.
- [ ] **Step 3: Verify** — `npm run build`, `npm test`.
- [ ] **Step 4: Commit**

```bash
git add src/components/TournamentCubeSettings.jsx src/components/MaxPlayersField.jsx src/components/TournamentCardsSource.jsx src/pages/TournamentForm.jsx
git commit -m "Tournament form: Cube tab, cube booster settings, hero pool, player cap"
```

---

### Task 8: Summary line, players line, Full pill, the cube link, step 2 "full"

**Files:**
- Modify: `src/components/TournamentBits.jsx`, `src/pages/TournamentMenu.jsx`, `src/pages/TournamentDetail.jsx`, `src/components/TournamentChecklist.jsx`
- Test: `src/components/TournamentBits.test.js`

**Interfaces:**
- Consumes: `maxPlayers` on the tournament JSON (Task 4), Task 3's keys.
- Produces:
  - `configSummaryParts`: a cube source gives `[{ text: t('tournaments.summaryCube', { n: boosters, cards: cardsPerBooster, name, total: Σ qty }) }, perFaction > 0 && { text: t(`tournaments.summaryPerFaction${perFaction}`) }, heroes === 'free' && { text: t('tournaments.summaryHeroesFree') }]` and nothing else (no uniques, no ban list).
  - `FullBadge({ t })` → a pill like `PrivateBadge` (`data-testid="tournament-full"`, title `fullBadgeTitle`, text `fullBadge`, `text-danger border-danger/40 bg-danger-soft`).
  - `PlayersLine({ tournament, t, tc })` → `tc('tournaments.poolsPrepared', poolCount)` when `maxPlayers == null`, else `t('tournaments.playersOf', { n: poolCount, max: maxPlayers })` in `data-testid="tournament-players"`; `isFull(tournament)` = `maxPlayers != null && poolCount >= maxPlayers`.
  - `TournamentMenu` cards (public tabs, "My created tournaments", "My ongoing"): `<PlayersLine>` in place of the `poolsPrepared` text, `<FullBadge>` after the status pill (after the Private pill) when full. `TournamentDetail` header: the same two, plus under the summary `<Link to={`/tournament/t/${id}/cube`} data-testid="cube-link">{t('tournaments.cubeLink', { n: total })}</Link>` when the source is a cube. `TournamentChecklist`: new prop `full`; step 2 with `!hasPool && full` → `<p className="text-xs text-muted" data-testid="step2-full">{t('tournaments.step2Full', { max })}</p>` and no button; `handleOpenPool` in `TournamentDetail` maps a 409 `tournament_full` to that same text in `openError`.

- [ ] **Step 1: Write the failing tests** in `TournamentBits.test.js`:

```js
it('summarizes a cube: boosters of N, the cube name and size, the faction guarantee, free heroes', () => {
  const cube = { v: 1, format: 'sealed', source: { type: 'cube', name: 'All commons', origin: 'community', cubeId: 'all-commons', cards: { A: 1, B: 2 }, heroPool: ['H'], boosters: 6, cardsPerBooster: 10, perFaction: 1 }, heroes: 'free', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null }, excludeBanlist: false }
  expect(configSummaryParts(cube, t, tc).map(p => p.text)).toEqual(['tournaments.summaryCube {"n":6,"cards":10,"name":"All commons","total":3}', 'tournaments.summaryPerFaction1', 'tournaments.summaryHeroesFree'])
  expect(configSummaryParts({ ...cube, source: { ...cube.source, perFaction: 0 }, heroes: 'packs' }, t, tc)).toHaveLength(1)
})
it('isFull and PlayersLine', () => {
  expect(isFull({ poolCount: 2, maxPlayers: 2 })).toBe(true); expect(isFull({ poolCount: 1, maxPlayers: 2 })).toBe(false); expect(isFull({ poolCount: 9, maxPlayers: null })).toBe(false)
  // render PlayersLine with and without maxPlayers (the file's existing render helper), check the text and the test id
})
```

- [ ] **Step 2: Run** — `npm test -- TournamentBits` → fail.
- [ ] **Step 3: Implement** the four files.
- [ ] **Step 4: Run** — `npm test -- TournamentBits`, `npm run build`.
- [ ] **Step 5: Commit**

```bash
git add src/components/TournamentBits.jsx src/components/TournamentBits.test.js src/pages/TournamentMenu.jsx src/pages/TournamentDetail.jsx src/components/TournamentChecklist.jsx
git commit -m "Tournaments: cube summary, players line and Full pill, cube link, full state of step 2"
```

---

### Task 9: The cube page

**Files:**
- Create: `src/components/CubeContents.jsx`, `src/pages/TournamentCubePage.jsx`
- Modify: `src/components/CubePreviewModal.jsx`, `src/App.jsx`

**Interfaces:**
- Consumes: `getTournament` (`tournamentApi.js`), `configSummaryParts` / `ConfigSummary` / `PlayersLine` (Task 8), `fetchSet` / `fetchUniques`, Task 3's keys.
- Produces:
  - `<CubeContents refs booster={null} />`: everything of today's `CubePreviewModal` below its header (the fetch of the sets and uniques, the sidebar counts, search, group by, list / grid, the hover tooltip), over `refs` (one entry per copy). `CubePreviewModal({ cube, onClose })` keeps its portal, backdrop and header and renders `<CubeContents refs={cube.refs} booster={cube.booster} />`: no visible change in the Lobby.
  - `TournamentCubePage` (route `/tournament/t/:id/cube`): `getTournament(id)`; a non-cube tournament → `<Navigate to={`/tournament/t/${id}`} replace />`; `TopNav`, back link (`backToTournament`), header `data-testid="cube-page"` (`cubePageOf { name }`, the cube name, the origin label, `<ConfigSummary>`, `<PlayersLine>`), section `cube-page-heroes` (`cubePageHeroesTitle { n }`, one chip per `heroPool` ref with the faction icon and the name once resolved, `cubePageHeroesPacks` / `cubePageHeroesFree`), then `<CubeContents refs={expanded cards} />`. Public (no bearer needed), `Footer`.

- [ ] **Step 1: Implement** the four files.
- [ ] **Step 2: Check the Lobby's preview is unchanged** — `make dev`, Lobby → Cubes → Preview cube: same modal; open `/tournament/t/<cube tournament>/cube` (a cube tournament created through the form of Task 7, or by curl with Task 5b merged): the page; `/tournament/t/<set tournament>/cube` → redirected.
- [ ] **Step 3: Verify** — `npm run build`, `npm test`.
- [ ] **Step 4: Commit**

```bash
git add src/components/CubeContents.jsx src/pages/TournamentCubePage.jsx src/components/CubePreviewModal.jsx src/App.jsx
git commit -m "Tournaments: the cube page, CubePreviewModal over a shared CubeContents"
```

---

### Task 10: The reveal — generated booster cover, cube sublabel, cube link

**Files:**
- Create: `src/lib/cubeCover.js`, `src/lib/cubeCover.test.js`
- Modify: `src/components/PackReveal.jsx`, `src/components/TournamentPoolView.jsx`

**Interfaces:**
- Consumes: `pool.sourceType`, `pool.cube.name`, `pool.tournamentName`, `pool.tournamentRef` (Task 5), `packReveal.cubeBooster` and `tournamentPoolView.cubeLink` (Task 3).
- Produces:
  - `wrapTitle(text, maxChars = 18, maxLines = 2) → string[]` (word wrap, the last line ellipsized with `…` when the text does not fit; pure).
  - `cubeBoosterCover({ title, subtitle, logoUrl = '/images/altered-logo.png', width = 600, height = 840 }) → Promise<string | null>`: a canvas (deep blue vertical gradient `#0d2a4d → #071a33`, a 10 px gold frame `#d7b25c`, the logo drawn at 60 % of the width centred in the top half once loaded (`Image` with `decoding = 'async'`), the title lines in `700 56px Fraunces, serif` gold centred under it (`document.fonts.load` first, 2 s cap, then serif), the subtitle `500 30px Fraunces, serif` in `#f4ead0`), returned as `canvas.toDataURL('image/png')`; memoized by `title|subtitle`; **never throws**: any failure (no canvas, logo error, tainted canvas) resolves `null`.
  - `PackReveal` new prop `coverImage` (`undefined` = today's behaviour, `null` = never a cover, string = that image for every real pack) and `coverSublabel` (string | null): `coverImage = isBonusPack ? null : coverImage !== undefined ? coverImage : (sourceType === 'faction' ? null : boosterCoverFor(singleSetOf(currentPack), lang))`; `zoomCover.sublabel = isBonusPack ? guaranteedUnique : coverSublabel`; the pack heading shows `coverSublabel` under "Booster N / total" when set.
  - `TournamentPoolView`: on load of a cube pool, `cubeBoosterCover({ title: data.tournamentName ?? title, subtitle: t('packReveal.cubeBooster', { name: data.cube.name }) })` into state `coverImage` (null until it resolves); passes `coverImage={pool.sourceType === 'cube' ? coverImage : undefined}` and `coverSublabel={pool.sourceType === 'cube' ? t('packReveal.cubeBooster', { name }) : null}`; the title bar gets `<Link to={`/tournament/t/${pool.tournamentRef}/cube`} data-testid="pool-cube-link">` when `pool.sourceType === 'cube' && pool.tournamentRef`; `loadPool`'s by-reference pass becomes `refs.filter(r => needsCardApi(r) && !map[r])` (a cube pool may hold a promo-only printing).

- [ ] **Step 1: Write the failing tests** — `cubeCover.test.js`: `wrapTitle('Winter Cup of the Northern Lights', 18)` → `['Winter Cup of the', 'Northern Lights']`; a 60-character single word → one line ending with `…`; `cubeBoosterCover` resolves `null` when `document` is undefined (node) and when `createElement('canvas').getContext` returns null (jsdom stub).
- [ ] **Step 2: Run** — `npm test -- cubeCover` → fail.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** — `npm test -- cubeCover`, `npm run build`; by hand: open a cube pool's reveal → the cover with the logo, the tournament name and the cube name, "Open the booster" then the cards; the 8th bonus pack absent.
- [ ] **Step 5: Commit**

```bash
git add src/lib/cubeCover.js src/lib/cubeCover.test.js src/components/PackReveal.jsx src/components/TournamentPoolView.jsx
git commit -m "Pool reveal: a generated booster cover for cube pools, cube link"
```

---

### Task 11: E2E fixtures for a community cube, deck seeding in the fakes

**Files:**
- Modify: `scripts/e2e-card-fixtures.mjs`, `tests/e2e/fixtures/cards/README.md`, `tests/e2e/fakes/server.mjs`, `tests/e2e/fakes/decks.mjs`, `tests/e2e/fakes/cards.mjs`, `tests/e2e/support/fakes-client.js`, `tests/e2e/support/fixtures.js`, `tests/e2e/support/api.js`, `tests/e2e/specs/harness.spec.js`
- Create: `tests/e2e/fixtures/cards/{CORE,BISE,DUSTER,ALIZE}/<SET>_EN.json` (generated)

**Interfaces:**
- Produces:
  - `node scripts/e2e-card-fixtures.mjs --cube all-commons [--keep REF ...]`: for every set of that community cube's `refs` + `heroes` that is **not** one of the full sets (`FULL_SETS = ['CYCLONE', 'EOLE', 'FUGUE']`), writes the set's fixture trimmed to **every printing** of the cube's refs plus the `--keep` refs (the `B` filter is dropped for those sets: BISE's fixture holds `ALT_BISE_P_BR_64_C`; `fetchSet` ignores non-`B` rows anyway, `trim`ed as today); the full sets are left as they are. Without `--cube`, today's behaviour. Run it with `--keep ALT_DUSTER_B_AX_98_C` (the alt-art case of `@cu-a-paste`). The README gets a "Cube sets" table (CORE, BISE, DUSTER, ALIZE: "the All commons cube's refs only, every printing, plus the kept refs") and the command.
  - Fake cards API (`cards.mjs`): `GET /cards/api/cards?reference=<ref>` for a **non-unique** ref answers from the fixture files (every `tests/e2e/fixtures/cards/*/*_EN.json`, loaded once, indexed by `reference`) in the shape `synthesizeUnique` already produces: `{ reference, name: { en: card.name }, faction: { code: card.mainFaction.reference, name }, rarity: { reference: card.rarity.reference }, cardType: { reference: card.cardType.reference }, mainCost…, imagePath: '' }` (the elements' numbers parsed from the fixture's `#…#` strings; `member: []` when the ref is in no fixture, as today for an unknown unique).
  - Fakes: `decks.seed(sub, { name, deckCards, format = 'sandbox', isDraft = false })` in `decks.mjs`; `POST /__control/decks { user, name, deckCards }` → 201 the deck; `fakesSeedDeck(user, deck)` in `fakes-client.js`; the `fakes` fixture gains `seedDeck`.
  - `cubeTournamentBody(overrides = {})` in `support/api.js` = `tournamentBody({ name: 'Commons cube', bgaUrl: 'https://boardgamearena.com/tournament?id=123510', maxPlayers: 3, config: { source: { type: 'cube', name: 'All commons', origin: 'community', cubeId: 'all-commons', cards: <the cube's 192 refs as { ref: 1 }, the promo-only `ALT_BISE_P_BR_64_C` included>, heroPool: <its 12 heroes>, boosters: 6, cardsPerBooster: 10, perFaction: 1 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0 }, excludeBanlist: false }, ...overrides })` (import `COMMUNITY_CUBES` from `src/lib/cubes.js`). Also export `ALL_COMMONS = { cards: 192, heroes: 12 }` for the specs' expectations.
  - `harness.spec.js` line ~232: the "another set answers 404" check uses `NOPE` instead of `ALIZE`.

- [ ] **Step 1: Implement** the script option and generate the four fixtures (`node scripts/e2e-card-fixtures.mjs --cube all-commons --keep ALT_DUSTER_B_AX_98_C`); check each file holds only the cube's refs of that set plus the kept ones, every printing (`node -e` count against `COMMUNITY_CUBES`; BISE's file contains `ALT_BISE_P_BR_64_C`).
- [ ] **Step 2: Implement** the fake cards API's by-reference answer, the fakes seeding and the helpers; update `harness.spec.js`. Check by hand: `curl "http://localhost:8091/cards/api/cards?reference=ALT_BISE_P_BR_64_C"` → one member with `faction.code` `BR`.
- [ ] **Step 3: Run** — `make e2e` → everything still passes (the fixture change touches no existing pool: lot 1 / V2 / V3 / V4 draw CYCLONE / EOLE / FUGUE only); `grep -rn "ALIZE\|BISE\|DUSTER\|\bCORE\b" tests/e2e/specs` shows no other assumption.
- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-card-fixtures.mjs tests/e2e/fixtures/cards tests/e2e/fakes/server.mjs tests/e2e/fakes/decks.mjs tests/e2e/fakes/cards.mjs tests/e2e/support/fakes-client.js tests/e2e/support/fixtures.js tests/e2e/support/api.js tests/e2e/specs/harness.spec.js
git commit -m "E2E: card fixtures for the All commons cube, cards by reference and deck seeding in the fakes"
```

---

### Task 12: The V5 recette page

**Files:**
- Create: `docs/tournaments/acceptance-cube-sealed.html` (copy `acceptance-private-tournaments.html`, keep its CSS/JS shell; replace `<title>` "Cube Sealed Acceptance", the `<h1>` "Acceptance — cube sealed and the player cap · V5", the hero text, `PERSONAS`, the helpers, `GROUPS`, `AUTO_STEPS = []`, `AUTO_PARTIAL = {}`, the IndexedDB `KEY = 'state-v5-cube'`, `FOLD_KEY = 'tournois-recette-v5-cube-collapsed'`, `imgName` prefix `cube-acceptance-`, the recap header "Cube sealed and the player cap acceptance, V5")
- Modify: `scripts/e2e-acceptance-coverage.mjs` (`ACCEPTANCE_PAGES` += the new page)

BGA ids: 123510 "Commons cube" (All commons, 6 × 10, one of each faction, heroes in boosters, cap 3), 123511 "Full cup" (same, cap 2), 123512 "Capped set cup" (Skybound Odyssey, cap 2), 123513 "Deck cube" (alice's Re:Union decks), 123514 "Pasted cube", 123515 API throwaway, 123516 the form draft, 123517 "Free heroes cube" (All commons, free heroes, 3 heroes selected). 123518–123519 free. Preprod 999510 (a cube tournament), 999511 (a full one).

Groups and step ids (titles indicative; every step carries its full commands, expected outputs and the psql lines on the `DB` helper; a `CREATE_CUBE(tok, name, bga, over)` helper posts the Commons cube config through `node -e`, reading the cube's refs from `src/lib/cubes.js`):

| Group | Steps |
| --- | --- |
| 0 Setup | `cu-0-lot1`, `cu-0-branch` (`git switch feat/cube-sealed`), `cu-0-dev` (`make dev`, then psql: `max_players` column, `tournament_cube_slots` table, `cube_slot` column), `cu-0-tests`, `cu-0-e2e` (five pages listed), `cu-0-clean` (ids 123510–123519, alice under the cap) |
| A The Cube tab | `cu-a-tab` (third tab "Cube", the hint, the three panels), `cu-a-community` (select "All commons" → the chosen card: name, origin, "192 cards (192 distinct)", 12 heroes found, six faction counts, no unresolved callout (the promo-only "Sofia, First Outpost" resolves by reference), Preview opens the modal, Change cube returns to the panels), `cu-a-reunion` (load decks, search, tick two, import → one cube named "2 decks"), `cu-a-paste` (paste a list with an alt-art ref, a promo-only ref, an unknown ref, a mistyped unique serial and a hero → the alt-art stored under its `B` ref, the promo-only ref kept as given, the unknown ref and the bad serial listed as given and left out, the hero split out), `cu-a-switch` (Cube ↔ Sets keeps each tab's state), `cu-a-draft` (the reconnect flow with a cube chosen) |
| B The cube Settings | `cu-b-boosters` (steppers 3–8 / 10–16, the pool line, "two of each faction" disabled under 12 cards), `cu-b-heroes` (mode cards; Choose heroes: groups by faction, All / None, search, chips; the cube's 12 preselected; "0 selected" → "Select at least one hero." in the bar), `cu-b-capacity` (All commons at 7 × 12 → "up to 2 players", cap prefilled 2; 6 × 10 → 3; raise the cap above → "At most 3 players…"; lower to 2 → ok), `cu-b-too-small` (8 × 16 → "cannot serve 2 players (192 cards, 128 needed per player)") |
| C Create | `cu-c-create` (Commons cube 123510; the stored config through `?bgaId=` with a fixed key list: type, name, origin, cubeId, boosters, cardsPerBooster, perFaction, Σ cards = 192, heroPool length 12, uniques, excludeBanlist, maxPlayers), `cu-c-summary` ("6 boosters of 10 · cube “All commons” (192 cards) · 1 of each faction per booster", "0 / 3 players" on the hub card and the page) |
| D The cube page | `cu-d-link` ("View the cube (192 cards) →" on the page, "Cube" on the pool page), `cu-d-page` (header, 12 heroes with icons, the mode text, sidebar counts, search, group by, grid, "Sofia, First Outpost" among the Bravos cards), `cu-d-redirect` (a set tournament's `/cube` redirects), `cu-d-mobile` (375 px) |
| E Pools and the reveal | `cu-e-first` (alice opens her pool: psql `SELECT count(*) FROM tournament_cube_slots` = 3, her `cube_slot` = 0, 6 boosters of 11), `cu-e-reveal` (the generated cover: logo, "Commons cube", "Cube “All commons”"; the cards; no 8th booster), `cu-e-composition` (psql: slot 0 of each booster ∈ heroPool, slots 1–6 one card per faction in AX…YZ order through the cards API or the set file, no ref twice across the three pools, every ref in the cube), `cu-e-others` (bob and carol → slots 1 and 2, "3 / 3 players", the Full pill), `cu-e-deck` (a deck saves and syncs; the BGA deck list for alice gives a deck ⊆ her pool) |
| F Full | `cu-f-page` (Full cup 123511, cap 2: alice and bob open pools; carol's page: step 2 "This tournament is full: 2 players already have a pool.", no button), `cu-f-api` (carol: `GET /api/tournaments/:id/pool` → 409 `tournament_full` with `maxPlayers: 2`; `GET /api/tournament-bga-decklist?tournamentId=123511` → 409 `tournament_full`; alice's call still 200), `cu-f-free` (Free heroes cube 123517: every pool's `cards` holds the 3 selected heroes, boosters of 10) |
| G The cap on a set tournament | `cu-g-create` (Capped set cup 123512, SKY, cap 2; "0 / 2 players"), `cu-g-full` (two pools, carol: full, 409), `cu-g-lower` (edit: cap 1 → "2 players already have a pool…", blocked; cap 3 → saved; "No limit" → saved, `maxPlayers` null) |
| H API guards | `cu-h-api` (curl refusals: boosters 2, cards 9, perFaction 2 with 11 cards, 3 × 10, an unknown ref → `source.cards.unresolved` + the list, a hero among the cards, a non-hero in the pool, no cap → `required_for_cube`, cap 9 → `above_capacity` + capacity, an unknown `origin`, Σ > 1500), `cu-h-locked` (PATCH `maxPlayers` on 123510 → 409 `tournament_locked`; PATCH `name` → 200) |
| I Edit | `cu-i-unlocked` (Pasted cube 123514 before any pool: change the cube to "All commons", the settings, the cap; save; the page follows), `cu-i-locked` (123510's edit page: the chosen card read-only with Preview, steppers / option cards / hero picker / cap disabled, the lock notice names the cap, the name editable) |
| J BGA path | `cu-j-bga` (carol's BGA deck-list curl on 123517 → a "Random Free heroes cube" deck from a slot pool; `cube_slot` set) |
| K Cross-cutting | `cu-k-fr`, `cu-k-theme`, `cu-k-mobile`, `cu-k-console` |
| L Lobby | `cu-l-lobby` (only if Task 15 ran: the Lobby's Cubes tab looks and behaves as before; otherwise mark skipped) |
| M Before production | `cu-m-preprod` (999510: a cube tournament end to end with two accounts; 999511: a full one; clean-up by detach + delete) |

- [ ] **Step 1: Write the page** (new steps unchecked, V4 conventions, every `pre(...)` block checked with `zsh -n`).
- [ ] **Step 2: Register it** in `ACCEPTANCE_PAGES`; `npm run test:e2e:coverage` → the new page lists every id under "no tag", no id declared twice.
- [ ] **Step 3: Commit**

```bash
git add docs/tournaments/acceptance-cube-sealed.html scripts/e2e-acceptance-coverage.mjs
git commit -m "Acceptance: cube sealed and player cap recette page (V5)"
```

---

### Task 13: Playwright replay

**Files:**
- Create: `tests/e2e/specs/cube-sealed.spec.js`
- Modify: `docs/tournaments/acceptance-cube-sealed.html` (`AUTO_STEPS`, `AUTO_PARTIAL`)

**Interfaces:**
- Consumes: `cubeTournamentBody`, `fakes.seedDeck` (Task 11), `storedPool` (`support/pools.js`), `openPoolPage`, the test ids of Tasks 6–10, `t` / `tc`, `COMMUNITY_CUBES`.
- Locators: `sourceRadio(page, 'sourceCube')`, `page.getByTestId('cube-community-all-commons')`, `cube-chosen`, `cube-count`, `cube-faction-AX`, `cube-change`, `cube-paste-text`, `cube-paste-parse`, `cube-unresolved`, `cube-reunion-load`, `cube-reunion-deck-<id>`, `cube-reunion-import`, `cube-boosters` / `cube-cards-per-booster` (+ their `+` / `−` buttons), `cube-per-faction-2`, `cube-pool-line`, `hero-pool-count`, `hero-pool-open`, `hero-faction-none-AX`, `hero-chip-<REF>`, `max-players`, `max-players-capacity`, `max-players-limit`, `form-problems`, `tournament-players`, `tournament-full`, `cube-link`, `cube-page`, `cube-page-heroes`, `step2-full`, `pool-cube-link`, the zoom cover `img[src^="data:image/png"]`.

Tests (one per tag; the stored pools read with `storedPool`, extended to select `cube_slot` as well):

- `@cu-a-tab` + `@cu-a-community`: the third tab, the hint; select All commons → `cube-chosen` with `cube-name` = "All commons", `cube-count` = `tc('tournaments.cubeCount', 192, { n: 192, distinct: 192 })`, six faction counts summing to 192, no `cube-unresolved`, `hero-pool-count` = 12 selected; `cube-preview` opens the modal (the cube's name in it); `cube-change` → the panels again.
- `@cu-a-reunion`: `fakes.seedDeck('alice', { name: 'Deck A', deckCards: 20 CYCLONE refs })` ×2, open the form, load, tick both, import → `cube-name` = `t('tournaments.cubeDecksName', { n: 2 })`, `cube-count` 40 cards.
- `@cu-a-paste`: paste `1 ALT_DUSTEROP_A_AX_98_C\n1 ALT_BISE_P_BR_64_C\n1 ALT_NOPE_B_AX_01_C\n1 ALT_CYCLONE_B_AX_04_U_999999999\n1 <a CYCLONE hero of the fixture>\n2 ALT_CYCLONE_B_BR_03_C` → `cube-unresolved` lists exactly `ALT_NOPE_B_AX_01_C` and `ALT_CYCLONE_B_AX_04_U_999999999` (as given); the alt-art stored as `ALT_DUSTER_B_AX_98_C` and the promo-only ref kept as `ALT_BISE_P_BR_64_C` (both served by Task 11's fixtures), the hero split out (`hero-pool-count` 1), `cube-count` 3 cards (4 copies); create it (123514) → the stored `cards` keys are those two plus `ALT_CYCLONE_B_BR_03_C`.
- `@cu-a-switch`: choose a cube, switch to Sets, pick SKY, back to Cube → the chosen card still there.
- `@cu-b-boosters` + `@cu-b-heroes` + `@cu-b-capacity` + `@cu-b-too-small` (one test, four tags): steppers bounds, `cube-per-faction-2` disabled at 11 cards, `cube-pool-line` text; `hero-faction-none-AX` → count 10; all None → problems contain `t('tournaments.errCubeNoHero')`; capacity at 7 × 12 = 2 and `max-players` value "2"; 6 × 10 → "3" and `max-players-capacity` = `cubeCapacityLine { n: 3 }`; type 5 → problems contain `errMaxPlayersCapacity { n: 3 }`; 8 × 16 → `errCubeTooSmall`.
- `@cu-c-create` + `@cu-c-summary`: create Commons cube through the form; `GET /api/tournaments/:id` → `config.source` `toMatchObject({ type: 'cube', cubeId: 'all-commons', boosters: 6, cardsPerBooster: 10, perFaction: 1 })`, `Object.keys(cards).length` 192 with `ALT_BISE_P_BR_64_C` among them, `heroPool.length` 12, `uniques` zeroed, `maxPlayers` 3; the page summary = the `summaryCube` + `summaryPerFaction1` texts; `tournament-players` = "0 / 3 players" on the page and the hub card.
- `@cu-d-link` + `@cu-d-page` + `@cu-d-redirect`: `cube-link` → `cube-page` with 12 hero chips, the sidebar's faction counts, the search filters the list; a set tournament's `/cube` URL lands on `/tournament/t/:id`.
- `@cu-e-first` + `@cu-e-composition` + `@cu-e-others` (one test, three tags): seed `cubeTournamentBody`, pools for alice, bob, carol through `seed.pool`; `db.query` on `tournament_cube_slots` count 3; the three `storedPool`s: `cube_slot` 0, 1, 2; 6 boosters of 11 each; slot 0 ∈ heroPool; slots 1–6 factions `['AX','BR','LY','MU','OR','YZ']` (faction from the fixture's card map, `BY_REF`); the three bodies disjoint; every ref ∈ cube; `cards` = booster counts.
- `@cu-e-reveal` (partial: the drawing itself is a human check): `openPoolPage` for alice → the zoom cover `img[src^="data:image/png"]` visible with `t('cardZoom.openBooster')`, the heading shows `packReveal.cubeBooster { name: 'All commons' }`, no `packReveal.guaranteedUnique` on the last pack.
- `@cu-e-deck` + `@cu-j-bga`: alice's `seed.bgaDecklist` on the cube tournament → one deck whose refs ⊆ her pool's `cards` (read the fake's deck through `fakes.decks('alice')`).
- `@cu-f-page` + `@cu-f-api` + `@cu-f-free`: cap 2 (`cubeTournamentBody({ bgaUrl: …123511, maxPlayers: 2 })`), alice and bob pools; carol's page → `step2-full` with `step2Full { max: 2 }`, no open button; carol's `GET /api/tournaments/:id/pool` → 409 `{ error: 'tournament_full', maxPlayers: 2 }`; her `GET /api/tournament-bga-decklist?tournamentId=123511` → 409 `tournament_full`; a free-heroes cube (`heroes: 'free'`, `heroPool` 3 refs) → `storedPool.cards` holds the 3 heroes, boosters of 10.
- `@cu-g-create` + `@cu-g-full` + `@cu-g-lower`: `tournamentBody({ bgaUrl: …123512, maxPlayers: 2 })`, two pools, carol full (page + 409); alice's edit page: `max-players` "1" → problems contain `errMaxPlayersBelowPools { n: 2 }`; "3" → save → `maxPlayers` 3; empty → save → null.
- `@cu-h-api` + `@cu-h-locked`: the refusal matrix of the recette through `api('alice').post` (each case → 400 with the expected `config` / `fields` and, for the unresolved case, `unresolved`); PATCH `{ maxPlayers: 2 }` on the locked cube tournament → 409 `tournament_locked`; `{ name: 'Renamed' }` → 200.
- `@cu-i-unlocked` + `@cu-i-locked`: before any pool, edit: `cube-change`, pick All commons, 5 × 12, cap 2, save → `GET` reflects it; after a pool: `cube-chosen` visible, `cube-change` absent, `cube-preview` enabled, every stepper / option card / `hero-pool-open` / `max-players` disabled, `tn-name` enabled.
- `@cu-k-fr` (partial), `@cu-k-mobile` (`@mobile`, partial): FR strings without raw keys on the form (Cube tab + cube settings), the page and the cube page; 375 px: the Cube tab panels, the chosen card, the hero picker open, the cube page, no horizontal scroll.

- [ ] **Step 1: Write the spec.**
- [ ] **Step 2: Run** — `make e2e` → everything passes (lot 1, V2, V3, V4 included). A step the app does not meet goes in as `test.fixme` with its tag and is listed in the PR, never silently fixed.
- [ ] **Step 3: Coverage** — `npm run test:e2e:coverage -- --write` rewrites the five `AUTO_STEPS` lines; add the `AUTO_PARTIAL` notes for `cu-e-reveal`, `cu-k-fr`, `cu-k-mobile` by hand; re-run without `--write` → exit 0.
- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/cube-sealed.spec.js docs/tournaments/acceptance-cube-sealed.html
git commit -m "E2E: cube sealed and player cap acceptance steps"
```

---

### Task 14: Docs and the final verification

**Files:**
- Modify: `docs/tournaments/README.md` (new §14.10 "Cube sealed and the player cap (V5)" after §14.9, same labels: Format, Config, Dealing, Data and server, API, UI, Recette, Merge; the §14 intro sentence gains the V5 clause; the §14.3 rows for `POST`, `PATCH`, `GET /api/tournaments/:id/pool`, the BGA endpoints (409 `tournament_full`), `poolResponse`; the §14.4 rows for `/tournament/new` (the Cube tab, the cap), `/tournament/t/:id` (players line, Full, cube link) and a new `/tournament/t/:id/cube` row; §2.2 and §1 mentions; §12.1 gains the invariant "a cube tournament is dealt once; `tournament_cube_slots` is never rewritten"), `docs/tournaments/index.html` (the same §14.10 as `<h3 id="s14-10">` and the same rows, same wording), `CLAUDE.md` (a **Cube sealed + player cap (V5)** paragraph after the V4 one: the config shape, the deal, `insertCappedPool`, `tournament_full`, the cube page, the cover, the fifth acceptance page; the E2E section's list of pages and the fixtures sentence (the cube's sets); the `## Pages / routes` list), `docs/tournaments/user-tournaments-spec.md` (re-read §15 against what was built; fix any drift with "as built" notes), `TESTING.md` (§8 Tournaments: one line "cube sealed: create from a community cube, the deal, full")

- [ ] **Step 1: Write the docs** (README and index.html together, same wording).
- [ ] **Step 2: Full verification** — `npm run build && npm test && npm run test:integration && make e2e && npm run test:e2e:coverage` → all green; keep the five summary lines for the PR description.
- [ ] **Step 3: Commit**

```bash
git add docs/tournaments/README.md docs/tournaments/index.html CLAUDE.md docs/tournaments/user-tournaments-spec.md TESTING.md
git commit -m "Docs: cube sealed and the player cap (V5)"
```

- [ ] **Step 4: Draft PR** — push `feat/cube-sealed` and open a **draft** PR on `main` (English; sections Why, What, Decisions (spec §15.2), Tests table with the counts, Recette, Docs, Merge plan: group M on preprod before production; list any `test.fixme`). Do not merge.

---

### Task 15 (optional): the Lobby adopts `CubePicker`

**Files:**
- Modify: `src/pages/Lobby.jsx`

Only if `CubePicker` can replace the Lobby's inline Cubes tab (lines ~849–1063) with **no visible change**: same panels in the same order, the spotlight block kept (a `showSpotlight` prop on the picker, default false), the Lobby's `customCube` / `selectedCube` state derived from the picker's `onChange` (`origin 'community'` → `setSelectedCube(cubeId)`, otherwise `setCustomCube({ name, cards: expanded refs, heroes: heroesFound refs, unresolved, source: origin })`), the `heroDraftPart` text kept. If any of that needs a change in `CubePicker`'s behaviour for the form, stop and leave the Lobby alone.

- [ ] **Step 1: Try the swap; replay `TESTING.md` §2 "Cubes" by hand** (built-in, paste, Re:Union; sealed and draft starts).
- [ ] **Step 2: `make e2e`** (the Lobby specs), `npm run build`.
- [ ] **Step 3: Commit** (or revert and note it in the PR)

```bash
git add src/pages/Lobby.jsx
git commit -m "Lobby: cubes tab through the shared CubePicker"
```

---

## Self-review (done while writing; kept for the executor)

- **Spec coverage:** §15.2 config → Task 1; verification server-side → Tasks 5a, 5b; composition, every copy once, heroes → Task 2 (+ Task 5 wiring); hidden settings → Tasks 1, 7; player cap, editing the cap, full → Tasks 1, 4, 5, 5b, 8; capacity → Task 1 (+ Task 7 live); the deal and its storage → Tasks 2, 4, 5; Cube tab, Settings → Tasks 6, 7; summary, hub, page → Task 8; cube page → Task 9; reveal cover → Task 10; determinism → Task 2 (golden); recette → Task 12; tests → Tasks 1–13; docs → Task 14. §15.8's builder choices are left open on purpose.
- **Review Focus:** 1 → Task 5 ("three creators racing"); 2 → Tasks 5a, 6, 13 (`@cu-a-paste`); 3 → Tasks 1, 2, 5b; 4 → Tasks 1, 4, 13 (`@cu-g-lower`); 5 → Tasks 5b, 7, 13 (`@cu-i-locked`).
- **Names used across tasks:** `cubeCapacity`, `expandCube`, `checkPlayerCap`, `CUBE_LIMITS` (Task 1) → Tasks 5, 5b, 7; `dealCubeSlots` (Task 2) → Task 5; `resolveRefs`, `resolveCubeSource` and its `stored` (Task 5a) → Tasks 5, 5b, 6; `insertCappedPool`, `tournament_full`, `poolResponse.cube` (Task 5) → Tasks 8, 10, 13; `checkCubeConfig` (Task 5b); `CubePicker` / `HeroPicker` / `resolveCubeCards` (Task 6) → Task 7; `FullBadge` / `PlayersLine` / `isFull` (Task 8) → Task 9; `CubeContents` (Task 9); `cubeBoosterCover`, `coverImage` (Task 10); `cubeTournamentBody`, `fakes.seedDeck` (Task 11) → Task 13; the i18n keys (Task 3) → Tasks 6–10, 12, 13; `maxPlayers` on the JSON (Task 4) → Tasks 7, 8, 9.
- **Waves:** wave 1 = T1, T2, T3, T4, T5a, T11 (disjoint files); wave 2 = T5, T5b, T6, T8, T9, T10, T12 (disjoint files; T5 and T5b both follow T4 and T5a); wave 2b = T7 after T6; wave 3 = T13; wave 4 = T14 then the optional T15.
- **Proportion:** signatures, assertions and commands only; no function body except the deal order and the cover's composition, which the golden and the spec pin.
