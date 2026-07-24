-- Bootstrap for the self-hosted `supabase/realtime` sidecar (Docker deployments only —
-- see ROADMAP.md "Realtime"). Realtime's Docker image assumes it's paired with
-- Supabase's own custom postgres image, which pre-creates all of this; against a
-- VANILLA postgres image (what AlteredOps otherwise uses) none of it exists yet. None
-- of this is documented in one place by Supabase — every piece here was found by
-- running a local Postgres + supabase/realtime + a rewrite proxy in Docker and
-- iterating on the actual startup/subscribe errors until a real row UPDATE arrived
-- over a live @supabase/supabase-js subscription. Idempotent — safe to run on every
-- deploy. Requires wal_level = logical (server flag, set via the postgres service's
-- `command` in docker-compose.yml — not something a migration can set) and the
-- wal2json output plugin (see postgres/Dockerfile in the AlteredOps service dir).

-- 1. Control-plane schema: Realtime's own tenant/extension config tables. It creates
-- the TABLES itself via its internal Ecto migrations at boot, but expects this schema
-- to already exist.
create schema if not exists _realtime;

-- 2. Target schema: the tables/functions Realtime's postgres_changes (CDC via logical
-- replication) feature manages in the watched database — realtime.subscription,
-- realtime.list_changes(), etc. Realtime auto-migrates the CONTENTS the first time a
-- tenant connects (72 migrations as of v2.102.3), but — like _realtime above — does
-- not create the schema itself; without it the CDC connection fails immediately with
-- "schema \"realtime\" does not exist" and never gets far enough to self-migrate.
create schema if not exists realtime;

-- 3. Standard Supabase Postgres roles. Realtime's CDC migrations, and the grant check
-- its "subscription_check_filters" trigger runs on every subscribe, assume these
-- exist (Supabase's own postgres image pre-creates them). We only need the roles to
-- EXIST — nothing ever authenticates AS them since we don't run GoTrue/PostgREST; the
-- client anon key's JWT `role` claim just tells Realtime which of these roles to check
-- grants against, and our app's superuser DB connection can act on their behalf
-- without them having LOGIN.
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- 4. Logical-replication publication Realtime watches for postgres_changes.
do $$
begin
  if not exists (select from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime for table draft_rooms;
  elsif not exists (
    select from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'draft_rooms'
  ) then
    alter publication supabase_realtime add table draft_rooms;
  end if;
end
$$;

-- 5. The CDC filter-check trigger validates a subscribe's filter column (e.g.
-- `id=eq.TEST01`) against what the claimed role can actually see — without this grant
-- every subscribe fails with "invalid column for filter id", indistinguishable from a
-- typo in the filter itself.
grant select on draft_rooms to anon, authenticated, service_role;
