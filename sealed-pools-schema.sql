-- Requires the pgcrypto extension (for gen_random_uuid()) -- run once per database:
--   create extension if not exists pgcrypto;
--
-- Postgres schema for the Set 6 preview tournament feature (see ROADMAP.md "Set 6 preview").
-- Hosted by Re:Union (not Supabase — this DB is accessed directly via DATABASE_URL from
-- server-side code only, never from the browser, so no RLS/anon policies are needed here).
--
-- Card pools are never stored: a pool's contents are always the deterministic output of
-- generateTournamentSealedPool() fed by the columns below (set_code, unique_count,
-- even_factions, heroes_in_pool, nonce, and tournament_seed once bound) — see
-- src/lib/poolStore.js's getPoolSeedInputs(). Only enough state to reproduce and to
-- lazily bind a pool is kept here.

-- Append-only: the currently active competitive format is simply the most recent row.
-- Changing format = INSERT a new row, never UPDATE — old pools keep referencing whatever
-- config was active when THEY were created (snapshotted onto sealed_pools, not looked up
-- live), so a format change never retroactively affects an already-created pool.
create table if not exists current_format (
  id bigint generated always as identity primary key,
  type text not null check (type in ('sealed', 'draft')),
  set_code text not null,
  unique_count int not null default 0,
  even_factions boolean not null default false,
  heroes_in_pool boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists sealed_pools (
  id uuid primary key default gen_random_uuid(),
  sub text not null,
  kind text not null check (kind in ('normal', 'tournament')),

  -- Snapshotted from current_format at creation time (see comment above) — these, plus
  -- nonce (and tournament_seed once bound), are the only inputs the pool-composition
  -- engine needs; the actual card list is never persisted.
  set_code text not null,
  unique_count int not null default 0,
  even_factions boolean not null default false,
  heroes_in_pool boolean not null default true,
  nonce text not null,

  -- 'tournament' rows start with tournament_seed = null (pending / in preparation) and
  -- get it set exactly once, on first bind — never updated again after that.
  tournament_seed text,
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

-- At most one 'normal' pool per player at a time (reset updates it in place, it's never
-- replaced by a new row).
create unique index if not exists sealed_pools_one_normal_per_sub
  on sealed_pools (sub) where kind = 'normal';

-- At most one PENDING (not yet bound) 'tournament' pool per player at a time — this is
-- the actual one-shot-commitment lock: a new preparation pool can't be inserted while one
-- is still pending, and becomes insertable again the moment the pending one is bound
-- (tournament_seed set), since it then falls outside this partial index.
create unique index if not exists sealed_pools_one_pending_tournament_per_sub
  on sealed_pools (sub) where kind = 'tournament' and tournament_seed is null;

-- Every bound tournament pool for a player, most recent first — used by "modifier mes
-- decks sur les tournois en cours" (button 3) and by binding lookups.
create index if not exists sealed_pools_bound_tournaments
  on sealed_pools (sub, bound_at desc) where kind = 'tournament' and tournament_seed is not null;

-- Binding lookup: is THIS PLAYER already bound to a given tournament_seed? Note this is
-- (sub, tournament_seed), NOT tournament_seed alone -- the same tournament_seed is
-- shared by every player in that tournament (that's the whole point: hash(sub +
-- tournament_seed + ...) gives each player a different pool while all sharing one
-- tournament identity), so many different players legitimately bind to the same seed.
create unique index if not exists sealed_pools_one_binding_per_sub_per_seed
  on sealed_pools (sub, tournament_seed) where tournament_seed is not null;

-- Seeds the initial active competitive format (set 6 / EOLE sealed, 3 uniques capped at
-- 1 per faction, no heroes drafted — every EOLE hero gets appended to the pool instead,
-- see api/_lib/tournamentPool.js) so the tournament endpoints have something to serve out
-- of the box. Guarded by "table is completely empty" rather than ON CONFLICT: current_format
-- is append-only by design (see its table comment above) — a later, deliberate format change
-- is a new INSERT the app never expects this migration to touch, so this only ever fires
-- once, on a fresh table, and is a no-op on every subsequent (idempotent) migrations run.
insert into current_format (type, set_code, unique_count, even_factions, heroes_in_pool)
select 'sealed', 'EOLE', 3, true, false
where not exists (select 1 from current_format);
