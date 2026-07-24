-- Postgres schema for the core draft/sealed room state (previously Supabase-only).
-- Self-hosted deployments (AlteredOps/Docker) run this against their own Postgres,
-- with realtime change notifications served by a self-hosted `supabase/realtime`
-- instance (see ROADMAP.md "Realtime" for why, and server/realtime-tenant.js for the
-- one-time tenant registration). Vercel deployments may instead point DATABASE_URL at
-- a Supabase project's own Postgres connection string and use Supabase's hosted
-- Realtime — either way, the CRUD access pattern (api/rooms-*.js) is identical.
--
-- Requires the pgcrypto extension (for gen_random_uuid(), used elsewhere) and logical
-- replication enabled (wal_level = logical) for Realtime to see row changes -- run once
-- per database:
--   create extension if not exists pgcrypto;
-- wal_level is a server-level setting (postgresql.conf / the `command` args on the
-- postgres container), not something a migration can set.

create table if not exists draft_rooms (
  id text primary key,
  state jsonb not null,
  created_at timestamptz not null default now()
);
