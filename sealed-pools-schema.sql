-- Requires the pgcrypto extension (for gen_random_uuid()) -- run once per database:
--   create extension if not exists pgcrypto;
--
-- Postgres schema for the Set 6 preview tournament feature (see ROADMAP.md "Set 6 preview").
-- Hosted by Re:Union (not Supabase — this DB is accessed directly via DATABASE_URL from
-- server-side code only, never from the browser, so no RLS/anon policies are needed here).
--
-- Card pools are generated once (src/lib/poolBuilder.js, a deterministic function of the
-- snapshot columns below — set_code, unique_count, even_factions, heroes_in_pool,
-- guaranteed_uniques — and the nonce) and STORED on the row (cards + boosters, added by the
-- user-created tournaments migration at the end of this file). Rows created before that
-- change have no cards and are regenerated from those columns until
-- scripts/freeze-sealed-pools.mjs stores them. tournament_id is deliberately NOT a seed
-- input: a pool's contents must stay identical before and after binding, so a player's
-- prepared pool doesn't change the moment a real tournament binds to it. tournament_id is
-- metadata (which BGA tournament this pool committed to); tournament_ref attaches a pool
-- to a tournament declared on altered-draft (docs/tournaments/README.md §14).
--
-- The whole file is idempotent: the AlteredOps migrations image applies it on EVERY deploy.

-- Append-only: the currently active competitive format is simply the most recent row.
-- Changing format = INSERT a new row, never UPDATE — old pools keep referencing whatever
-- config was active when THEY were created (snapshotted onto sealed_pools, not looked up
-- live), so a format change never retroactively affects an already-created pool.
create table if not exists current_format (
  id bigint generated always as identity primary key,
  type text not null check (type in ('sealed', 'draft')),
  set_code text not null,
  unique_count int not null default 0,        -- uniques INSIDE boosters (each replaces a rare slot)
  even_factions boolean not null default false,
  heroes_in_pool boolean not null default true,
  guaranteed_uniques int not null default 0,  -- extra uniques appended OUTSIDE the boosters (like heroes)
  created_at timestamptz not null default now()
);
-- Existing databases (created before guaranteed_uniques existed): add the column in place.
alter table current_format add column if not exists guaranteed_uniques int not null default 0;

create table if not exists sealed_pools (
  id uuid primary key default gen_random_uuid(),
  sub text not null,
  kind text not null check (kind in ('normal', 'tournament')),

  -- Snapshotted from current_format at creation time (see comment above) — these, plus
  -- nonce, are the only inputs the pool-composition engine needs (tournament_id is NOT
  -- one of them, see comment above); the actual card list is never persisted.
  set_code text not null,
  unique_count int not null default 0,
  even_factions boolean not null default false,
  heroes_in_pool boolean not null default true,
  guaranteed_uniques int not null default 0,
  nonce text not null,

  -- 'tournament' rows start with tournament_id = null (pending / in preparation) and get
  -- it set exactly once, on first bind — never updated again after that. tournament_name
  -- is purely informative (shown on "modifier mes decks sur les tournois en cours") and
  -- can be refreshed on every bind call, unlike tournament_id.
  tournament_id text,
  tournament_name text,
  bound_at timestamptz,

  -- 'normal' rows only: last time the reset button was used, for the 30-minute cooldown.
  reset_at timestamptz,

  -- Deck summary, kept in sync by the frontend's throttled decks-api sync (see
  -- ROADMAP.md) so altered-bga-api's decklist call can answer BGA locally, with no
  -- round-trip back to decks-api needed at request time.
  deck_id text,
  deck_name text,
  deck_hero_ref text,
  deck_faction text,
  deck_card_quantity int,

  created_at timestamptz not null default now()
);
-- Existing databases: add the column in place (snapshotted per pool at creation time).
alter table sealed_pools add column if not exists guaranteed_uniques int not null default 0;

-- Existing databases (created before this rename): tournament_seed -> tournament_id, since
-- what altered-bga-api actually has available from BGA is a tournament id, never the "seed"
-- the original design assumed (see ROADMAP.md "Set 6 preview"). Postgres has no `RENAME
-- COLUMN IF EXISTS`, so this is guarded explicitly; a no-op on fresh databases (created
-- directly with tournament_id above) and on databases already migrated.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'sealed_pools' and column_name = 'tournament_seed')
     and not exists (select 1 from information_schema.columns
                      where table_name = 'sealed_pools' and column_name = 'tournament_id')
  then
    alter table sealed_pools rename column tournament_seed to tournament_id;
  end if;
end $$;
-- Existing databases: add the column in place (informative only, see table comment above).
alter table sealed_pools add column if not exists tournament_name text;

-- At most one 'normal' pool per player at a time (reset updates it in place, it's never
-- replaced by a new row).
create unique index if not exists sealed_pools_one_normal_per_sub
  on sealed_pools (sub) where kind = 'normal';

-- At most one PENDING (not yet bound) 'tournament' pool per player at a time — this is
-- the actual one-shot-commitment lock: a new preparation pool can't be inserted while one
-- is still pending, and becomes insertable again the moment the pending one is bound
-- (tournament_id set), since it then falls outside this partial index.
--
-- Dropped and recreated unconditionally (rather than `if not exists` alone) because the
-- rename above changes which column the two indexes below are defined over -- on a
-- database migrating from tournament_seed, `if not exists` would otherwise silently keep
-- the old (now-dangling) column reference forever. Cheap and correct on every run either
-- way, migrated or fresh.
drop index if exists sealed_pools_one_pending_tournament_per_sub;
create unique index sealed_pools_one_pending_tournament_per_sub
  on sealed_pools (sub) where kind = 'tournament' and tournament_id is null;

-- Every bound tournament pool for a player, most recent first — used by "modifier mes
-- decks sur les tournois en cours" (button 3) and by binding lookups.
drop index if exists sealed_pools_bound_tournaments;
create index sealed_pools_bound_tournaments
  on sealed_pools (sub, bound_at desc) where kind = 'tournament' and tournament_id is not null;

-- Binding lookup: is THIS PLAYER already bound to a given tournament_id? Note this is
-- (sub, tournament_id), NOT tournament_id alone -- the same tournament_id is shared by
-- every player in that tournament, so many different players legitimately bind to the
-- same tournament_id (each still gets their own pool, via their own sub + nonce -- see
-- the "Card pools are never stored" comment above; tournament_id itself plays no part in
-- that). Renamed from sealed_pools_one_binding_per_sub_per_seed.
drop index if exists sealed_pools_one_binding_per_sub_per_seed;
create unique index if not exists sealed_pools_one_binding_per_sub_per_tournament
  on sealed_pools (sub, tournament_id) where tournament_id is not null;

-- Distinct BGA games played against a pool (any kind, normal or tournament) -- lets
-- altered-bga-api's `gameId` on the sealed decklist call feed a "games played with this
-- deck" counter without recording a play more than once for the same game (a BGA table
-- reloading the deck-list screen re-triggers the same call repeatedly). The composite
-- primary key is the dedup: see recordGamePlayed()/countGamesPlayed() in poolStore.js.
create table if not exists sealed_pool_games (
  pool_id uuid not null references sealed_pools(id) on delete cascade,
  game_id text not null,
  created_at timestamptz not null default now(),
  primary key (pool_id, game_id)
);

-- Seeds the initial active competitive format (set 6 / EOLE sealed): 1 unique INSIDE the
-- boosters (replacing a rare) + 1 guaranteed unique appended OUTSIDE them, factions left
-- random, no heroes drafted — every EOLE hero gets appended to the pool instead, see
-- api/_lib/tournamentPool.js) so the tournament endpoints have something to serve out of
-- the box. Guarded by "table is completely empty" rather than ON CONFLICT: current_format
-- is append-only by design (see its table comment above) — a later, deliberate format change
-- is a new INSERT the app never expects this migration to touch, so this only ever fires
-- once, on a fresh table, and is a no-op on every subsequent (idempotent) migrations run.
insert into current_format (type, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques)
select 'sealed', 'EOLE', 1, false, false, 1
where not exists (select 1 from current_format);

-- Activating this format on an ALREADY-SEEDED database (which still has the old
-- 3-uniques/even-factions row): the migration above is a no-op there, so switch formats
-- the append-only way — INSERT a fresh row (it becomes "most recent" = active). Run once,
-- deliberately, when rolling the new format out:
--   insert into current_format (type, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques)
--   values ('sealed', 'EOLE', 1, false, false, 1);

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
-- A moderator can DETACH a declaration (someone declared a BGA tournament they don't
-- organize): its pools are deleted and its BGA id is freed for a new declaration.
alter table tournaments add column if not exists detached_at timestamptz;
-- One live altered-draft tournament per BGA tournament, cancelled ones included (a cancelled
-- tournament's pools still answer BGA for that id; reuse = restore it). Detached ones don't
-- count: they no longer answer BGA at all.
drop index if exists tournaments_bga_tournament_id;
create unique index if not exists tournaments_bga_tournament_id_live
  on tournaments (bga_tournament_id) where detached_at is null;
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
-- Set when a legacy pool (bound to a BGA id before anyone declared that tournament) is
-- adopted by a declaration: a moderator's detach then releases it (back to legacy, adopted
-- again by the real organizer's declaration) instead of deleting it.
alter table sealed_pools add column if not exists adopted_at timestamptz;
update sealed_pools set created_by = 'legacy' where created_by is null;
create unique index if not exists sealed_pools_one_per_sub_per_tournament_ref
  on sealed_pools (sub, tournament_ref) where tournament_ref is not null;
-- Lookups by tournament alone (pool counts on the public list, detach, the FK on delete)
-- and by BGA id for unattached pools (adoption, the form's imposed-format lookup) would
-- otherwise scan the table.
create index if not exists sealed_pools_by_tournament_ref
  on sealed_pools (tournament_ref) where tournament_ref is not null;
create index if not exists sealed_pools_legacy_by_bga_id
  on sealed_pools (tournament_id) where tournament_ref is null and tournament_id is not null;

-- V2 (mono-faction sealed): a pool drawn from several sets has no single set; the legacy
-- snapshot column is null for those rows (their contents are always stored, never regenerated).
alter table sealed_pools alter column set_code drop not null;
