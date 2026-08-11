-- SUPERSEDED — kept for history only, not applied anywhere (see draft-rooms-schema.sql).
-- This predates api/rooms/*.js: the browser used to write to this table directly via
-- supabase-js, hence the anon insert/update RLS policies below. CRUD now goes through
-- our own API (src/lib/db.js's `pg` pool, using DATABASE_URL — a role with full table
-- access, bypassing RLS), so those write policies are no longer needed. Use
-- draft-rooms-schema.sql for the current, actually-applied schema.
--
-- Run this in the Supabase SQL editor

create table if not exists draft_rooms (
  id text primary key,
  state jsonb not null,
  created_at timestamptz default now()
);

-- Enable row-level security (recommended for production)
alter table draft_rooms enable row level security;

-- Allow all anonymous reads and writes (sufficient for a room-code-gated app)
create policy "Allow all anon reads" on draft_rooms for select using (true);
create policy "Allow all anon inserts" on draft_rooms for insert with check (true);
create policy "Allow all anon updates" on draft_rooms for update using (true);

-- Enable Realtime
alter publication supabase_realtime add table draft_rooms;
