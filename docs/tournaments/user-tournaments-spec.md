# User-created sealed tournaments — design spec

> Status: **validated design (2026-10-16); lot 1, V2, V3 and V4 implemented, V5 (cube sealed, §15) designed 2026-11-06, lots 2–3 pending**. Companion to `README.md` in this
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
13. [V3 — Multi-set sealed and random uniques](#13-v3--multi-set-sealed-and-random-uniques-design-2026-11-01)
14. [V4 — Private tournaments and the share box](#14-v4--private-tournaments-and-the-share-box-design-2026-11-01)
15. [V5 — Cube sealed and the player cap](#15-v5--cube-sealed-and-the-player-cap-design-2026-11-06)

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
| Squatting (decided after the lot-1 review) | Anyone can declare any BGA id, so a declaration can hijack a tournament someone else organizes. A **moderator-only "detach"** action deletes the pools **created for** that declaration (played or not; their decks on decks-api are left orphaned), **releases** the pools it **adopted** (already bound to that BGA id before it: `tournament_ref`/`adopted_at` back to NULL, contents and deck kept, so the real organizer's declaration re-adopts them with their format; decided 2026-10-18 after the PR review, replacing "delete every pool"), marks it `detached_at`, and frees its BGA id; the BGA path ignores detached declarations. The row stays as a read-only trace. |
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
| Detach | moderator only | not detached | pools created for the declaration deleted, adopted pools released (§2), `detached_at` set, BGA id freed; no edit possible afterwards (409 `tournament_detached`), delete still allowed |
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
-- (moderator action) don't count.
create unique index if not exists tournaments_bga_tournament_id_live
  on tournaments (bga_tournament_id) where detached_at is null;
create index if not exists tournaments_organizer on tournaments (organizer_sub);
create index if not exists tournaments_starts_at on tournaments (starts_at);

alter table sealed_pools add column if not exists tournament_ref uuid references tournaments(id);
alter table sealed_pools add column if not exists config   jsonb;   -- config snapshot the pool was built from
alter table sealed_pools add column if not exists cards    jsonb;   -- { ref: count }, full pool
alter table sealed_pools add column if not exists boosters jsonb;   -- string[][] (pack-by-pack view)
alter table sealed_pools add column if not exists created_by text;  -- 'page' | 'bga' | 'legacy' (organizer panel stat)
alter table sealed_pools add column if not exists adopted_at timestamptz; -- set when a declaration adopted it (detach releases those)
create unique index if not exists sealed_pools_one_per_sub_per_tournament_ref
  on sealed_pools (sub, tournament_ref) where tournament_ref is not null;
-- per-declaration lookups (counts, rename, detach, FK check) and legacy pools by BGA id (adoption)
create index if not exists sealed_pools_by_tournament_ref
  on sealed_pools (tournament_ref) where tournament_ref is not null;
create index if not exists sealed_pools_legacy_by_bga_id
  on sealed_pools (tournament_id) where tournament_ref is null and tournament_id is not null;
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
  the tests use). `set_code` was relaxed to nullable by V2 (mono-faction sealed pools span several sets and store `NULL`); lot 2 cube and multi-set pools will use the same.
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
  "uniques": { "inBoosters": 1, "guaranteed": 1, "evenFactions": false, "faction": null },
  "excludeBanlist": false
}
```

- `source.type`: lot 1 accepts `set`; **V2 (2026-10-30) accepts `faction`**: `{ type: 'faction', faction, sets: { CODE: 1..3 }, boosters: 7 }` (weights 1–3, zero dropped, COREKS refused, `uniques.faction` forced to `faction`, `evenFactions` false); **V3 (2026-11-01, §13) accepts `multiset`**: `{ type: 'multiset', sets: { CODE: boosters }, boosters: 7 }` (counts 0–7, zero dropped, Σ = 7, COREKS refused; a multiset left with one set is **normalized to `set`**); **V5 (2026-11-06, §15) accepts `cube`**: `{ type: 'cube', name, origin, cubeId, cards: { ref: qty }, heroPool: [refs], boosters: 3..8, cardsPerBooster: 10..16, perFaction: 0|1|2 }` (the cube's content snapshotted by refs, never referenced by id; `uniques` forced to none and `excludeBanlist` to `false`; the pool is not a function of `(sub, nonce)` any more but a slot of one deal per tournament, §15.3).
- `uniques.randomOneIn` (V3, §13): `null` (default: the exact counts below) or an integer 1–10,
  "one unique in N boosters": every booster independently gets a unique in its last rare slot
  with probability 1/N. When set, `inBoosters` is forced to 0 and `evenFactions` to `false`
  (client values ignored, never an error); `guaranteed` and `faction` still apply. Config-only,
  like `uniques.faction`: not in the seed nor the snapshot columns.
- `heroes`: `packs` (one hero per booster) or `free` (no hero in boosters, every hero of the
  set appended to the pool — today's `heroes_in_pool = false`).
- `uniques.inBoosters` 0–7, `uniques.guaranteed` 0–7, `evenFactions` boolean (normalized to `false` when `inBoosters + guaranteed < 2`, when a faction is set, for a `faction` or `multiset` source, and in random mode). For a `multiset` source `inBoosters` is also capped at 3 × the boosters of the sets that have faction-range data (error `uniques.inBoosters`).
- `uniques.faction` (added 2026-10-26): `null` = all factions (default, also when absent), or
  one of `AX BR LY MU OR YZ`: every unique of the pool (inside boosters and guaranteed) is of
  that faction, its real one (out-of-faction prints included), still from the selected set.
  Normalized to `null` without any unique (no exact unique and no random mode). Config-only: not in the snapshot columns nor the
  seed (a pool with a faction is always stored, never regenerated).
- Conversion of a `current_format` row: `set_code → source.setCode`, `heroes_in_pool → heroes`,
  `unique_count → uniques.inBoosters`, `guaranteed_uniques → uniques.guaranteed`,
  `even_factions → uniques.evenFactions`, `excludeBanlist: false`.
- `banlist` (added 2026-11-04): the ban-list version (`src/lib/banlist.js`) the pools draw under,
  present only when `excludeBanlist`. The server always stamps the current one (`v2`, exact
  printings), whatever the client sends, on creation and on a config edit (only allowed while
  the tournament has no pool, so no pool ever changes list). Absent on a config stored before
  versioning = `v1` (whole cards and their uniques). Config-only: not in the seed nor the
  snapshot columns. The summary says "whole cards, list before Nov 4 2026" for `v1`.

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
generation and rejects banned uniques (both under the config's `banlist` version) (`pickDeterministicUniques` gets an optional
`isAllowed` predicate; its existing retry loop redraws). `uniques.faction` is passed as
`pickDeterministicUniques`'s `faction` option: every draw targets that faction (precedence over
`evenFactions`). **V2 branch:** `source.type = 'faction'` goes to `buildFactionPool` (`quotas()` exact split of the hero, common and rare card slots over the weighted sets, `generateFactionSealedPool`, uniques from range-capable sets only); the `set` branch is unchanged. **V3 branch (§13):** `source.type = 'multiset'` goes to `buildMultisetPool` (single-set boosters per set, shuffled; in-booster uniques of their booster's set, guaranteed uniques over the range-capable sets by a weighted draw), and `uniques.randomOneIn` adds a per-booster roll after the exact path of every source (the exact paths and their golden digests stay byte-identical). Lot 2 ports the Lobby's other sealed
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
   `UPDATE … SET tournament_ref = $2, adopted_at = now()` and return. Its contents keep coming from regeneration
   (or its stored copy once frozen). A pool still attached to a detached declaration is adopted the same way.
3. Else build from `tournament.config` with a fresh nonce and insert (§5.2), re-select on
   conflict. The insert is conditional on the tournament row (`FOR SHARE`) being live and still
   holding the config the pool was built from; otherwise re-read the tournament and retry (3
   attempts), then 409. A config edit or a detach that commits during generation thus never
   leaves a pool built from a stale config.

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
| `/api/tournament-bound-pools` | GET | required | Unchanged shape + `tournament: { id, name, startsAt, status } \| null` per pool (LEFT JOIN), + top-level `pending: { id, deck } \| null` (the pending prep pool, read only). |
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
| `/tournament` | `TournamentMenu.jsx` (reworked) | Header (title, "Create a tournament", BGA registration notice); **"My ongoing tournaments"** (logged in, when any): a grid of the started tournaments the player has a pool in, each card opening the tournament page with a direct "Change my deck" button; then **tabs**, each with a one-line explanation, the active one kept in the URL (`?tab=upcoming|ongoing|pools|created`): **Upcoming** (default, public), **Ongoing** (public: pools can still be prepared until the end), **My pools** (every bound pool, declared tournaments first; a card opens the tournament page, or the pool itself for a BGA tournament nobody declared, plus "Change my deck"), **My created tournaments** (`GET /api/tournaments?mine=1`, every status, grouped: ongoing then upcoming, each chronological, then a folded "Ended and cancelled (N)" block with the ended, cancelled and detached ones). The two personal tabs show a Connect box when logged out. **Below the tabs**, whatever tab is open, the generic "Tournament not listed here?" block: its button opens `/tournament/prep` (login first when logged out) and reads "Prepare my next tournament", or "See my pool and deck for my next tournament" once the player has a pending prep pool (`pending` from `GET /api/tournament-bound-pools`). |
| `/tournament/new` | `TournamentForm.jsx` | Create mode. Live validation (`src/lib/tournamentForm.js` `tournamentFormIssues`, the API's own pure checks + a duplicate-link lookup, `GET /api/tournaments?bgaId=`, debounced while typing; the unique index + 409 on submit stay the real guard): the submit button sits in a bar stuck to the bottom of the screen, disabled while problems remain, with the list of problems next to it (each one jumps to its field). |
| `/tournament/t/:id` | `TournamentDetail.jsx` | Header, description, checklist, organizer panel. |
| `/tournament/t/:id/edit` | `TournamentForm.jsx` | Edit mode; config section disabled when locked. Nothing of the form renders until `GET /api/tournaments/:id` (its `viewer` block) says the viewer may edit; anyone else goes straight to the tournament page (the PATCH is refused server-side anyway, 403). |
| `/tournament/t/:id/pool` | `TournamentPoolPage.jsx` | `TournamentPoolView` with `load = fetchTournamentPool(id)`, back link to the tournament. |

`TournamentForm.jsx` composition (lot 1):

- Info step: name, description (plain text, rendered as text), BGA link (client-side parse →
  "Tournament id 597924 detected" / error), start (`datetime-local`), end (optional). Timezone
  of the browser shown next to the inputs.
- Cards step: the preset set grid. Lot 1 shows "7 boosters of this set". Implemented as a
  small `SetPresetGrid.jsx` extracted from the Lobby's presets tab so both use it. V2 adds the
  "One set" / "Mono-faction mix" switch (`TournamentCardsSource.jsx`); V3 (§13.4) renames the
  first tab "Sets" and gives it a per-set booster split behind a "Mix several sets" disclosure,
  the grid staying the one-click "7 of this set" shortcut.
- Settings step: `SettingsFields` reused with `mode="sealed"`, a new `showLang={false}` prop
  (default `true` so the Lobby is unchanged), `showUniques={false}` (lot 1), `showBanlist`.
  Below it, the new `TournamentUniqueFields.jsx`: steppers for uniques in boosters and
  guaranteed uniques, the faction of the uniques (icon chips: all factions or one, disabled at
  0 unique), "even factions" checkbox (enabled when their sum ≥ 2 and no faction), with the set's
  faction-range availability driving a disabled state + hint for sets without data. V3 (§13.4)
  puts an "Exact number" / "Random, like real packs" switch above the in-booster count: the
  random side shows a "1 in N" slider instead of the stepper, the guaranteed stepper and the
  faction chips stay, "even factions" is hidden.
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
  Deployed, it runs inside the app container once the new version serves
  (`docker exec altered-draft node scripts/freeze-sealed-pools.mjs`; the image ships `scripts/freeze-sealed-pools.mjs`).
- Before deploying: the latest `current_format` row must not name a set without faction-range
  data with uniques (the unique draw now throws there); same check on the legacy rows to freeze.
  The full rollout is in `README.md` §10.1.
- New env vars (all optional): `TOURNAMENT_MODERATOR_ROLE`, `TOURNAMENT_MODERATORS`. On
  AlteredOps they must be added to the service's explicit `environment:` list.
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
| **V2. Mono-faction sealed** | source.type = 'faction', weighted sets, exact quotas, nullable set_code, recette page + Playwright steps | After lot 1 | 3–4 days |
| **V3. Multi-set sealed + random uniques** | source.type = 'multiset' (7 single-set boosters split over sets, normalized to `set` for one set), `uniques.randomOneIn` (one unique in N boosters, every source), the "Sets" tab with its disclosure, recette page + Playwright steps. Design in §13. Takes the "multi-set" and "random uniques" items out of lot 2. | After V2 (stacked on its branch) | 3–4 days |
| **V4. Private tournaments + share box** | `tournaments.visibility` (public / private, listing only), the §14.3 listing rule, the redacted `?bgaId=` answer, the private badge, the share box (copy, native share, local QR code), the Lobby's QR code moved to the same local component, recette page + Playwright steps. Design in §14. | After V3 (stacked on its branch) | 2.5–3 days |
| **V5. Cube sealed + player cap** | `source.type = 'cube'` (a community cube, the organizer's Re:Union decks or a pasted list, snapshotted in the config), one deal per tournament (every copy of a card given at most once across the players), cube booster settings (boosters per player, cards per booster, faction guarantee), a hero pool chosen in the form, `tournaments.max_players` (optional on every source, required for a cube), 409 `tournament_full`, the cube page, the generated booster cover, recette page + Playwright steps. Design in §15. Takes the "cubes" item out of lot 2. | After V4 (from `main`) | 5–7 days |

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
   (§2, §3.2). Its cost: the players whose pool was created for that declaration lose it and
   start over; pools that already existed on BGA before it are kept.
7. Non-goals restated: draft tournaments, notifications, BGA registration checks, nominative
   participant lists, card language as a setting, automatic expiry.

## 13. V3 — Multi-set sealed and random uniques (design, 2026-11-01)

Approved 2026-11-01 after the V2 review. Two additions to declared tournaments, shipped in one
PR stacked on V2's branch (`feat/multiset-sealed` from `feat/mono-faction-sealed`): a **multi-set
sealed** source (7 classic single-set boosters split over several sets) and a **random number of
uniques** option available with every source. Scope is declared tournaments only (`/tournament/new`,
stored pools, the BGA path): not the Lobby, not `current_format`, not the legacy pools, no change
to the BGA-facing contracts (the only addition is the `sourceType` key that `poolResponse` now
returns, so `/api/tournament-pool*` carry it too; additive, no consumer depends on its absence). Everything downstream of the stored pool (deck builder, Re:Union deck
sync, BGA deck-list validation) is unchanged.

### 13.1 Why

Playgroups mix sets at the table ("3 Skybound Odyssey, 3 Roots of Corruption, 1 Neverending
Journey") and the tool could only offer one set or the mono-faction mix. And the exact unique
counts of lot 1 are a tournament convention; a casual sealed opens real packs where each booster
has its own chance of a unique.

### 13.2 Decisions

| Topic | Decision |
| --- | --- |
| Config of the split | A third `source.type`, **`multiset`**: `{ type: 'multiset', sets: { CODE: boosters }, boosters: 7 }`. Counts are integers 0–7, zero dropped, visible sets only (COREKS refused), at least one set, **Σ = 7 exactly**. Error code `source.sets` for every shape problem (bad object, unknown or hidden set, count out of range, empty, Σ ≠ 7). |
| Normalization to `set` | A multiset left with **one** set after dropping zeros is stored as `{ type: 'set', setCode, boosters: 7 }`. So the main use case keeps `set_code`, the legacy seed, the golden digest, the imposed-format path and every existing tournament unchanged. The form always sends `multiset` for its "Sets" tab; the validator (shared by the API and the form's submit) normalizes. |
| Boosters | Each booster is a classic single-set booster of its set (1 hero + 9 commons + 3 rares, `generateOnePack` as in lot 1), set by set in `SETS` order, then the 7 boosters are **shuffled** with the pool rng so the reveal does not open 3 SKY then 3 ROC. Dedup by name within a set (lot 1's `splitPools`), reprints across sets distinct, never a duplicate within a booster. |
| Heroes | `packs`: the hero of a booster comes from that booster's set (as lot 1, drawn with replacement). `free`: every hero of every included set is appended once to the pool. |
| In-booster uniques, exact mode | A unique placed in a booster is **of that booster's set**, like a real pack. Only boosters whose set has faction-range data are eligible (a Neverending Journey booster never holds one). The `(booster, rare slot)` positions are shuffled with the pool rng over the eligible boosters and the first `inBoosters` taken (same mechanics as `swapUniquesIntoRareSlots`, restricted to eligible boosters). `inBoosters` is capped at 3 × the eligible boosters (error `uniques.inBoosters`). |
| Guaranteed uniques (multiset) | Each guaranteed unique's set is **drawn at random, weighted by the booster counts**, over the included sets that have range data (not exact quotas: decided 2026-11-01). Draw on the uniques rng stream. |
| Random mode | `uniques.randomOneIn: null | 1..10` ("one unique in N boosters", default when switched on: 8, i.e. 12.5 %, like real boosters). Available with the three sources. Every booster rolls independently on the pool rng, `rng() < 1 / N`; a hit replaces the booster's **last rare slot** with a unique. A hit on a booster whose set has no range data is dropped (the roll is still consumed). In random mode `inBoosters` is forced to 0 and `evenFactions` to `false` (client values ignored, never an error); **`guaranteed` and `faction` keep working**. |
| Random mode: set of the unique | `set` source: the set. `multiset`: the booster's set. `faction`: boosters mix sets, so the set is drawn by weight (the source weights) over the included sets that have range data, one draw per hit on the uniques rng stream. |
| Source of the uniques | Always the bundled faction-range tables through `pickDeterministicUniques` (deterministic from the nonce, offline, faction and ban list honoured, reproducible in tests). **Not** the live cards API: `random=1` was lot 2's idea to lift the FUGUE limit and is not taken here. Neverending Journey still gives no unique. |
| Where "no unique data" bites | `uniques.unsupportedSet` is raised when a unique is wanted (`inBoosters > 0`, `guaranteed > 0` or random mode) and no included set has range data. A multiset that mixes a set with data and one without is fine: its data-less boosters just never hold a unique, and the form says so. |
| Even factions | Hidden and forced `false` for a multi-set split (several sets after normalization), as it already is for the faction source: `pickDeterministicUniques` round-robins within one call, per set, so it could not be even across sets. Back for a single set (the normalized `set`). |
| Determinism | Still one seed string (`set_code` null for `multiset`, as for `faction`), two streams: the booster stream (`hashSeed(seedStr)`) for boosters, shuffle, slot positions and random rolls; the uniques stream (`hashSeed(seedStr + '#uniques')`) for set draws and `pickDeterministicUniques`. The exact paths of the `set` and `faction` sources consume the streams exactly as before: their golden digests must not move. New goldens pin the multiset draw and the random mode on each source. `randomOneIn` is config-only (not in the seed nor the snapshot columns): these pools are always stored. |
| Data | No schema change: `set_code` is already nullable (V2); a `multiset` pool stores `NULL`, its sets come from the refs (`buildCardMap`, the pool page). |
| Pool page | The booster cover is shown for a **set-pure booster** of a pool whose source is not `faction` (a multiset pool's ROC boosters show the Roots of Corruption pack); the pool response exposes `sourceType` (from the stored `sealed_pools.config`, `'set'` when absent) for that. |
| Summary line | `7 boosters · SKY ×4, ROC ×3` (SETS order, `×1` omitted as in V2) for a multiset; one set unchanged. Random mode: `1 unique in 8 boosters` (`a unique in every booster` for N = 1), then the guaranteed, faction, hero and ban-list parts as today; no "even factions" part in random mode. |
| Form, Cards section | The switch's first tab is renamed **"Sets"** ("Extensions" in FR). One model, the per-set counts; two views: the **grid** (one click = 7 boosters of that set, click again = none) and a **"Mix several sets" disclosure** (an accordion: a full-width bordered header with the hint "Split the 7 boosters across several sets" and a chevron, the steppers panel attached below it), closed by default, with one stepper 0–7 per visible set and a `n / 7` counter; "+" greys out when the total is 7. The grid shows a `×n` badge on a set at 1–6 boosters and the ✓ at 7. The disclosure opens by itself when an edited tournament is a multiset. |
| Form, Settings section | Above the in-booster count, a two-way switch **"Exact number" / "Random, like real packs"**. Random: a slider "Chance of a unique per booster" from "1 in 10" (left) to "every booster" (right), default 1 in 8, with the live text "1 booster in N (12.5 %)". The guaranteed stepper and the faction chips stay in both modes; "even factions" only in exact mode. Each mode keeps its own value in the form state, only the active one is sent. Default mode: exact (the beta's behaviour). |
| Recette | A new page `docs/tournaments/acceptance-multiset-sealed.html` ("Multi-set sealed and random uniques — V3", ids `ms-<group>-<slug>`), covering the format **and** the random option on the three sources; added to `scripts/e2e-acceptance-coverage.mjs`'s `ACCEPTANCE_PAGES`. Playwright `tests/e2e/specs/multiset-sealed.spec.js`. |

### 13.3 Generation (`buildMultisetPool` and the random roll)

```
seedStr = sub | null | unique_count | even_factions | heroes_in_pool | guaranteed_uniques | nonce
rng  = mulberry32(hashSeed(seedStr))             # booster stream
uRng = mulberry32(hashSeed(seedStr + '#uniques')) # uniques stream
```

`buildMultisetPool(sub, { config, nonce }, fetchCards)` in `src/lib/poolBuilder.js`:

1. `setCodes = configSetCodes(config)` (the `sets` keys in `SETS` order; `configSetCodes` learns
   the `multiset` type). Fetch each set once (`fetchCards(code)`, never `Array.map(fetchCards)`),
   apply the ban list per set when `excludeBanlist`.
2. `boosters = generateMultisetSealedPool(cardsBySet, rng, { counts, includeHeroes })`
   (`src/lib/packGenerator.js`): for each set in `SETS` order, `splitPools` then `counts[set]`
   boosters by `generateOnePack(heroes, commons, rares, [], i, 0, rng)`; then `shuffle(boosters, rng)`.
   A booster's set is `setCodeFromRef(booster[0])` (set-pure, hero or common first).
3. In-booster positions:
   - exact mode: `pickRareSlots(boosters, eligibleIdx, inBoosters, rng, rareStart)` — the generalization
     of `swapUniquesIntoRareSlots` that takes the eligible booster indices (sets with range
     data); called with every index it consumes the rng exactly as before, so lot 1 / V2 keep
     their digests. Positions are grouped by the booster's set, in the order drawn. Fewer
     positions than `inBoosters` → throw (the validator's cap makes it unreachable).
   - random mode: `rollBoosterHits(boosters.length, randomOneIn, rng)`, i.e. for `b` in booster
     order `hit = rng() < 1 / randomOneIn`; a hit on an eligible booster adds the position
     `(b, lastSlot)` (the booster's last ref, a rare); other hits are dropped.
4. Guaranteed: for each of `guaranteed`, draw a set on `uRng` weighted by the booster counts
   over the eligible sets (`pickWeightedSet`, `src/lib/packGenerator.js`: cumulative draw, sets
   in `SETS` order).
5. For each eligible set in `SETS` order with a need: one `pickDeterministicUniques(set, uRng,
   { uniqueCount: inSet + outSet, faction, isAllowed })`; the first `inSet` refs fill that
   set's positions in the order of step 3, the rest are the guaranteed uniques. `isAllowed` is
   the per-pool gate (`uniqueGate`, module-private, used by every source): it rejects banned
   uniques (when `excludeBanlist`, under the config's `banlist` version) **and** any ref already drawn for this pool, so two calls
   never hand out the same serial. Fewer refs than wanted → throw (as today).
6. `cards` = counts of every booster ref + guaranteed refs + (heroes `free`) every hero of every
   included set once.

Random mode on the other sources (after their exact path, which is untouched; with
`inBoosters = 0` that path only draws the guaranteed uniques), through the exported
`placeRandomUniques(boosters, { rng, uRng, oneIn, setForHit, faction, isAllowed, onDrawn })`:

- `set`: roll every booster on `rng` (step 3, random); hits → one extra `pickDeterministicUniques`
  call for the set, refs placed in the hit boosters' last rare slot.
- `faction`: roll every booster on `rng`; per hit, draw the set on `uRng` by weight over the
  included range-capable sets (`pickWeightedSet`, drawn as each hit is rolled); then per set in
  `SETS` order one extra call. Every call takes the `uniqueGate` predicate, so a ref drawn by the
  exact path is never drawn again.

Rng consumption order is part of the contract (golden tests): boosters, shuffle, positions or
rolls on the booster stream; set draws then per-set unique calls on the uniques stream.

### 13.4 Form and pages

**Cards section ("Sets" tab).** State `setCounts: { CODE: n }` (only n > 0) replaces `setCode`.
`SetPresetGrid` takes an optional `counts` prop (badge `×n` at 1–6,
`data-testid="set-badge-<CODE>"`; the ✓ and `aria-pressed` stay driven by `selected`, which the
form sets to the set holding all 7; the Lobby keeps calling it without `counts`, unchanged); `onSelect(code)` → `{ [code]: 7 }`, `onSelect(null)` → `{}`.
The disclosure (`data-testid="set-mix-toggle"`, `aria-expanded`) wraps the generalized
`SetWeightsList` (props `max`, `maxTotal`, `format`, `trailing`, `testIdPrefix`; the faction tab
keeps `set-weight-<CODE>`, the Sets tab uses `set-count-<CODE>`) and the counter
(`data-testid="set-count-total"`, "n / 7", `text-ok` at 7, `text-accent-ink` otherwise; shown
while the disclosure is open or the split has several sets). The config sent is
`{ type: 'multiset', sets: setCounts, boosters: 7 }`; the live issue on `source.sets` reads
"Choose a set." at 0 boosters and "The boosters must add up to 7 (n now)." otherwise (the "+"
cap makes > 7 impossible from the UI); the faction tab keeps "Include at least one set.".
The in-booster cap (3 × the boosters of sets with range data, only finite when a data-less set
is in the split) caps the exact stepper and, for a value already past it after the sets
changed, shows "Too many uniques in boosters for the sets with unique data (n max)." on
`uniques.inBoosters` (never clamped silently).
`uniqueSupport` = no set chosen, or at least one chosen set with range data; a chosen set
without data next to one with data shows the hint "Boosters of Neverending Journey never hold a
unique: no unique data yet." in the uniques block. Draft (sessionStorage), edit prefill and the
imposed legacy format all read and write `setCounts` (`set` → `{ [setCode]: 7 }`, an old draft's
`setCode` too).

**Settings section.** `TournamentUniqueFields` (new props `partialSupport`, `multiSet`,
`maxInBoosters`, `lastOneIn` / `onLastOneIn`) gains the mode switch (radiogroup, aria-label
"Uniques inside boosters", `data-testid="uniques-mode-exact"` / `"uniques-mode-random"`), the slider (`<input type="range" min=1 max=10>` whose position is `11 - N`,
so the handle and the fill move right as uniques get more frequent and the arrow keys follow, `data-testid="random-one-in"`,
`aria-valuetext` = the live text, also shown in `data-testid="random-one-in-text"`), hides the in-booster stepper in random mode and "even
factions" in random mode or for a multi-set split. The form state keeps `uniques.randomOneIn`
(null in exact mode) plus the last values of both modes.

**Summary** (`configSummaryParts`): see §13.2. **Pool page**: `PackReveal` derives the cover per
booster (set-pure and `sourceType !== 'faction'`) instead of the `noCover` flag;
`TournamentPoolView` passes `pool.sourceType` (the client-side `mixedSets` state is gone);
`poolResponse` adds `sourceType`.

**i18n** (`tournaments.*`, EN + FR): `sourceSets` ("Sets" / "Extensions"), `cardsHint` reworded
("Each player receives 7 boosters. Pick a set, or mix several below."), `mixSetsToggle`,
`mixSetsHint`, `mixSetsCounter` ("{{n}} / 7"), `errBoostersTotal`, `errUniquesTooMany`, `uniquesModeLabel`, `uniquesModeExact`,
`uniquesModeRandom`, `randomOneInLabel`, `randomOneInText` ("1 booster in {{n}} ({{pct}} %)"),
`randomOneInEvery` ("every booster (100 %)"), `randomOneInMin` ("1 in 10"), `randomOneInMax`
("every booster"), `randomOneInHint`,
`uniquesPartialSupport`, `summaryUniquesRandom` ("1 unique in {{n}} boosters"),
`summaryUniquesEvery` ("a unique in every booster"). `sourceOneSet` is removed.

### 13.5 Tests and recette

- Unit: `tournamentConfig` (multiset shape, Σ, normalization to `set`, `configSetCodes`,
  `randomOneIn` bounds and forcing, `unsupportedSet` with random, the `inBoosters` cap, even
  factions forced off); `packGenerator` (`generateMultisetSealedPool` counts per set, set-pure
  boosters, hero from its set, deterministic shuffle; `pickRareSlots` eligible-only and
  byte-identical to the old swap when every booster is eligible); `poolBuilder` (multiset exact,
  guaranteed weighted draw, random mode on each source at N = 1 and N = 10, the dropped hit on a
  data-less booster, the shared `isAllowed`, throws); goldens: the two existing digests
  unchanged, new digests for a multiset exact pool and for random mode on `set`, `multiset`,
  `faction`; `TournamentBits` summary parts; `tournamentForm` issues.
- Integration: 400 codes for every multiset / random refusal, normalization to `set` on POST
  and PATCH, a multiset pool stored with `set_code NULL`, BGA path on a multiset tournament.
- E2E (fixtures CYCLONE / EOLE / FUGUE; the V3 tournament is **SKY ×3, ROC ×3, NEJ ×1**): the
  Sets tab (grid shortcut, badges, disclosure, counter, issues), create (stored config and
  summary), the pool (3 / 3 / 1 boosters, ROC boosters with the pack cover, SKY and NEJ
  without, heroes of their set, no duplicate in a booster), exact uniques (2 in boosters of
  their booster's set, never NEJ; 1 guaranteed from SKY or ROC), random at N = 1 on the three
  sources (every eligible booster's last slot is a unique, the NEJ booster's is not), API
  guards, the lock on edit, 375 px. Random at N > 1 is not asserted on counts (the nonce is
  random): only the stored config and the summary.
- Recette page groups: 0 setup, A the Sets tab, B create, C the pool, D exact uniques in a
  multi-set, E random uniques (set / multi-set / mono-faction), F API guards and normalization,
  G BGA path, H edit and lock, I FR / theme / mobile / console, K before production. BGA ids
  123490–123499 (123499: a throwaway tournament, created then deleted in `ms-e-summary`).
  As built: 35 steps, 19 replayed by `multiset-sealed.spec.js`; the V2 steps that quoted "One set"
  were reworded and re-id'd (`mf-a-switch-r2`, `mf-a-hints-r2`, `mf-g-imposed-r2`).

### 13.6 Left to the builder

- The exact Tailwind layout of the disclosure and the slider (semantic tokens only; the slider's
  track colour may stay the browser default with `accent-accent`).
- Whether `SetWeightsList` is renamed (`SetCountsList` would read better) — a rename must update
  the V2 tests and recette text that mention it. **As built:** kept, generalized with `max`,
  `maxTotal`, `format`, `trailing`, `testIdPrefix`.
- The split of `buildMultisetPool` into helpers shared with the random roll of the other sources,
  as long as §13.3's rng order holds and the two existing goldens do not move. **As built:**
  `placeRandomUniques` serves `set` and `faction`; `buildMultisetPool` rolls inline (its hits
  share the per-set call with the guaranteed uniques); `uniqueGate` is shared by all three.

## 14. V4 — Private tournaments and the share box (design, 2026-11-01)

Approved 2026-11-01 after the V3 review. Two additions to declared tournaments, shipped in one
PR stacked on V3's branch (`feat/private-tournaments` from `feat/multiset-sealed`, retargeted to
`main` as the stack merges): a **visibility** on every declared tournament (`public`, the default,
or `private`: listed only to the people it concerns) and a **share box** on every tournament page
(link, copy, native share sheet, QR code). The QR code is generated locally, and the Lobby's QR
code moves to the same component. Scope is declared tournaments only (`/tournament/new`, the hub,
the tournament page): no change to the pools, to `current_format`, to the legacy pools nor to the
BGA-facing contracts. Everything downstream of a tournament (pool creation, deck builder, Re:Union
deck sync, BGA deck-list validation) is unchanged.

**"Private" hides, it does not protect.** A private tournament is simply absent from the public
lists for the people it does not concern. Its page, its pool creation and the BGA path work exactly
as for a public one: anyone with the link can prepare a pool, and a player registered on BGA gets a
pool at their first game whatever the visibility (§6). An access control would only make sense with
invitations, which are out of scope (§14.7).

### 14.1 Why

Playgroups and clubs run invitation-only events and do not want them next to the community
tournaments in Upcoming and Ongoing; today every declaration is public the moment it is created.
And the only way to hand a tournament's link to the players is the address bar, while the Lobby
has had a share box with a QR code from the start.

### 14.2 Decisions

| Topic | Decision |
| --- | --- |
| Meaning of private | **Listing only.** Not listed in Upcoming / Ongoing for anonymous visitors and for logged-in players who have nothing to do with it. The page by URL, "Open your pool", the pool page, "My pools", the checklist, the organizer panel, the moderator actions and the BGA path are identical for both visibilities. |
| Who sees a private tournament in the public lists | Its **organizer**, every player who **has a pool** on it (`sealed_pools.sub` with that `tournament_ref`, whether the pool was created by the page or by a BGA call), and the **moderators**. Nobody else, anonymous included. One rule, applied in SQL for the lists (§14.3) and by a pure helper for the single-item lookup. |
| Data | `tournaments.visibility text not null default 'public' check (visibility in ('public', 'private'))`, added idempotently (`alter table … add column if not exists`); existing rows become `public` through the default. No index: the filter rides the status scan. |
| API field | `visibility: 'public' \| 'private'` on every tournament JSON. Optional on create (absent, `null` or empty → `public`); editable by PATCH like `name` (validated only when the key is sent), in every status but detached, **never locked** by the pools (making a tournament public after players prepared pools is a supported case). Anything else → 400 `fields.visibility = 'invalid_visibility'`. |
| Hub | No new UI besides the badge: the public tabs show the filtered list, so "My ongoing tournaments" (derived from it) and the tab counters follow. No "private" filter, no separate tab. "My pools" and "My created tournaments" are personal by construction and unchanged. |
| Badge | A `PrivateBadge` pill in `TournamentBits.jsx`: an inline SVG padlock (`currentColor`, `aria-hidden`) + the word "Private", `title` "Private tournament: not listed publicly", `data-testid="tournament-private"`, muted style (`text-muted border-line bg-surface2`). Shown **after** the status pill on every tournament card of the hub (public tabs, "My pools", "My created tournaments") and in the tournament page header. Not on the pool page. (After the status pill: the e2e `tournamentLink()` helper matches a card by "name Status …".) **As built:** the "My ongoing tournaments" cards have no status pill, so there the badge sits right after the name. |
| `?bgaId=` lookup | When the live declaration of that BGA id is private and the viewer may not see it, the item is **redacted to `{ visibility: 'private' }`**: no id, name, organizer, config, dates, pool count nor viewer block. The form keeps refusing the link ("A tournament already exists for this BGA link.", wording unchanged): `takenBgaIds` stores `holder.id ?? 'private'`, a sentinel that never equals `ownId` (as built, `TournamentForm.jsx`). `legacy` is unchanged (legacy pools are not a declaration). The organizer editing their own private tournament still gets the full item, so their own link is not "taken". |
| Form | Section 1, under the description: a radio group "Visibility" with "Public — Listed in Upcoming and Ongoing for everyone." and "Private — Listed only for you, the players who have a pool and the moderators. Share its link." Default `public`; prefilled in edit mode; always enabled; kept in the `sessionStorage` draft across the Keycloak round trip. Sent on create and on every PATCH, like `name`. |
| Share box | `ShareBox.jsx` on the tournament page, for every tournament but a detached one, between the checklist and the organizer panel, visible logged out too. Title "Share this tournament", a hint (a private tournament: "This tournament is private: its link is the only way to find it.", in every status; a public one: "Anyone with the link can open this page and prepare a pool.", only while it is upcoming or ongoing, no hint once cancelled or ended), the absolute URL `${location.origin}/tournament/t/<id>` in a read-only input, a **Copy** button (the Lobby's behaviour: "✓ Copied" for 2 s; `navigator.clipboard` first, then the `execCommand` textarea fallback of `ExportMenu`'s `copyText`, and when both fail the input text is focused and selected so the user copies by hand; never a thrown error), a **Share…** button rendered only when `navigator.share` exists (`navigator.share({ title: name, url })`; as built, `nativeShare` swallows any rejection, an `AbortError` or another one, and resolves `false`), and the **QR code** of the URL (hidden below `sm`, like the Lobby's). **As built:** the helpers live in `src/lib/share.js` (`copyText`, `canNativeShare`, `nativeShare`, `tournamentShareUrl`), shared with `ExportMenu`; `copyText` now returns the result of `execCommand('copy')` instead of `true` (a refused copy used to be reported as done), so `ExportMenu` shows its "copy failed" toast when the fallback is refused. |
| QR code | Generated **locally** with `qrcode-generator` (2.0.4, MIT, no transitive dependency, ESM entry): a pure `src/lib/qr.js` (`qrSvgPath(text, { level: 'M' }) → { size, d }`, the dark modules as one SVG path, unit-tested) rendered by `QrCode.jsx` (`<svg viewBox>` with a 4-module quiet zone, `role="img"` + `aria-label`). **Always dark modules on a white tile, in both themes** (literal `#000` / `#fff` on purpose: inverted QR codes are not read by every scanner, so the QR is content with a scanning contract, not chrome). Nothing leaves the browser: no request to `api.qrserver.com` any more. |
| Lobby | `Lobby.jsx` replaces its `api.qrserver.com` `<img>` with `<QrCode value={joinUrl} />` (same place, same 120 px, same `lobby.qrCodeAlt` label); `tests/e2e/support/network.js` drops the `api.qrserver.com` exception, so a request there is a leak again and fails the test. |
| Bound pools | `/api/tournament-bound-pools` adds `visibility` to each pool's `tournament` block (the "My pools" cards show the badge); the list itself is unchanged (own pools). |
| i18n | `tournaments.*` (EN + FR): `visibilityLabel`, `visibilityPublic`, `visibilityPublicHint`, `visibilityPrivate`, `visibilityPrivateHint`, `errVisibility`, `privateBadge`, `privateBadgeTitle`, `shareTitle`, `shareHint`, `sharePrivateHint`, `shareCopy`, `shareCopied`, `shareNative`, `shareQrAlt`. `lobby.qrCodeAlt` stays. |
| Recette | A new page `docs/tournaments/acceptance-private-tournaments.html` ("Private tournaments and the share box — V4", ids `pv-<group>-<slug>`, BGA ids 123500–123509), fourth entry of `scripts/e2e-acceptance-coverage.mjs`'s `ACCEPTANCE_PAGES`. Playwright `tests/e2e/specs/private-tournaments.spec.js`. **As built:** 35 steps, 24 replayed (4 of them partially); group E runs before D (carol must still be a stranger), an extra step `pv-g-copy-fallback` covers the refused copy, and every real phone check (scanning both QR codes, the phone's share sheet, joining a room by scan) is in `pv-k-preprod`, the local steps only checking what the scan preview shows. |
| Branch | `feat/private-tournaments` from `feat/multiset-sealed` (PR #26), in its own git worktree (another session works in the main checkout); draft PR based on `feat/multiset-sealed`, retargeted as the stack merges, updated with merge commits, never rebased. |

### 14.3 Listing rule

`listTournaments(status, viewer)` (`src/lib/tournamentStore.js`), `viewer = { sub, isModerator } | null`:

```sql
SELECT t.* FROM tournaments t
WHERE <status filter, unchanged>
  AND (t.visibility = 'public'
       OR $2                                   -- the viewer is a moderator
       OR t.organizer_sub = $1
       OR EXISTS (SELECT 1 FROM sealed_pools p WHERE p.tournament_ref = t.id AND p.sub = $1))
ORDER BY t.starts_at ASC, t.created_at ASC
```

with `$1 = viewer?.sub ?? null` and `$2 = viewer?.isModerator ?? false` (a null `$1` makes the
last two branches false, so anonymous callers get the public rows only). `listTournamentsByOrganizer`
(`?mine=1`) and `listBoundTournamentPools` need no filter. The same rule as a pure function,
`canSeeTournament(row, viewer, { hasPool })` in `src/lib/tournamentRules.js` (DB rows, snake_case),
decides the redaction of the `?bgaId=` item in `api/tournaments/index.js` (`hasPool` from the
`poolSummariesForTournaments` call the handler already makes). The detail endpoint never filters:
the page is reachable by URL by design.

### 14.4 API

| Endpoint | Change |
| --- | --- |
| `GET /api/tournaments?status=` | Rows filtered by §14.3 with the caller's verified identity (a bad or expired bearer is still the anonymous view, never a 401). Each item carries `visibility`. |
| `GET /api/tournaments?bgaId=` | The live declaration as today when visible to the caller; `{ visibility: 'private' }` alone otherwise. `legacy` unchanged. |
| `GET /api/tournaments?mine=1` | Unchanged (the organizer's own); items carry `visibility`. |
| `POST /api/tournaments` | Accepts `visibility` (optional, default `public`); 400 `fields.visibility = 'invalid_visibility'` otherwise. |
| `GET /api/tournaments/:id` | Unchanged behaviour, `visibility` in the JSON. |
| `PATCH /api/tournaments/:id` | Accepts `visibility` like `name` (any status but detached, never 409 `tournament_locked` for it). |
| `GET /api/tournament-bound-pools` | `tournament.visibility` added per pool. |
| `/api/tournaments/:id/pool`, the BGA-facing endpoints | **Unchanged.** |

### 14.5 Form, hub, tournament page

**Form.** State `visibility` (`'public'` by default), the radio group under the description
(`data-testid="visibility-public"` / `"visibility-private"`, labels from `visibilityPublic` /
`visibilityPrivate`, each option with its hint as description), part of the draft
(`tournament_form_draft:*`) and of the edit prefill. `tournamentFormIssues` maps `fields.visibility`
to the `visibility` field (after `description` in `FIELD_ORDER`); unreachable from the UI (radios),
kept for the API path. The `body` sent on create and on PATCH includes `visibility`.

**Hub.** `TournamentCard` (public tabs and the created groups) and the "My pools" card
(`p.tournament.visibility`) render `<PrivateBadge />` after the status pill when
`visibility === 'private'`; the "My ongoing tournaments" card, which has no status pill, renders it
after the name.

**Tournament page.** The header shows the badge after the status pill. The share box sits between
the checklist and the organizer panel, for every status but detached (`data-testid="share-box"`,
`share-url` on the input, `share-copy`, `share-native`, `share-qr`). As built, a failed copy focuses
and selects `share-url`; the label stays "Copy". Added after the recette (pv-i-mobile-r2): below
`sm`, where the inline QR is hidden, a "Show QR code" button (`share-qr-open`) opens the QR large
in a dialog (`QrModal.jsx`) with a "Close" button; a click outside or Escape closes it too.

**Lobby.** Only the QR `<img>` changes (§14.2).

### 14.6 Tests and recette

- Unit: `tournamentRules` (`validateTournamentFields`: default `public` on create, both values
  accepted, anything else `invalid_visibility`, a patch validates only when the key is present;
  `canSeeTournament` matrix: public / organizer / pool holder / moderator / anonymous / stranger);
  `tournamentForm` (issue mapping and order); `qr.js` (deterministic output for a fixed string, the
  size grows with the text, the path stays on the module grid, throws on empty input);
  `TournamentBits` (the badge markup: test id, title, `aria-hidden` icon); `share.js` (the
absolute URL, native share unsupported / supported / dismissed).
- Integration: the column with its default on a schema replay; the `listTournaments` matrix
  (anonymous, logged-in stranger, organizer, pool holder whose pool came from the page, pool holder
  whose pool came from a BGA call, moderator) over a private and a public tournament; POST default
  and 400; PATCH `visibility` on an upcoming, a cancelled and a locked (with pools) tournament, 409
  on a detached one; `?bgaId=` redaction for a stranger and for anonymous, the full item for the
  organizer, a pool holder and a moderator; `tournament-bound-pools` carrying `visibility`.
- E2E (`private-tournaments.spec.js`; personas: alice organizer, bob moderator, carol stranger
  until she prepares a pool, plus anonymous): the radio (default, hints, create private → stored,
  badge on the page and in "My created tournaments"); the lists (alice sees it in Upcoming with the
  badge; bob too; carol does not; anonymous does not; the counters match); the link (carol opens the
  page by URL, prepares a pool, then sees it in Upcoming and "My pools" with the badge; once started,
  in "My ongoing tournaments"); the duplicate-link check as carol (redacted answer, form blocked, no
  name shown) and as alice editing it (not blocked); edit (private → public with a pool: anonymous
  now sees it; back to private: anonymous does not); the share box (URL, Copy with clipboard
  permissions granted → the clipboard holds the URL and the label flips; Copy refused by both
methods → the URL selected, the label unchanged; Share… absent in Chromium,
  present and called with the URL when `navigator.share` is injected with `addInitScript`; the QR
  `<svg>` with a non-empty path, black on white in both themes); the Lobby QR (an `<svg>`, no
  `api.qrserver.com` request); 375 px (form radios, share box, no horizontal scroll); FR (no raw
  key on the new strings).
- Recette groups: 0 setup (lot 1 stack, branch, `make dev` with the `visibility` column check,
  suites, coverage with four pages, clean ids), A form, B create, C lists per persona, D link access
  and pools, E duplicate-link check, F edit both ways with pools, G share box (copy, native share on
  a phone, QR scanned with a phone), H Lobby QR, I FR / theme / mobile / console, K before
  production (a private tournament on preprod, the lists as a moderator and as a stranger, the QR
  scanned). **As built:** E is shown and run before D (carol must still be a stranger to the
  private tournament when she types its link); G gained `pv-g-copy-fallback` (the refused copy,
  simulated from the DevTools console) and `pv-g-detached`; the phone checks of G and H (opening the
  scanned link, the phone's share sheet, joining a room by scan) moved to `pv-k-preprod`, since a
  phone cannot open `localhost`. 35 steps, 24 replayed by `private-tournaments.spec.js`.

### 14.7 Non-goals and what was weighed

- **Invitations by pseudo** (asked, weighed, kept out). No service can resolve a pseudo: Keycloak's
  userinfo reveals the caller only, the user search is an admin API that would need Re:Union to
  grant the `altered-draft` client a service account with `view-users`, and decks-api exposes
  `/api/decks` only (its OpenAPI, checked 2026-11-01). Options studied: (a) the shared link is the
  invitation, chosen; (b) pseudos stored as typed (`tournament_invites`) and matched to the `pseudo`
  claim at login, no validation possible at entry and pseudos not guaranteed unique, about one day,
  possible later as its own PR; (c) a real Keycloak lookup once Re:Union grants the role. The
  listing rule of §14.3 is written so that (b) is one more `OR EXISTS` branch.
- **Access control** on private tournaments (refusing "Open your pool" to strangers): meaningless
  while the BGA path creates pools for every BGA player, and only useful with (b) or (c).
- Secret links or tokens: the UUID in the URL already is one (unguessable, never listed).
- Notifications, a "private" filter or tab, a visibility on the Lobby rooms.

### 14.8 Left to the builder

- The exact Tailwind layout of the radio group and of the share box (semantic tokens only; the QR
  tile is the one place with literal colours, see §14.2). **As built:** the radios are two bordered
  option cards side by side from `sm` (stacked below), the checked one `border-accent`; the share box
  is a `bg-surface` card, link and buttons on the left, the QR on the right.
- Whether the Copy / native-share helpers are extracted to a small `src/lib/share.js` shared with
  `ExportMenu`'s `copyText`, or kept local to `ShareBox`. **As built:** extracted (`copyText`,
  `canNativeShare`, `nativeShare`, `tournamentShareUrl`); `ExportMenu` imports `copyText`, which
  now reports a refused `execCommand` copy as a failure (§14.2).
- The `QrCode` component's props (`value`, `size`, `label`, `className`, `testId`), as long as the
  Lobby and the share box both render through it. **As built:** exactly those, `size` = 120 and
  `testId` = `qr-code` by default (the share box passes `share-qr`).

## 15. V5 — Cube sealed and the player cap (design, 2026-11-06)

Approved 2026-11-06 after the V4 merge. Two additions to declared tournaments, shipped in one PR
on `feat/cube-sealed` (from `main`, #27 merged): a **cube sealed** source (the boosters are dealt
from a fixed card list, every copy of a card given to at most one player) and a **player cap**
(`tournaments.max_players`, optional on every source, required for a cube, which the deal
needs). Scope is declared tournaments only (`/tournament/new`, stored pools, the BGA path): not
the Lobby's own cube sealed (which keeps dealing every player from the same pool, cards shared),
not `current_format`, not the legacy pools, no change to the BGA-facing contracts beyond one new
409 (`tournament_full`, below). Everything downstream of a stored pool (deck builder, Re:Union
deck sync, BGA deck-list validation) is unchanged: a cube pool is a normal `sealed_pools` row
with `cards` and `boosters`.

**A cube pool is not a function of `(sub, config, nonce)`.** Every source so far builds each
player's pool in isolation. "A card of the cube is given only once" is a property of the
tournament, not of a pool, so a cube tournament is **dealt once**: at its first pool the whole
cube is shuffled and cut into `max_players` lots of boosters (§15.3); every pool then claims the
next free lot under a row lock. The lots are stored (`tournament_cube_slots`), the pools are
stored as today, nothing is ever regenerated.

### 15.1 Why

Cube sealed is how playgroups play a curated list: the organizer builds the cube, every player
opens boosters from it, and a card opened by one player is not opened by another, which is the
whole point of a cube over a set. The Lobby offers cubes (community cubes, the player's Re:Union
decks, a pasted list) but its sealed path deals every player from the same pool, so two players
can open the same copy. Declared tournaments had no cube source at all. And a cube is finite:
once its lots are dealt no new player can join, so tournaments need a player cap, which BGA
cannot enforce for us (an organizer sets the same cap on BGA by hand).

### 15.2 Decisions

| Topic | Decision |
| --- | --- |
| Config of the source | A fourth `source.type`, **`cube`**: `{ type: 'cube', name, origin, cubeId, cards, heroPool, boosters, cardsPerBooster, perFaction }`. `name` 1–80 chars (trimmed; the organizer may edit it). `origin` ∈ `community` \| `reunion` \| `paste` (display only); `cubeId` the community cube's id (`src/lib/cubes.js`) when `origin === 'community'`, else `null`. `cards` = `{ ref: qty }` (qty 1–99, Σ ≤ **1500**), the cube's non-hero cards, every ref in its **stored form** (below): the `B` printing of a known set (hidden COREKS allowed), a unique `_U_<serial>`, or a non-`B` printing (`_A_` / `_P_`) of a known set that has no `B` twin, kept as given. `heroPool` = the distinct hero refs the organizer selected (1–200, sorted, same forms). Error codes: `source.name`, `source.origin`, `source.cubeId`, `source.cards` (shape, a bad ref, a bad qty, Σ > 1500 or empty), `source.heroPool` (shape, empty, a bad ref), `source.boosters` (not 3–8), `source.cardsPerBooster` (not 10–16), `source.perFaction` (not 0, 1 or 2, or 2 with fewer than 12 cards per booster), `source.poolSize` (`boosters × cardsPerBooster < 60`). The pure validator checks shapes and ranges only; whether a ref exists, is a hero or not, and the capacity are server checks (§15.4). |
| Booster composition | `cardsPerBooster` non-hero cards (10–16, default 12): first `perFaction` cards of each faction in `FACTIONS` order (`perFaction` = 0 none, 1 one of each = 6 cards, 2 two of each = 12 cards, which needs `cardsPerBooster ≥ 12`), then the rest drawn at random from what is left. **Rarity plays no part**: commons, rares, exalted and uniques of the cube are all dealt the same way. `heroes: 'packs'` adds one hero in slot 0 (so a booster shows 13 cards at the default), `free` adds every hero of `heroPool` to each pool and no hero in the boosters. Defaults in the form: 7 boosters, 12 cards, one of each faction, heroes in boosters. The faction of a card is the card object's `faction` (`mainFaction`), so an out-of-faction `_R2` print counts for its real faction and a unique for its own. |
| Every copy once | The cube is a multiset (`qty` copies of a ref are `qty` distinct copies). Over the whole deal a copy is used at most once. Two copies of the same card **may** land in the same booster when the cube lists several copies (no intra-booster dedup: a cube that lists duplicates means it). |
| Heroes | Heroes are **never cube cards** and are **not** subject to "every copy once". The hero refs found in a pasted list or an imported deck are split out (as the Lobby does) and become the preselected `heroPool`; a community cube's `heroes` likewise. The organizer edits the selection from **every hero of the game** (the `HERO` cards of every visible set, `B` printings, deduplicated by reference), grouped by faction with a search box and per-faction "All" / "None". At least one hero. `packs`: for each lot, the pool is shuffled and booster *i* gets hero `i mod n`, so a player's boosters hold distinct heroes until the pool is exhausted, and the draw is independent between players (a hero may appear in every player's boosters). `free`: `heroPool` appended once to each pool's `cards`. |
| Settings hidden for a cube | The whole uniques block (exact / random, guaranteed, faction, even factions) and the ban list: `uniques` is normalized to `{ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null }` and `excludeBanlist` to `false` (no `banlist` key), client values ignored, never an error. The cube's own uniques are ordinary cards. The summary line never shows those parts for a cube. |
| Player cap | New column `tournaments.max_players int null check (max_players between 2 and 256)`. API field `maxPlayers`: `null` = no limit (the default, and the only possible value before V5), else an integer 2–256 (`fields.maxPlayers = 'invalid_max_players'`). **Required for a cube** (`'required_for_cube'`) and **at most the cube's capacity** (`'above_capacity'`, the 400 body also carries `capacity`). Shown everywhere as "N / M players" next to the pool count, with a **Full** pill once `poolCount ≥ maxPlayers`. |
| Capacity | Pure, shared by the form (live) and the API: `players = min(floor(total / (boosters × cardsPerBooster)), min over factions of floor(count_f / (boosters × perFaction)))` (the faction term only when `perFaction > 0`), capped at 256, with the limiting term named (`total` or a faction). A capacity below 2 refuses the config (`source.capacity`, the body carries `capacity`): "This cube cannot serve 2 players with these boosters". The form prefills `maxPlayers` with the capacity and follows it while the typed value is empty or above it; the organizer can only lower it. |
| Editing the cap | A cube's `maxPlayers` sizes the deal: **locked with the config** (409 `tournament_locked` once a pool exists; the form disables it with the rest). On the other sources it is editable in every status but detached, with or without pools, but never below the current pool count (`fields.maxPlayers = 'below_pool_count'`); raising it or clearing it is always allowed. |
| Full | Creating the `(max_players + 1)`-th pool is refused with **409 `tournament_full`** (`{ error: 'tournament_full', maxPlayers }`) on `/api/tournaments/:id/pool`, and the same 409 on `/api/tournament-bga-decklist` and `/api/tournament-pool-counts` (so BGA gets a 409 for that player; altered-bga-api relays it and the game cannot fetch a deck list: a player beyond the cap cannot play, which is the right outcome and the reason for the "set the same limit on BGA" hint). An **existing** pool is always returned. The count is every pool of the tournament, adopted legacy pools included; **adoption itself is never refused by the cap** (a pool already in play is kept, spec §2 "Declared after BGA started"), so a tournament declared after BGA started may show more pools than its cap, and an adopted pool of a cube tournament (only reachable through the race window of §6 step 2) holds its legacy contents and no slot: the deal always produces `max_players` lots, of which at most `max_players − adopted` get claimed. The check runs under the same row lock as the insert (§15.3), so two players racing for the last place never both get one. The checklist's step 2 reads "This tournament is full (M players)" with no button; the hub and the page show the Full pill. |
| The deal | At the first pool of a cube tournament, inside the transaction that inserts it: the cube's card objects are loaded before the lock (sets + uniques), the tournament row is locked `FOR UPDATE` (config still equal, not detached), `dealCubeSlots` (§15.3) cuts the cube into `max_players` lots of `boosters` boosters with a seeded rng, the lots are inserted into `tournament_cube_slots (tournament_ref, slot, boosters jsonb)`, and the pool takes slot 0. Every later pool, under the same lock, takes the lowest slot no pool holds (`sealed_pools.cube_slot`, unique per tournament). A detach deletes the slots with the pools; a delete (zero pools, so no deal yet) cascades. Nothing is regenerated: `buildPool` throws on a cube source (no per-player generation exists). |
| Resolving a ref, its stored form (builder check, 2026-11-06) | **One algorithm, `resolveRefs`, shared by the form and the server** (`src/lib/cubeSource.js`, isomorphic: `fetchSet` / `fetchUniques` are). For a ref as given: `canon = canonicalCardRef(ref)` (an alt-art, promo or promo-set-code ref rewritten to the `B` printing of its base set); when `canon` is in that set's data the card is **stored as `canon`** (the same gameplay card); otherwise, when the given ref is a unique or a non-`B` printing (`needsCardApi`), it is fetched **by reference** through the cards API, as the Lobby does for its built-in cubes, and **stored as given** (so the promo-only "Sofia, First Outpost", `ALT_BISE_P_BR_64_C`, which has no `B` twin, is an eligible cube card: "All commons" counts **192** in a tournament as in the Lobby); otherwise it is **unresolved**, listed under the ref as given and left out. `fetchUnique` never fails (after 3 tries it returns a bundled snapshot or a synthetic card): the synthetic fallback now carries `synthetic: true` and counts as unresolved, so a mistyped serial is refused instead of dealt as a faction-less card. Every card map that reads a pool (`buildCardMap` server-side, the pool page client-side) resolves the `needsCardApi` refs by reference too, not only the uniques. |
| Verifying the cube server-side | On POST and on a PATCH that sends a cube config, the server runs `resolveRefs` over `cards` and `heroPool`, refuses a ref it cannot resolve (400 `config: ['source.cards.unresolved']` or `['source.heroPool.unresolved']`, the body carries `unresolved: [refs]`), a `heroPool` ref that is not a hero, a `cards` ref that is a hero (`source.heroPool` / `source.cards`), then **stores the source re-keyed by stored forms** (quantities merged; a no-op for what the form sends, since the form resolves first), computes the capacity and checks `maxPlayers`. The same resolver feeds the deal, so a cube that was accepted always deals; should the cards API be down at deal time, the first pool fails with 409 `pool_unavailable` (try again later), never a degraded deal. The form resolves on the client first (unresolved refs are shown and left out before anything is sent). The JSON body limit of `server/index.js` is raised to 1 MB (a maximal cube config is about 45 KB, the Express default is 100 KB). |
| Cube tab (Cards section) | A third tab **"Cube"** next to "Sets" and "Mono-faction mix", holding `CubePicker`: the three ways of the Lobby in the same order, **community cubes** (one card per cube with name, author, card count, description, a **Preview** button opening `CubePreviewModal`), **"Load from your Re:Union decks"** (load, name search, format chips, tick one or several decks, merged into one cube), **"Paste your own cube"** (name, textarea, Parse). Once a cube is chosen the three panels give way to one **"Chosen cube"** card: an editable name, the origin, "N cards (D distinct) · H heroes found in the list", one count per faction (icon + number), the unresolved refs (left out, never silently dropped), **Preview** and **Change cube** (back to the three panels; the pasted text is kept). Locked: the chosen-cube card only, Preview still works. `CubePicker` is a dedicated component built for the form; the Lobby keeps its inline code unless swapping it in is a drop-in (last, optional task of the plan). |
| Settings section for a cube | Replaces `SettingsFields` + `TournamentUniqueFields` entirely (`TournamentCubeSettings`). **Boosters**: "Boosters per player" stepper 3–8, "Cards per booster" stepper 10–16 with the hint "Not counting the hero", "Faction guarantee" as three option cards (none / one of each faction / two of each faction, the third disabled under 12 cards), a live line "84 cards per player (7 × 12), plus a hero in each booster" and the rarity note. **Heroes**: the two option cards of today's sealed settings (in boosters / free choice, cube wording), then `HeroPicker`: a closed summary "N heroes selected" and a **Choose heroes** button that opens an inline panel (search, per-faction groups with counts and All / None, chips with the faction icon, the name and the set abbreviation), the cube's heroes preselected. **Players**: `MaxPlayersField` ("Maximum players", a number input, the capacity line "This cube allows up to N players with these boosters. Limiting: Yzmir, 56 cards." or the too-small message, and the BGA hint). The same `MaxPlayersField` closes the Settings section of the other sources, optional there ("No limit" when empty). |
| Summary line | `7 boosters of 12 · cube “All commons” (192 cards) · 1 of each faction per booster` (`summaryCube`, then `summaryPerFaction1` / `summaryPerFaction2`, then `summaryHeroesFree` when free). The player cap is not part of the config: the cards and the page print `3 / 8 players` after the pool count, with the Full pill. |
| Cube page | `/tournament/t/:id/cube` (`TournamentCubePage.jsx`), public like the tournament page, linked from the tournament header ("View the cube (192 cards) →") and from the pool page's title bar. Header: tournament name, cube name, origin, the summary line, the players line; a **Heroes** section (chips, mode text); then `CubeContents`, the body of today's `CubePreviewModal` extracted (sidebar counts by faction / rarity / set, search, group by faction / set / rarity, list or grid, hover preview), over the cube's cards. `CubePreviewModal` becomes a thin modal around `CubeContents`. A non-cube tournament redirects to its page. |
| Pool page and reveal | `poolResponse.sourceType = 'cube'` and a new `cube: { name, cardCount }` block. `PackReveal`: no set photo for a cube; instead a **generated booster cover**, drawn in a canvas from the bundled Altered logo (`public/images/altered-logo.png`, 512 × 512 with alpha, added by this PR) on a deep blue ground with the tournament name and "Cube · <cube name>" in the display face, exported as a PNG data URL (`cubeBoosterCover`, memoized per name pair) and handed to the existing `zoomCover.image`. Literal colours are allowed there (content, like the QR code). The heading's sublabel is the cube name; the bonus pack never appears (no unique outside the boosters). The pool's card map follows the refs' sets (COREKS included, `SETS` knows it) and resolves the `needsCardApi` refs (uniques and non-`B` printings) by reference. |
| Hub and page | "N pools prepared" becomes "N / M players" when `maxPlayers` is set (hub cards, "My created tournaments", the tournament header), plus `FullBadge` (a pill like `PrivateBadge`, `data-testid="tournament-full"`) once full. The organizer panel is unchanged. |
| Determinism | The deal rng is `mulberry32(hashSeed(`${tournament.id}|cube|${nonce}`))` with a fresh nonce (not stored: the lots are). `dealCubeSlots` takes the rng, so a golden (its own file, `src/lib/cubeDeal.golden.test.js`) pins the deal of a fake cube; the six existing golden digests of `poolBuilder.golden.test.js` must not move (the cube path touches none of the shared draw code). Rng order is a contract (§15.3). |
| Size | A 360-card cube is about 10 KB of jsonb and 2 KB gzipped on the wire; the config travels whole in the lists (no stripping in V5; Σ ≤ 1500 bounds it). The lots: `max_players × boosters × (cardsPerBooster + 1)` refs, under 20 KB for 8 players. |
| Recette | A new page `docs/tournaments/acceptance-cube-sealed.html` ("Cube sealed and the player cap — V5", ids `cu-<group>-<slug>`, BGA ids 123510–123519, preprod 999510–999511), fifth entry of `scripts/e2e-acceptance-coverage.mjs`'s `ACCEPTANCE_PAGES`. Playwright `tests/e2e/specs/cube-sealed.spec.js` on the e2e card fixtures extended with the sets of the "All commons" community cube, trimmed to its refs. |
| Branch | `feat/cube-sealed` from `main` (#25–#28, #30 merged), draft PR until group M of the recette runs on preprod; updated with merge commits, never rebased. |

### 15.3 Dealing (`dealCubeSlots`, `insertCappedPool`)

**Pure** (`src/lib/packGenerator.js`):

```
dealCubeSlots({ cards, heroPool, slots, boosters, cardsPerBooster, perFaction, heroesInBoosters }, rng)
  → string[][][]   // slots × boosters × refs
```

`cards` is the cube expanded to one entry per copy, `[{ ref, faction }]` (`expandCube(cards)` in
`src/lib/cubeSealed.js` turns `{ ref: qty }` plus a card map into that list). Rng order, pinned
by the golden:

1. For each faction in `FACTIONS` order: `stack[f] = shuffle(copies of faction f, rng)`.
2. `rest = shuffle(every copy not taken by step 3, rng)`: the stacks are cut first (step 3 is a
   count, not a draw), then everything left over, every faction mixed, is shuffled once.
3. `totalBoosters = slots × boosters`. Booster `b` (`b = s × boosters + i`): for each faction in
   `FACTIONS` order, `perFaction` refs from `stack[f]` (positions `b × perFaction …`), then
   `cardsPerBooster − 6 × perFaction` refs from `rest`, in stack order. Throws
   `cube too small: <faction|total> <have>/<needed>` when a stack is short (the capacity check
   makes it unreachable).
4. `heroesInBoosters`: for each slot in order, `bag = shuffle(heroPool, rng)`; booster `i` of the
   slot gets `bag[i mod bag.length]` **prepended** (slot 0). `dealHeroSlots` gains an optional
   `rng` parameter for that (the Lobby keeps calling it without one).

The refs of a booster stay in draw order (the guaranteed cards first, faction by faction, then the
random ones).

**Capacity** (`src/lib/cubeSealed.js`, pure, used by the form and the API):

```
cubeCapacity({ cards: [{ ref, qty, faction }], boosters, cardsPerBooster, perFaction })
  → { players, total, byFaction: { AX, BR, LY, MU, OR, YZ }, limit: { by: 'total' | <faction>, have, needed } }
```

`needed` is per player (`boosters × cardsPerBooster` for `total`, `boosters × perFaction` for a
faction). A copy whose faction is unknown counts in `total` only. `players` is capped at 256.

**Server** (`src/lib/poolStore.js`): `getOrCreateTournamentPool` keeps its three steps (existing
pool, adoption, insert); the insert goes to **`insertCappedPool`** whenever the tournament has a
`max_players` (every cube tournament has one), to `insertPool` otherwise (unchanged, `FOR SHARE`).

```
insertCappedPool(sub, { config, tournament, createdBy }):
  cube      = source.type === 'cube' ? await resolveCubeSource(config)      // before the lock
  built     = source.type !== 'cube' ? await buildPool(sub, { config, nonce }) : null
  withTransaction(q):
    row = SELECT * FROM tournaments WHERE id = $1 AND bga_tournament_id = $2 AND config = $3::jsonb
          AND detached_at IS NULL FOR UPDATE                     → none: return null (caller re-reads, retries)
    n   = count(*) FROM sealed_pools WHERE tournament_ref = $1   → n >= row.max_players: throw tournament_full
    if cube:
      if no row in tournament_cube_slots for $1:
        lots = dealCubeSlots({ …, slots: row.max_players, … }, mulberry32(hashSeed(`${row.id}|cube|${nonce}`)))
        INSERT INTO tournament_cube_slots (tournament_ref, slot, boosters) one row per lot
      free = SELECT slot, boosters FROM tournament_cube_slots s WHERE s.tournament_ref = $1
             AND NOT EXISTS (SELECT 1 FROM sealed_pools p WHERE p.tournament_ref = $1 AND p.cube_slot = s.slot)
             ORDER BY slot LIMIT 1                                → none: throw tournament_full
      cards = counts of free.boosters (+ heroPool × 1 each when heroes === 'free'); boosters = free.boosters
    INSERT INTO sealed_pools (…, cube_slot) … ON CONFLICT (sub, tournament_ref) … DO NOTHING RETURNING *   (through q)
```

A synthetic unique in `resolved` (the cards API unreachable) throws `cube_unresolved` before the
lock; the pool handlers answer 409 `pool_unavailable` for it. `updateTournament` (`requireUnlocked`) and `detachTournament` lock the same row `FOR UPDATE` first,
so a config edit, a detach and the pool creations of one tournament serialize without deadlock;
`insertPool`'s `FOR SHARE` stays compatible with all of them. `detachTournament` also deletes the
tournament's `tournament_cube_slots`. `resolveRefs(refs, { fetchSet, fetchUniques, lang })`
(`src/lib/cubeSource.js`, isomorphic, fetchers injectable for tests) maps each ref as given to its
stored form and card, or to `unresolved` (§15.2 "Resolving a ref"); `resolveCubeSource(source,
deps)` runs it over a stored cube and returns `{ cards: [{ ref, qty, faction, cardType }], heroes:
[{ ref, faction }], unresolved: [refs], stored: { cards, heroPool } }` (`stored` = the source
re-keyed by stored forms). The form's `resolveCubeCards` (raw refs with duplicates, heroes split
out) is built on the same `resolveRefs`.

### 15.4 Config, rules, API

- `validateTournamentConfig` (pure): the `cube` branch of §15.2; `configSetCodes` returns the
  distinct sets of `cards` and `heroPool` in `SETS` order; `legacyColumnsFromConfig` gives
  `set_code: null, unique_count: 0, even_factions: false, heroes_in_pool: heroes === 'packs',
  guaranteed_uniques: 0`. `SOURCE_TYPES` gains `'cube'`; `CUBE_LIMITS` (`src/lib/cubeSealed.js`) holds
  the ranges: boosters 3–8, cards per booster 10–16, per faction 0–2, 1500 cards, 60 cards per
  player, 256 players.
- `validateTournamentFields`: `maxPlayers`, optional on create (absent, `null` or `''` → `null`),
  validated on a PATCH only when the key is sent; integer 2–256 else `invalid_max_players`.
- Cross-field, in the handlers and in `tournamentFormIssues` (which receives `capacity` and
  `poolCount`): cube without `maxPlayers` → `fields.maxPlayers = 'required_for_cube'`; above
  the capacity → `'above_capacity'`; capacity < 2 → `config: ['source.capacity']`; on a PATCH of a
  non-cube tournament a `maxPlayers` under the pool count → `'below_pool_count'`.

| Endpoint | Change |
| --- | --- |
| `GET /api/tournaments`, `GET /api/tournaments/:id` | Every item carries `maxPlayers` (`null` or the cap). |
| `POST /api/tournaments` | Accepts `maxPlayers` and the `cube` source. Cube: 400 `config: ['source.cards.unresolved' \| 'source.heroPool.unresolved']` + `unresolved: [refs]`, 400 `config: ['source.capacity']` + `capacity`, 400 `fields.maxPlayers = 'required_for_cube' \| 'above_capacity'` (+ `capacity`). The imposed legacy format (§6) replaces a cube config like any other; `maxPlayers` is then just optional. |
| `PATCH /api/tournaments/:id` | `maxPlayers`: locked with the config when the effective source (sent or stored) is a cube (409 `tournament_locked`); otherwise editable in every status but detached, 400 `'below_pool_count'` under the pool count. A config sent as a cube goes through the same cube checks as POST, against `maxPlayers` sent or stored (`'required_for_cube'` when neither). |
| `GET /api/tournaments/:id/pool` | New 409 `{ error: 'tournament_full', maxPlayers }` when no pool exists for the caller and the cap is reached. An existing pool is always returned. |
| `/api/tournament-bga-decklist`, `/api/tournament-pool-counts` | The same 409 `{ error: 'tournament_full' }` (next to the existing `tournament_unavailable` / `pool_unavailable`). |
| `poolResponse` (every `/api/tournament-pool*`) | `sourceType: 'cube'` and `cube: { name, cardCount }` for a cube pool; additive. |
| `/api/tournament-bound-pools` | Unchanged. |

### 15.5 Form, pages

**Form state.** `sourceType` ∈ `set` \| `faction` \| `cube`; `cube` (null, or `CubePicker`'s
value: `{ name, origin, cubeId, cards: [{ ref, qty, faction, cardType }], heroesFound: [{ ref,
faction, name }], unresolved: [refs], resolved: true }`); `cubeSettings` `{ boosters: 7,
cardsPerBooster: 12, perFaction: 1 }`; `heroPool: string[]` (reset to the cube's heroes whenever
a cube is chosen); `maxPlayers` (`''` or a number, every source). The config sent for a cube is
`{ type: 'cube', name, origin, cubeId, cards: { ref: qty }, heroPool, ...cubeSettings }` with
`heroes`, zeroed `uniques` and `excludeBanlist: false`; the body carries `maxPlayers` (`null`
when empty) on create and on every PATCH that may send it (unlocked, or a non-cube source).
Capacity is computed live from `cube.cards` and `cubeSettings` once the cube is resolved; the
`maxPlayers` prefill rule of §15.2 applies only then. Edit prefill of a cube tournament rebuilds
`cube` from the stored refs and, while unlocked, re-resolves them to get the factions back
(`resolveCubeCards`); locked, the card is read-only and no capacity is needed. The
`sessionStorage` draft and the imposed legacy format cover the new state like the rest.
`tournamentFormIssues` maps the new codes to the fields `cube` (`source.cards`, `source.capacity`),
`cubeSettings` (`source.poolSize`, `source.perFaction`), `heroPool` (`source.heroPool`) and
`maxPlayers` (`fields.maxPlayers`), placed after `uniques` in `FIELD_ORDER`.

**Cards section.** `TournamentCardsSource` adds the `cube` tab (`t('tournaments.sourceCube')`) with
the hint "Every card of the cube is dealt at most once across all players. Pick a community cube,
load your Re:Union decks, or paste a list." and `<CubePicker value onChange disabled lang />`.
Test ids: `cube-community-<id>` (the select button), `cube-preview-<id>`, `cube-reunion-load`,
`cube-reunion-deck-<id>`, `cube-reunion-import`, `cube-paste-name`, `cube-paste-text`,
`cube-paste-parse`, the chosen card `cube-chosen` with `cube-name`, `cube-count`,
`cube-faction-<F>`, `cube-unresolved`, `cube-preview`, `cube-change`.

**Settings section.** `TournamentCubeSettings` (test ids `cube-boosters`, `cube-cards-per-booster`,
the `Stepper` ones, `cube-per-faction-0|1|2`, `cube-pool-line`, `hero-mode-packs`, `hero-mode-free`,
`hero-pool-count`, `hero-pool-open`, `hero-pool-search`, `hero-faction-all-<F>`,
`hero-faction-none-<F>`, `hero-chip-<REF>`, `hero-pool-close`) and `MaxPlayersField`
(`max-players`, `max-players-capacity`, `max-players-limit`). The other sources keep their
Settings and gain `MaxPlayersField` at the end.

**Pages.** `TournamentDetail`: the players line and `FullBadge` in the header, the cube link
(`cube-link`) under the summary; `TournamentChecklist`: step 2 "full" state (`step2Full`, also on
a 409 `tournament_full` from "Open my pool"); `TournamentMenu`: players line + `FullBadge` on the
cards; `TournamentCubePage` (route `/tournament/t/:id/cube`, `cube-page`, `cube-page-heroes`);
`TournamentPoolView`: the generated cover (`cubeBoosterCover({ title, subtitle, logoUrl })` in
`src/lib/cubeCover.js`, a `Promise<string | null>`, null when the canvas or the logo fails so the
reveal goes straight to the cards) passed to `PackReveal`'s new `coverImage` prop (`undefined` =
today's behaviour, `null` = no cover, a string = that image) and a "Cube" link in the title bar.

**i18n** (`tournaments.*` and `packReveal.*`, EN + FR): the keys are listed in the plan (Task 3) so
every UI task reads them from one place.

### 15.6 Tests and recette

- Unit: `tournamentConfig` (the cube branch, every code, the forced uniques and ban list,
  `configSetCodes`, `legacyColumnsFromConfig`), `tournamentRules` (`maxPlayers`), `cubeSealed`
  (`cubeCapacity`: total-bound, faction-bound, unknown faction, the 256 cap, below 2; `expandCube`),
  `packGenerator` (`dealCubeSlots`: sizes, every copy at most once, the faction guarantee, heroes
  distinct per lot and independent between lots, throws when short, determinism; `dealHeroSlots`
  with an rng), `cubeDeal.golden` (one digest), `poolBuilder` (throws on a cube source, the six
  digests unchanged), `cubeSource` (resolver with injected fetchers: unresolved, a hero in `cards`,
  a non-hero in `heroPool`), `tournamentForm` (the new issues and their order), `TournamentBits`
  (the cube summary, `FullBadge`), `cubeCover` (the pure text wrapping).
- Integration (new files next to `tournaments.test.js`, same mocks): the schema (`max_players`,
  `tournament_cube_slots`, `cube_slot`); POST / PATCH `maxPlayers` on a set tournament (invalid,
  below pool count, raised, cleared) and the cube checks (unresolved, hero in cards, capacity,
  required, above capacity, the forced uniques); the deal (first pool deals `max_players` lots,
  every copy once across the lots, pools claim slots 0, 1, 2 in order, `cards` = booster counts
  plus free heroes); concurrency (`Promise.all` of three creators on a cap of 2 → two pools, one
  `tournament_full`); BGA path on a cube tournament (a "Random …" deck from the pool) and its 409
  when full; detach deletes the slots; a cube `maxPlayers` PATCH is 409 locked once a pool exists.
- E2E (`cube-sealed.spec.js`; fixtures: the "All commons" cube's sets CORE, BISE, DUSTER, ALIZE
  trimmed to its refs, every printing of those refs kept (so BISE's holds `ALT_BISE_P_BR_64_C`),
  next to the three full ones; the fake cards API answers `?reference=` for a non-unique ref from
  the fixture files, in the alteredcore shape it already uses for uniques; `harness.spec.js`'s
  "another set answers 404" check moves to a set that has no fixture; card data is read in EN by
  the form's resolver, as the pool page and the preview already do, since only `_EN.json`
  fixtures exist): the Cube tab (community select + preview, the
  Re:Union import from a deck seeded through the fakes, paste with an unresolved ref, the chosen
  card, change, tab switch keeps the state), the Settings (steppers, the faction guarantee, the
  pool line, the hero picker, the capacity line and the prefilled cap, the issues), create
  ("Commons cube", 123510: All commons, 6 × 10, one of each faction, heroes in boosters, cap 3;
  stored config, summary, "0 / 3 players"), the cube page, three pools (alice, bob, carol: 6
  boosters of 11, slot 0 a hero of the pool, one card of each faction in slots 1–6, no ref dealt
  twice across the three pools, every ref in the cube with its qty, the generated cover in the
  reveal), full ("Full cup" 123511, cap 2: carol's page says full, her BGA call is 409), the cap
  on a set tournament ("Capped set cup" 123512: the third player blocked, raise, lower below the
  pools refused), the API guards, the lock on edit, FR, 375 px.
- Recette groups: 0 setup (branch, `make dev` with the schema check, suites, coverage with five
  pages, clean ids), A the Cube tab, B the cube Settings, C create, D the cube page, E the pools
  and the reveal, F full and the BGA 409, G the cap on a set tournament, H API guards, I edit
  (unlocked: change the cube; locked), J BGA path, K FR / theme / mobile / console, L the Lobby's
  cubes tab unchanged (only when the optional task ran), M before production (preprod
  999510–999511: a cube tournament end to end, a full one).

### 15.7 Non-goals and what was weighed

- **Dealing on demand** (each pool drawn from what is left) was weighed and dropped: the faction
  guarantee of a late player depends on what the random slots of the earlier players consumed, so
  it needs a reservation computed against the cap anyway; one deal up front gives the same
  distribution per player, lets the form state the capacity exactly, and keeps one invariant
  (every copy once) trivially true.
- **Raising a cube's cap after the deal** (a second deal from the leftovers), several copies of
  the cube ("2 × the cube"), reopening a place when a player leaves, a cap for the Lobby, a
  BGA-side enforcement of the cap: later, if asked.
- **The Lobby's cube sealed** keeps dealing every player from the full pool.
- **A standalone Altered logo on the CDN**: none exists (checked 2026-11-06); the PNG from
  altered.re is bundled instead.

### 15.8 Left to the builder

- The exact Tailwind layout of the Cube tab's panels, the chosen-cube card, the hero picker and
  the cube page (semantic tokens only; the generated cover is the one place with literal colours).
- Whether `resolveCubeRefs` (the Lobby's) delegates to the new `resolveRefs` or stays as is (it
  would then resolve a pasted promo-only ref too; a behaviour change for the Lobby, so only with
  the optional last task).
- The cover's exact composition (sizes, wrapping) as long as it reads the tournament name and the
  cube name and uses the bundled logo; `cubeBoosterCover` must never throw (a failure returns
  `null`).
- Whether the Lobby adopts `CubePicker` (last task, optional: only if it is a drop-in with no
  visible change; otherwise the Lobby is left alone).

### 15.9 As built (2026-11-06)

What differs from §15.2–§15.8 once built; the rest stands.

- **Name.** The community cube is "All Commons" (`src/lib/cubes.js`), not "All commons" (a tournament seeded through the API's `cubeTournamentBody` keeps the lowercase name it was given).
- **Editing an unlocked cube.** The form re-resolves the stored refs **keeping the stored quantities** (not one copy per ref) and keeps unresolved refs in the config, shown in the unresolved callout; the server refuses them with `source.cards.unresolved` when they are truly unknown.
- **Cap of a cube.** A PATCH `maxPlayers: null` on a cube tournament is refused `required_for_cube` (a cube always has a cap). The cap is locked with the config (409 `tournament_locked` once a pool exists); on the set / faction / multiset sources it stays editable down to the pool count (`below_pool_count`), and 1 is never valid (2–256). So "cap 1 → `below_pool_count`" is unreachable: the recette's `cu-g-lower` runs cap 2 with 2 pools, raise to 3, a third pool, then lowering to 2 is refused (`below_pool_count`, n = 3).
- **Reveal.** The pool reveal waits for the generated cover (cube pools) before opening; a failed cover (`null`) goes straight to the cards.
- **`dealCubeSlots`.** The total check runs before the per-faction checks; `rest` = each faction stack's leftovers in `FACTIONS` order, then the faction-less copies, shuffled once (§15.3 step 2 in practice).
- **`source.poolSize`** is reported only when `boosters` and `cardsPerBooster` are both valid.
- **Inserts.** `insertPool`'s `FOR SHARE` also requires `max_players IS NULL` (a cap added in flight re-routes the insert to `insertCappedPool`); `insertCappedPool` resolves the cube before the lock only while it is not dealt: once `tournament_cube_slots` has rows a late pool skips the resolution, so a cards-API outage no longer blocks late joiners (§15.2 "Verifying the cube" still holds for the first pool).
- **Quantities.** After the resolver re-keys the cube by stored forms, a merged quantity above 99 is refused with `source.cards`.
- **Recette.** `acceptance-cube-sealed.html` has 44 steps over BGA ids 123510–123517.
