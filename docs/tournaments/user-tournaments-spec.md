# User-created sealed tournaments — design spec

> Status: **validated design, not implemented** (2026-10-16). Companion to `README.md` in this
> folder, which documents the tournament feature as it exists today (one global competitive
> format, one pending pool per player, lazy binding on the first BGA call). This spec describes
> how that model is extended so that **organizers declare their own tournaments** with their own
> sealed configuration. Lot 1 is planned in `user-tournaments-lot1-plan.md`.

Table of contents

1. [Goal and scope](#1-goal-and-scope)
2. [Decisions already taken](#2-decisions-already-taken)
3. [Functional design](#3-functional-design)
4. [Data model](#4-data-model)
5. [Pool model: stored pools and the single generation entry point](#5-pool-model)
6. [Binding and the BGA path](#6-binding-and-the-bga-path)
7. [API](#7-api)
8. [Frontend](#8-frontend)
9. [Authorization, limits, validation](#9-authorization-limits-validation)
10. [Migration and deployment](#10-migration-and-deployment)
11. [Lots](#11-lots)
12. [Risks, open verifications, non-goals](#12-risks-open-verifications-non-goals)

---

## 1. Goal and scope

Let any Re:Union account **declare a sealed tournament** on altered-draft — name, description,
the BGA tournament link, a start date, an optional end date — and choose the sealed
configuration the way a room host does in the Lobby. Players browse the **upcoming tournaments**,
prepare the pool that matches that tournament's configuration, build their deck, and are
pushed to **register on BGA** as well. When BGA asks for the deck, altered-bga-api and
decks-api keep calling the exact same altered-draft endpoints they call today: **no change on
the BGA side.**

The organizer no longer needs a developer to change `current_format` for them. That record
stays as the format of the two legacy flows (the casual "normal" pool and the generic
"prepare my next tournament" pool for BGA tournaments nobody declared).

**In scope (all lots):** sealed only; every card-source and setting the Lobby offers for sealed
(presets, cubes, multi-set, heroes in boosters / free choice, random uniques, ban list) plus the
three tournament-specific knobs that already exist (exact uniques inside boosters, guaranteed
uniques outside, even factions); public listing; organizer self-service edit / cancel / close;
a moderator role.

**Out of scope:** draft tournaments (see `ROADMAP.md`, "Draft is explicitly deferred"),
notifications, verifying BGA registration, a nominative list of participants, card language
as a tournament setting (refs are language-independent; each player already views the pool in
their own UI language).

## 2. Decisions already taken

Outcome of the 2026-10-16 design discussion. Each line is a decision, not an option.

| Topic | Decision |
| --- | --- |
| Who can create | Any logged-in Re:Union account. Max **10 open tournaments per account** (open = neither cancelled nor ended). Moderators have no limit. |
| Moderators | A **Keycloak realm role** (name from env `TOURNAMENT_MODERATOR_ROLE`), read from the access token's `realm_access.roles` once userinfo validated the token. Until Re:Union provides the role, env allowlist `TOURNAMENT_MODERATORS` (comma-separated subs) does the same job. Both are honoured. |
| Pool storage | **Stored** (`cards` + `boosters` jsonb) at creation, for every pool created after deployment, including the legacy normal / generic-prep pools. Rows created before deployment keep being regenerated, except those frozen by the one-shot script (§10). |
| Card language | Not a tournament setting. Removed from the tournament form. It is not part of the seed and not a column; nothing legacy depends on it. |
| Tournament-only knobs | Kept, in a "Tournament settings" section: uniques inside boosters, guaranteed uniques outside, even factions. The Lobby's options alone can't express Re:Union's current format. |
| Lifecycle end | Optional `ends_at` set by the organizer **and** a manual "close" action. No automatic expiry N days after start (turn-based tournaments run for weeks). |
| Pool creation window | Allowed from declaration until the tournament is ended or cancelled, including after `starts_at`. Safe because creation is get-or-create on the unique (player, tournament) pair: whoever comes first (the page or BGA's call) creates, the other reuses. There is never a second pool. |
| BGA link | **Mandatory at creation**, must parse to a BGA tournament id, **unique** across tournaments. |
| Public listing | Upcoming / ongoing tournaments are readable logged out. Preparing a pool requires login. |
| Participants | Organizer sees a **pool count** only. |
| Deletion | **Soft cancel** keeps pools and decks (a hard delete would make every deck of a running tournament illegal on BGA and send the next BGA call to the legacy fallback). Hard delete only when the tournament has zero pools. |
| BGA registration wizard | A 3-step checklist on the tournament page (register on BGA → open your pool → build your deck), "I registered" remembered in localStorage. Registration cannot be verified. |
| Generic prep flow | Kept, de-emphasized at the bottom of the menu, **no warning**. A declared tournament always wins over a pending generic pool for the same BGA id. |
| Tournament name vs BGA name | For declared tournaments the altered-draft name is authoritative; the BGA call never overwrites it (it still refreshes the name of legacy-bound pools). |
| Config edits | Frozen as soon as the first pool exists. Name, description, dates stay editable. The BGA link is editable only while no pool exists. |
| Cancelled / ended tournaments | **Stay editable** by the organizer and moderators in every status: name, description, dates, and the actions (restore, reopen). The lock on the BGA link and the config depends only on pool existence, never on status. Reusing a BGA link therefore means restoring the cancelled tournament and editing it, not creating a second one. |
| Squatting (decided after the lot-1 review) | Anyone can declare any BGA id, so a declaration can hijack a tournament someone else organizes. A **moderator-only "detach"** action deletes **every** pool of that declaration (played or not; decided 2026-10-16: all players restart on the real organizer's config), marks it `detached_at`, and frees its BGA id; the BGA path ignores detached declarations. The row stays as a read-only trace. Decks already saved on decks-api are left orphaned. |
| Declared after BGA started (decided 2026-10-18, after the recette) | If players already have pools bound to that BGA id without a declared tournament (they are already playing it with the default format), the declaration **takes their format** (the submitted config is replaced, the form shows it locked as soon as the link is pasted) and **adopts those pools in the same statement**, so the tournament is locked from the start. If those pools do not all share one format, the declaration is refused (409 `bga_tournament_mixed_formats`). Rationale: a pool already played can't be swapped, so the only way every player of the BGA tournament plays the same format is for the declaration to take the format already in play. Lazy adoption on each player's next BGA call (§6 step 2) stays as a safety net for pools bound between the check and the insert. |
| Start date | Must be in the future at creation. Editable afterwards. Stored as `timestamptz`; entered in the organizer's browser timezone, displayed in the viewer's with the timezone shown. |

## 3. Functional design

### 3.1 Actors

- **Organizer**: any logged-in player. Owns the tournaments they created.
- **Moderator**: organizer powers on every tournament, no creation limit.
- **Player**: browses, prepares a pool per tournament, builds a deck.
- **BGA / altered-bga-api / decks-api**: unchanged callers (see README §9).

### 3.2 Tournament lifecycle

`status` is derived, never stored:

```
detached    if detached_at is set
cancelled   else if cancelled_at is set
ended       else if ended_at is set, or ends_at is set and now >= ends_at
ongoing     else if now >= starts_at
upcoming    otherwise
```

| Action | Who | Precondition | Effect |
| --- | --- | --- | --- |
| Create | logged-in | < 10 open tournaments (moderators exempt); `starts_at` in the future; BGA link valid and unused | row inserted, status `upcoming` |
| Edit name / description / dates | organizer, moderator | any status but detached (cancelled and ended included) | updated; a rename also renames the attached pools' `tournament_name` (deck names derive from it) |
| Edit BGA link | organizer, moderator | zero pools, any status | updated |
| Edit config | organizer, moderator | zero pools (checked atomically in the UPDATE), any status | updated |
| Cancel / restore | organizer, moderator | not detached | `cancelled_at` set / cleared; pools untouched |
| Close / reopen | organizer, moderator | not detached | `ended_at` set / cleared; reopen also clears an `ends_at` already reached (else the tournament would stay `ended`) |
| Detach | moderator only | not detached | every pool of the declaration deleted, `detached_at` set, BGA id freed; no edit possible afterwards (409 `tournament_detached`), delete still allowed |
| Delete | organizer, moderator | zero pools | hard delete |
| Prepare pool (page) | logged-in player | status `upcoming` or `ongoing` | get-or-create the player's pool |
| Pool via BGA call | altered-bga-api | tournament exists, **any status** | get-or-create (§6) |

Players keep viewing and editing the deck of an existing pool whatever the status.

### 3.3 Player journey

1. `/tournament` lists upcoming and ongoing tournaments (public). Each card shows name, start
   date, organizer, a one-line config summary ("7 boosters · Skybound Odyssey · 1 unique in
   boosters + 1 guaranteed"), the pool count, and the player's own state (no pool / pool ready /
   deck N cards).
2. The tournament page `/tournament/t/:id` shows the description, dates, BGA link and the
   checklist:
   1. **Register on BGA** — button opening `bga_url`, checkbox "I'm registered" (localStorage
      `tournament_bga_registered:<id>`).
   2. **Open your pool** — creates the pool (one-shot, spinner, error if the tournament is
      closed) or opens the existing one.
   3. **Build your deck** — link to the pool page; deck name and card count once a deck exists.
3. `/tournament/t/:id/pool` is the existing `TournamentPoolView` (pack reveal, full-pool
   deckbuilder, background deck sync to decks-api). Nothing changes in that component for lot 1.
4. From the first BGA game on, the pool also shows under "My pools" like any bound pool.
   If the player never opened altered-draft, the first BGA call creates the pool from the
   tournament's config and mints a random deck, exactly like today's legacy journey.

### 3.4 Organizer journey

1. `/tournament/new`: name, description, BGA link (with the parsed id echoed back and a hint
   "paste the main tournament link, not a stage"), start, optional end, then the same
   "Cards" and "Settings" steps as the Lobby's sealed wizard (lot 1: single-set presets only)
   plus the "Tournament settings" section.
2. The tournament page shows an organizer panel: pool count, "Edit", "Cancel" / "Restore",
   "Close" / "Reopen", "Delete" (only while zero pools). The panel, and the edit form, stay
   available whatever the status, so a cancelled tournament can be fixed and restored. The
   config section of the edit form is disabled once locked, with the reason shown.
3. After `starts_at`, the panel shows how many pools were created **by BGA calls** versus by the
   page. "0 pools created by BGA" after the first round is the tell-tale of a stage link pasted
   instead of the parent tournament link (§12).

## 4. Data model

All in `sealed-pools-schema.sql`, idempotent like the rest of the file.

```sql
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
  organizer_name    text not null,          -- pseudo snapshotted at creation (we only keep subs otherwise)
  config            jsonb not null,         -- §5.1, validated server-side
  cancelled_at      timestamptz,
  ended_at          timestamptz,            -- manual close
  detached_at       timestamptz,            -- moderator detach (squatting), frees the BGA id
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- One live altered-draft tournament per BGA tournament, cancelled ones included: a cancelled
-- tournament's pools still answer BGA for that id, so a second declaration would split the
-- players between two configs. Reuse = restore the cancelled one. Detached declarations
-- (moderator action, pools deleted) don't count.
create unique index if not exists tournaments_bga_tournament_id_live
  on tournaments (bga_tournament_id) where detached_at is null;
create index if not exists tournaments_organizer on tournaments (organizer_sub);
create index if not exists tournaments_starts_at on tournaments (starts_at);

alter table sealed_pools add column if not exists tournament_ref uuid references tournaments(id);
alter table sealed_pools add column if not exists config   jsonb;   -- config snapshot the pool was built from
alter table sealed_pools add column if not exists cards    jsonb;   -- { ref: count }, full pool
alter table sealed_pools add column if not exists boosters jsonb;   -- string[][] (pack-by-pack view)
alter table sealed_pools add column if not exists created_by text;  -- 'page' | 'bga' | 'legacy' (organizer panel stat)
create unique index if not exists sealed_pools_one_per_sub_per_tournament_ref
  on sealed_pools (sub, tournament_ref) where tournament_ref is not null;
```

How registered pools sit in the **existing** `sealed_pools` columns (no index change needed):

- `kind = 'tournament'`, `tournament_ref` = the tournament, **`tournament_id` = the tournament's
  `bga_tournament_id` and `bound_at = now()` at creation**. Consequences: the existing BGA lookup
  `(sub, tournament_id)` finds them unchanged; the existing partial unique index
  `(sub, tournament_id) where tournament_id is not null` keeps one pool per player per BGA
  tournament; the "pending" index (`tournament_id is null`) never matches them, so
  `getOrCreatePreparationPool` is untouched; `listBoundTournamentPools` lists them for "My
  tournaments" for free.
- `tournament_name` = the altered-draft name (never refreshed from BGA for these rows).
- The legacy snapshot columns (`set_code`, `unique_count`, `even_factions`, `heroes_in_pool`,
  `guaranteed_uniques`, `nonce`) are still filled from the config in lot 1 (single set), which
  keeps `NOT NULL` and lets `regeneratePool` reproduce the stored pool bit for bit (a property
  the tests use). Lot 2 relaxes `set_code` to nullable for multi-set and cube pools.
- Legacy rows: `tournament_ref`, `config`, `cards`, `boosters` are `null`; `created_by` is
  `'legacy'` for rows that predate the column (backfilled by the migration).

## 5. Pool model

### 5.1 The config object

One shape for tournaments, for the legacy format (converted on read), and later for the Lobby.

```json
{
  "v": 1,
  "format": "sealed",
  "source": { "type": "set", "setCode": "CYCLONE", "boosters": 7 },
  "heroes": "packs",
  "uniques": { "inBoosters": 1, "guaranteed": 1, "evenFactions": false },
  "excludeBanlist": false
}
```

- `source.type`: lot 1 accepts `set` only. Lot 2 adds `cube` (`{ type, cubeId?, name, cards[],
  heroes[] }` — built-in cubes are snapshotted by refs, not referenced by id) and `multiset`
  (`{ type, mix: { SET: boosters } }`), plus `uniques.random` (per-booster probability).
- `heroes`: `packs` (one hero per booster) or `free` (no hero in boosters, every hero of the
  set appended to the pool — today's `heroes_in_pool = false`).
- `uniques.inBoosters` 0–7, `uniques.guaranteed` 0–7, `evenFactions` boolean (normalized to `false` when `inBoosters + guaranteed < 2`).
- Conversion of a `current_format` row: `set_code → source.setCode`, `heroes_in_pool → heroes`,
  `unique_count → uniques.inBoosters`, `guaranteed_uniques → uniques.guaranteed`,
  `even_factions → uniques.evenFactions`, `excludeBanlist: false`.

Server-side validation (`src/lib/tournamentConfig.js`, pure, unit-tested): shape, ranges,
`setCode` among the visible `SETS`, `boosters === 7` in lot 1, and **uniques > 0 rejected for
a set without faction-range data** (FUGUE today) — lot 2's live uniques lift that limit.

### 5.2 One generation entry point

`src/lib/poolBuilder.js` (server-only, imported by `api/_lib/*`):

```
buildPool(sub, { config, nonce, seedColumns }) -> { cards, boosters }
```

Lot 1 implementation = today's `regeneratePool` body (seeded PRNG from `buildPoolSeedString`,
`pickDeterministicUniques`, `generateTournamentSealedPool`, appended heroes and guaranteed
uniques), with two additions: `excludeBanlist` filters the set with `filterBanned` before
generation and rejects banned unique families (`pickDeterministicUniques` gets an optional
`isAllowed` predicate; its existing retry loop redraws). Lot 2 ports the Lobby's other sealed
branches into it.

Rules:

- **Generate, then insert, in that order.** `cards`/`boosters` are computed in memory and written
  in the same `INSERT … ON CONFLICT DO NOTHING RETURNING *`. A card-data failure throws and
  nothing is inserted; a lost insert race discards the generated pool and re-selects the
  winner's. No half pools, no duplicates.
- `loadPool(sub, row)` replaces `regeneratePool` at every read site: returns the stored
  `{ cards, boosters }` when `row.cards` is set, else regenerates (legacy rows only).
- The normal pool and the generic prep pool go through the same insert path, so they are
  stored too from the deployment on. `resetNormalPool` regenerates and stores in its UPDATE.

Why stored (recorded for posterity): the legacy regeneration draws cards **by index in the
upstream set file's order** (`pickRandom`, no sort). A card inserted or reordered upstream would
silently change every regenerated pool mid-tournament and invalidate decks. Storage also makes
non-reproducible inputs (live random uniques, cube snapshots) possible. Size: ~4 KB raw per
pool, ~2 KB after TOAST compression; 10 000 pools ≈ 20–40 MB.

## 6. Binding and the BGA path

`bindTournamentId(sub, bgaId, bgaName)` (poolStore.js), called by `api/tournament-bga-decklist.js`
and `api/tournament-pool-counts.js`, becomes:

1. Row `(sub, tournament_id = bgaId)` exists → return it. If it is a legacy row
   (`tournament_ref is null`) refresh `tournament_name` from `bgaName` as today; if it is a
   registered pool, leave the name alone.
2. Else, a tournament with `bga_tournament_id = bgaId` exists (**whatever its status**, detached
   excepted — if BGA is playing it, every player must get the same config) → `getOrCreateTournamentPool(sub,
   tournament, { createdBy: 'bga' })`.
3. Else → legacy: bind the player's pending generic pool, unchanged.

`getOrCreateTournamentPool(sub, tournament, { createdBy })`:

1. `SELECT … WHERE sub = $1 AND tournament_ref = $2` → return.
2. `SELECT … WHERE sub = $1 AND tournament_id = $bgaId` (a legacy pool bound **before** the
   tournament was declared, i.e. the player already played games with it) → **adopt it**:
   `UPDATE … SET tournament_ref = $2` and return. Its contents keep coming from regeneration.
3. Else build from `tournament.config` with a fresh nonce and insert (§5.2), re-select on
   conflict.

Step 2 is only a safety net since 2026-10-18: declaring a tournament (or moving it to a BGA id)
adopts every legacy pool of that BGA id at once and takes their format (§2, "Declared after BGA
started"), so they all follow the tournament's config. A pool bound between that check and the
insert is adopted here on its next call.

## 7. API

Same conventions as README §9.1 (bearer verified via userinfo; JSON; 405 with `Allow`). New
files are mounted in `server/index.js` exactly like the existing ones.

| Endpoint | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/tournaments` | GET | none (optional bearer) | List. `?status=upcoming\|ongoing\|open\|all` (`open` = upcoming + ongoing, the default), ordered by `starts_at`. `?bgaId=<numeric id>` instead returns the live (not detached) declaration of that BGA tournament whatever its status, 0 or 1 item, plus `legacy`: `null`, or `{ pools, mixed, config }` for the pools already bound to that BGA id without a declaration (the format a declaration must take): the form's duplicate-link and imposed-format check. `?mine=1` (bearer required, 401 otherwise) returns every tournament the caller organizes, whatever its status, most recent start first ("My created tournaments"). With a bearer: each item carries `viewer.hasPool` / `viewer.poolId`. |
| `/api/tournaments` | POST | required | Create. Enforces §9. Returns the tournament. If players already have pools bound to that BGA id without a declared tournament (they are already playing it with the default format), the declaration **takes their format** (the submitted config is replaced, the form shows it locked as soon as the link is pasted) and **adopts those pools in the same statement**, so the tournament is locked from the start. If those pools do not all share one format, the declaration is refused (409 `bga_tournament_mixed_formats`). |
| `/api/tournaments/:id` | GET | none (optional bearer) | Detail + `poolCount`, `locked`, `poolsByOrigin` (organizer/moderator only), `viewer` (bearer only: `isOrganizer`, `isModerator`, `hasPool`, `poolId`, deck summary). |
| `/api/tournaments/:id` | PATCH | organizer / moderator | Partial update: `name`, `description`, `startsAt`, `endsAt`, `bgaUrl` (unlocked only), `config` (unlocked only, atomic `WHERE NOT EXISTS (pool)`), `action: cancel\|restore\|close\|reopen\|detach` (`detach` moderator only). 409 `tournament_locked` when a locked field is sent, 409 `tournament_detached` on a detached tournament, 409 `bga_tournament_taken` when the new link is already declared. A `bgaUrl` change to a BGA id already played with legacy pools follows the same rule as creation (their format imposed, pools adopted; mixed formats → 409 `bga_tournament_mixed_formats`). |
| `/api/tournaments/:id` | DELETE | organizer / moderator | 409 `tournament_has_pools` unless zero pools. |
| `/api/tournaments/:id/pool` | GET | required | Get-or-create the caller's pool (`createdBy: 'page'`). 409 `tournament_closed` when status is `cancelled` or `ended` **and** no pool exists yet (an existing pool is always returned). Response = `poolResponse` + `tournament: { id, name, status }`. |
| `/api/tournament-bound-pools` | GET | required | Unchanged shape + `tournament: { id, name, startsAt, status } \| null` per pool (LEFT JOIN). |
| `/api/tournament-bga-decklist`, `/api/tournament-pool-counts`, `/api/tournament-pool-by-deck`, `/api/tournament-pool` | — | — | **Unchanged contracts.** Internally they go through §6 / `loadPool`. |

Tournament JSON:

```json
{ "id": "…", "name": "Winter Cup", "description": "…", "format": "sealed",
  "bgaUrl": "https://boardgamearena.com/tournament?id=597924", "bgaTournamentId": "597924",
  "startsAt": "2026-11-02T19:00:00.000Z", "endsAt": null, "status": "upcoming",
  "organizer": { "name": "Shiranui" }, "config": { "…": "§5.1" },
  "poolCount": 12, "locked": true, "cancelledAt": null, "endedAt": null, "createdAt": "…",
  "viewer": { "isOrganizer": false, "isModerator": false, "hasPool": true, "poolId": "…",
              "deck": { "name": "Winter Cup", "cardQuantity": 30 } } }
```

Frontend client: `src/lib/tournamentApi.js` gains `listTournaments(status)`, `getTournament(id)`,
`createTournament(body)`, `updateTournament(id, body)`, `deleteTournament(id)`,
`fetchTournamentPool(id)`. Public GETs attach the bearer when logged in, and work without one.

## 8. Frontend

Routes (added to `App.jsx`; `/tournament/pools/:id` and the other existing routes stay):

| Route | Page | Notes |
| --- | --- | --- |
| `/tournament` | `TournamentMenu.jsx` (reworked) | Header (title, "Create a tournament", BGA registration notice); **"My ongoing tournaments"** (logged in, when any): a grid of the started tournaments the player has a pool in, each card opening the tournament page with a direct "Change my deck" button; then **tabs**, each with a one-line explanation, the active one kept in the URL (`?tab=upcoming|ongoing|pools|created`): **Upcoming** (default, public), **Ongoing** (public: pools can still be prepared until the end), **My pools** (every bound pool, declared tournaments first; a card opens the tournament page, or the pool itself for a BGA tournament nobody declared, plus "Change my deck"; the generic "Prepare my next tournament" block sits at the bottom of this tab), **My created tournaments** (`GET /api/tournaments?mine=1`, every status, grouped: ongoing then upcoming, each chronological, then a folded "Ended and cancelled (N)" block with the ended, cancelled and detached ones). The two personal tabs show a Connect box when logged out. |
| `/tournament/new` | `TournamentForm.jsx` | Create mode. Live validation (`src/lib/tournamentForm.js` `tournamentFormIssues`, the API's own pure checks + a duplicate-link lookup, `GET /api/tournaments?bgaId=`, debounced while typing; the unique index + 409 on submit stay the real guard): the submit button sits in a bar stuck to the bottom of the screen, disabled while problems remain, with the list of problems next to it (each one jumps to its field). |
| `/tournament/t/:id` | `TournamentDetail.jsx` | Header, description, checklist, organizer panel. |
| `/tournament/t/:id/edit` | `TournamentForm.jsx` | Edit mode; config section disabled when locked. Nothing of the form renders until `GET /api/tournaments/:id` (its `viewer` block) says the viewer may edit; anyone else goes straight to the tournament page (the PATCH is refused server-side anyway, 403). |
| `/tournament/t/:id/pool` | `TournamentPoolPage.jsx` | `TournamentPoolView` with `load = fetchTournamentPool(id)`, back link to the tournament. |

`TournamentForm.jsx` composition (lot 1):

- Info step: name, description (plain text, rendered as text), BGA link (client-side parse →
  "Tournament id 597924 detected" / error), start (`datetime-local`), end (optional). Timezone
  of the browser shown next to the inputs.
- Cards step: the preset set grid. Lot 1 shows "7 boosters of this set". Implemented as a
  small `SetPresetGrid.jsx` extracted from the Lobby's presets tab so both use it.
- Settings step: `SettingsFields` reused with `mode="sealed"`, a new `showLang={false}` prop
  (default `true` so the Lobby is unchanged), `showUniques={false}` (lot 1), `showBanlist`.
  Below it, the new `TournamentUniqueFields.jsx`: steppers for uniques in boosters and
  guaranteed uniques, "even factions" checkbox (enabled when their sum ≥ 2), with the set's
  faction-range availability driving a disabled state + hint for sets without data.
- Live validation (decided after the first recette: errors far from the submit button went
  unnoticed): `tournamentFormIssues` runs the same pure checks as the API on every change, plus
  a targeted duplicate-link lookup, `GET /api/tournaments?bgaId=` (one request per typed
  BGA id, debounced 350 ms; detached declarations excluded). The server's unique index + 409
  on submit stay the real guard (a tournament declared between the check and the submit). The submit button lives in a bar stuck to the bottom of the viewport; while
  problems remain it is disabled (tooltip = the list) and the bar lists them, each one
  scrolling to and focusing its field. Inline messages appear once a field is touched. Server
  refusals (a link declared meanwhile, 429, …) show in the same bar.
- Submit → `createTournament` / `updateTournament` → navigate to the tournament page.

`TournamentDetail.jsx`: status pill (upcoming / ongoing / ended / cancelled), dates in the
viewer's timezone, config summary line, the three-step checklist (§3.3), organizer panel (§3.4).
Logged-out visitors see everything but step 2 shows a "Connect" button.

i18n: every new string in both `en.js` and `fr.js` under a `tournaments.*` namespace. Existing
`tournamentPages.*` keys stay.

Theming: semantic tokens only (`surface`, `ink`, `accent`, …), as in `CLAUDE.md`.

## 9. Authorization, limits, validation

- `api/_lib/auth.js` gains `verifyUser(req) → { sub, name, roles } | null`: calls userinfo as
  `verifySub` does, then decodes the access token's payload (`base64url` of the second JWT
  segment — safe only **after** userinfo accepted that exact token) to read
  `realm_access.roles`, `pseudo`/`preferred_username` for the name. No new dependency.
- `isModerator(user)`: `roles` includes `process.env.TOURNAMENT_MODERATOR_ROLE` (when set) **or**
  `sub` is in `process.env.TOURNAMENT_MODERATORS` (comma-separated). Documented in
  `.env.example`.
- Creation limit: `count(*) from tournaments where organizer_sub = $1 and cancelled_at is null
  and ended_at is null and (ends_at is null or ends_at > now())` must be `< 10`, moderators
  exempt. 429 `too_many_open_tournaments`.
- Input validation (shared pure module, unit-tested): `name` 3–80 chars; `description` ≤ 2000;
  `startsAt` parseable and `> now()` at creation; `endsAt` null or `> startsAt`; `bgaUrl` must
  be `https`, host `boardgamearena.com` or a subdomain (`en.`, `fr.`, …), path `/tournament`,
  and carry a numeric `id` query param → `bga_tournament_id`. Reject anything else (the list is
  public: no arbitrary links). `config` per §5.1.
- Organizer check = `organizer_sub === sub` or moderator, on every PATCH / DELETE.
- Pool rows remain owner-scoped on every read (unchanged rule from README §12).

## 10. Migration and deployment

- `sealed-pools-schema.sql`: the DDL of §4, idempotent, plus
  `update sealed_pools set created_by = 'legacy' where created_by is null`. Applied on both
  targets by the existing mechanism (`make dev`, the AlteredOps one-shot migration image).
  The Re:Union fork is deployed through AlteredOps only (no Vercel deployment).
- `scripts/freeze-sealed-pools.mjs` (one-shot, run once after the migration, idempotent):
  for every `sealed_pools` row with `cards is null`, regenerate with the legacy path and store
  `cards` + `boosters`. From then on no pool depends on the upstream set file's order anymore.
  Requires `DATABASE_URL` and network access to the set files; logs a count; safe to re-run.
- New env vars (all optional): `TOURNAMENT_MODERATOR_ROLE`, `TOURNAMENT_MODERATORS`.
- `server/index.js`: mount `/api/tournaments`, `/api/tournaments/:id`,
  `/api/tournaments/:id/pool` (via `routeWithParam`). The files keep Vercel's path convention
  (`api/tournaments/index.js`, `api/tournaments/[id].js`, `api/tournaments/[id]/pool.js`), but
  the Re:Union fork is not deployed on Vercel.
- Docs: this folder's `README.md`, `CLAUDE.md` and `ROADMAP.md` updated when lot 1 ships.

## 11. Lots

| Lot | Delivers | Standalone | Estimate |
| --- | --- | --- | --- |
| **1. Registry + attached pools** | Everything above with `source.type = 'set'` (7 boosters of one set), heroes packs/free, exact + guaranteed uniques, even factions, ban list. Stored pools, freeze script, BGA path, public list, create/edit/cancel/close/delete, checklist page, moderators via env. | Yes | 4–6 days |
| **2. Full Lobby options** | Extract the Lobby's "Cards" step (presets / cubes incl. paste + Re:Union decks / multi-set) into a shared component driven by the §5.1 config; port the Lobby's sealed `handleStart` branches into `poolBuilder` (rng-injectable, used by both the browser and the server); cubes snapshotted by refs; multi-set; live random uniques (`uniques.random`), which also lifts the FUGUE limit; sets derived from refs in `TournamentPoolView` and `buildCardMap`; `PackReveal` generic over booster count and extras. | Needs lot 1 | 4–6 days |
| **3. Polish** | Home "Sealed set 6" block → generic "Tournaments"; "pools created by BGA" indicator; purge policy for boosters of long-ended tournaments (optional); docs. | After lot 1 | 2–3 days |

Estimates are effective dev days with Claude Code, tests and review included, excluding time
waiting on Re:Union.

## 12. Risks, open verifications, non-goals

1. **BGA parent id (verify before shipping lot 1).** altered-bga-api forwards
   `tournamentParentId ?? tournamentId`. The organizer pastes the public tournament URL; for a
   multi-stage tournament we assume its `id` is the parent id. If it were a stage id the
   lookup would miss silently and every player would fall back to the legacy pool. Mitigations:
   the form hint, and the "pools created by BGA = 0" indicator after the first round.
2. **Moderator role.** The dev realm export has no admin role; decks-api and AlteredOwnership
   use a local DB flag. Re:Union must create/assign a realm role, or we run on the env
   allowlist.
3. **Pool creation time.** A few hundred ms for lot 1 (set file fetch + generation), seconds in
   lot 2 with live uniques and cubes. Fine on the Express deployment (AlteredOps), the only one
   for the Re:Union fork; the Vercel 10 s function limit no longer applies.
4. **Lobby refactor (lot 2)** is the regression risk. Replay `TESTING.md`.
5. **Concurrency** is handled by unique indexes + `ON CONFLICT DO NOTHING` + re-select, the
   pattern already in `poolStore.js`.
6. **Squatting.** Any account can declare any BGA id. Mitigation: the moderator-only detach
   (§2, §3.2). Its cost: every player of that declaration loses their pool and starts over.
7. Non-goals restated: draft tournaments, notifications, BGA registration checks, nominative
   participant lists, card language as a setting, automatic expiry.
