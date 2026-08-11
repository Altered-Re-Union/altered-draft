# Altered Draft Simulator

A browser-based multiplayer **draft + sealed** simulator for the [Altered TCG](https://altered.re). Players open the same URL from their own devices, draft or build pools together in real time, and export the result — copy a decklist for altered.re, or (optionally) save it straight to their **Re:Union** account.

**No accounts/database of its own.** It's a React SPA with a thin API layer in front of Postgres: shared room state lives in one `draft_rooms` table, written through a couple of small server-side handlers and streamed to clients over a Realtime (Supabase-protocol) subscription. Two supported deployment targets run the exact same handler code — Vercel serverless functions (paired with a Supabase project as the Postgres + Realtime provider), or a self-hosted Docker image (its own Postgres + a self-hosted `supabase/realtime` sidecar). Live at **[altered-draft.vercel.app](https://altered-draft.vercel.app)**.

> New here as a player? Just open the live site and hit **Help** in the top bar — this README is for people running or contributing to the code.

---

## Features

- **Real-time draft** — open packs, pick a card, packs pass around the table (left on rounds 1 & 3, right on 2 & 4), 4 rounds.
- **Sealed** — each player opens a set of boosters and builds from their own pool.
- **Pool sources:** single-set **Presets**; **Multi-Set** (per-set pack counts, same packs for everyone or a shuffled bag); **Cubes** (built-in community cubes, paste-your-own, or loaded/merged from your Re:Union decks); custom card-pool paste.
- **Cube of the Month** spotlight, cube preview, and an in-app **hero draft** for hero-draft cubes.
- **Heroes** — one control: hero cards in the packs, or **free choice** of any hero from the full roster at deckbuild.
- **Deckbuilder + live stats** — faction split, set/type/rarity breakdown, mana curves, biome power totals; validity check (≥30 cards, ≤3 factions, ≤1 hero).
- **Export / Save** — copy a decklist in altered.re format, or save your pool + final deck to your **Re:Union** account (optional, opt-in).
- **Light / dark theme** mirroring [alteredcore.org](https://alteredcore.org); optional pick timer; per-room identity & decks persisted in `localStorage` for rejoin.

---

## Architecture

**React (Vite) + Tailwind**, with a thin API layer over Postgres — no accounts, no user table, no auth of its own (Re:Union owns identity, see below). Both deployment targets run the exact same handler modules:

- **Vercel** — each `api/*.js` file is a serverless function.
- **Self-hosted Docker** — `server/index.js`, a small Express server that serves the built frontend AND routes `/api/*` to those SAME handler files (no handler code changes needed to move serverless → container). This is how Re:Union can host the app on their own infra (AlteredOps) without forking the logic.

**Shared state.** A multiplayer room is one row in a single Postgres table (`draft-rooms-schema.sql`):

```
draft_rooms ( id text pk, state jsonb, created_at timestamptz )
```

The entire game (config, players, packs, picks, phase…) is the `state` JSON. The browser never talks to Postgres directly — `api/rooms/index.js` (create) and `api/rooms/[id].js` (read / write) do, via `src/lib/db.js` (a `pg` pool from `DATABASE_URL`), and `src/lib/roomStore.js` is the thin frontend client that calls them. Writes use **optimistic concurrency** — a `version` field on the state, checked with `... WHERE id = $1 AND state->>'version' = $2` — so two players' picks can't clobber each other. Clients get live updates over a **Realtime** subscription (`src/lib/realtime.js`/`supabase.js`, same `@supabase/supabase-js` client/protocol on both deployment targets, just pointed at a different URL/key fetched at runtime from `/api/realtime-config`):

- On **Vercel**, that's a real Supabase project's own hosted Realtime (Supabase is used purely as a managed Postgres + Realtime host now — nothing reads/writes it via supabase-js anymore).
- On **self-hosted Docker**, it's a self-hosted `supabase/realtime` sidecar container watching our own Postgres (bootstrapped by `realtime-schema.sql`), fronted by Traefik.

Per-room player identity and in-progress decks live in `localStorage` (so a refresh rejoins).

**Card data** is isolated in `src/lib/cardData.js`, sourced entirely from community/durable APIs (no dependency on the retiring official API):

- **Set card lists** → [`PolluxTroy0/Altered-TCG-Card-Database`](https://github.com/PolluxTroy0/Altered-TCG-Card-Database) (per-set JSON). Only the standard booster printing is kept; alt-art (`_A_`) / promo (`_P_`) reprints are canonicalised to it.
- **Uniques, promos, alt-art, non-EN** → [`cards.alteredcore.org`](https://cards.alteredcore.org) by reference (`needsCardApi()` decides what `fetchSet` can't supply).
- **Card art images** → the Altered prod S3 bucket (`altered-prod-eu`). _This is the one remaining dependency on Equinox infrastructure;_ `card-images-backup/` holds a local snapshot for the community cubes as a hedge.

**Cubes** live in `src/lib/cubes.js` (`COMMUNITY_CUBES` + a `SPOTLIGHT`). Users can also paste a decklist or load decks from Re:Union; both resolve through the shared `resolveCubeRefs` so they behave like a built-in cube.

**Re:Union integration (optional, opt-in)** — a couple more handlers alongside `api/rooms/*`:

- `api/token.js` — OIDC **Authorization Code + PKCE** against Re:Union's **Keycloak** (confidential client `altered-draft`, realm `players`). It holds the client secret (env only) and does the code↔token exchange + refresh. **BFF-hardened:** the refresh token is stored in an **httpOnly, Secure, SameSite=Strict cookie** and never reaches JS; the browser keeps only the short-lived access token in memory.
- `api/decks/*` — a same-origin **proxy** to the Re:Union decks API (which sends no browser CORS), forwarding the user's bearer token to list/read/create decks.

Login is strictly additive: logged out, `user` is `null` and everything works anonymously.

**Layout:** `src/pages` (Home, Lobby, Draft, Sealed, Results, AuthCallback) · `src/components` · `src/lib` (game logic, card/cube data, DB/Realtime/Re:Union clients) · `src/auth` (`AuthProvider`/`useAuth`) · `api/` (Vercel-style handlers — serverless functions on Vercel, mounted into `server/index.js`'s Express app on the self-hosted deployment). Theming is CSS-variable semantic tokens (`base`/`surface`/`ink`/`accent`…) flipped by `data-theme` — see `src/index.css` + `tailwind.config.js`.

---

## Running locally

```bash
npm install
cp .env.example .env    # fill in DATABASE_URL (+ Supabase keys if using Supabase — see below)
npm run dev             # http://localhost:5173 — frontend only, see note below
```

⚠️ **`npm run dev` (plain Vite) does not serve `/api/*`** — it's a frontend-only dev server, and room create/read/write now goes through `api/rooms/*.js`, not straight to the DB from the browser. To actually create/join a room locally, run the API layer too:

```bash
vercel dev              # runs the frontend + every api/*.js handler together
```

(Re:Union login/save additionally need the Keycloak config below, on top of that.)

---

## Testing

```bash
npm test              # unit tests — pure logic, no DB, runs in a couple of seconds
npm run test:watch    # unit tests in watch mode
npm run test:integration   # api/rooms/*.js against a real Postgres in Docker
```

- **`npm test`** (Vitest) covers the pure-logic modules: draft/sealed pack generation
  (`packGenerator.js`), the draft-format state machines (`draftLogic.js`,
  `rochesterLogic.js`, `rotisserieLogic.js`, `winstonLogic.js`), card-reference helpers
  and unique resolution (`cardData.js`, mocking `fetch`), cube parsing, the ban list, the
  seeded PRNG, and export formatting. No network, no Docker — safe to run constantly.
- **`npm run test:integration`** spins up a throwaway `postgres:16-alpine` container
  (`docker-compose.test.yml`) with the real `draft-rooms-schema.sql` applied, then runs
  `api/rooms/index.js` and `api/rooms/[id].js` against it directly — including the
  optimistic-concurrency compare-and-swap (`state->>'version'`) that guards against two
  players' picks clobbering each other. The container is created and torn down
  automatically (`tests/integration/globalSetup.js`); requires Docker running locally.

---

## Setting up the database (Vercel + Supabase)

Supabase is used here purely as a **managed Postgres + Realtime host** — the browser never talks to it directly; CRUD goes through `api/rooms/*.js` using the connection string below, so no RLS/anon policies are needed for reads or writes.

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL editor, run `draft-rooms-schema.sql` (creates the `draft_rooms` table), then:

```sql
-- So Realtime relays row UPDATEs to subscribed clients.
alter publication supabase_realtime add table draft_rooms;
```

3. In **Project Settings → Database**, copy the **connection string** into `.env`:

```
DATABASE_URL=postgres://postgres:xxxx@xxxx.supabase.co:5432/postgres
```

4. In **Project Settings → API**, copy the **Project URL** and the **publishable / anon** key into `.env` too — these are only used by the Realtime *subscription* now (via `api/realtime-config.js`), not for CRUD, but the frontend still needs them to receive live updates:

```
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

> The Supabase **secret**/service-role key is never needed here — `DATABASE_URL` (server-side only) is how the app writes to Postgres; it must never be committed or exposed to the frontend.

Optional: a `pg_cron` job can delete rooms older than 24h to keep the table tidy (see `supabase-monitoring.sql`).

---

## Running self-hosted (Docker)

The exact same handler code also ships as a Docker image (`build/Dockerfile`'s `app` target, served by `server/index.js`) with its **own** Postgres and a self-hosted `supabase/realtime` sidecar instead of a Supabase project — this is how Re:Union hosts the app on their own infra (**AlteredOps**), pull-deployed via GitOps. It's a multi-container setup (Traefik, a `migrations` one-shot image, the `realtime` sidecar, Pulumi-provisioned secrets) that's out of scope for this README to walk through end-to-end; see `realtime-schema.sql`'s header comment and `build/Dockerfile` for what's actually involved if you want to reproduce it locally.

---

## Setting up Re:Union login (optional)

Skip this if you don't need it — the app runs fully without it, on either deployment target. To enable "Connect Re:Union" (load decks as cubes, save pool/deck):

1. Register a **Keycloak** OIDC client in the Re:Union `players` realm (confidential; the project uses client id `altered-draft`) with a redirect URI for every origin you actually deploy to, e.g. `https://your-app.vercel.app/auth/callback` and `http://localhost:5173/auth/callback` (and, self-hosted, your own domain's `/auth/callback`).
2. Set the client secret as a **server-side env var only** — `KEYCLOAK_CLIENT_SECRET` (a Vercel project env var, or a secret injected into the container on a self-hosted deployment). **Never** put it in `.env`, the bundle, or git.
3. Public OIDC config (issuer, realm, client id) is inline in `api/token.js` / `src/lib/reunion.js` — adjust if your realm differs.

The decks API is reached through `api/decks/*` (same-origin proxy). No extra config needed beyond a logged-in user's token.

---

## Deploying to Vercel

1. Push to GitHub and import the repo at [vercel.com/new](https://vercel.com/new) (Vite is auto-detected).
2. Add env vars in the Vercel project: `DATABASE_URL` (your Supabase project's Postgres connection string), `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (for the Realtime client), and — for Re:Union — `KEYCLOAK_CLIENT_SECRET`.
3. Deploy. `vercel.json` handles SPA routing and keeps `/api/*` routed to the serverless functions.

---

## Sets

The UI shows set names; internal codes appear in card references (`ALT_<SET>_…`).

| Code | Name |
|------|------|
| `CORE` | Beyond the Gates |
| `ALIZE` | Trial by Frost |
| `BISE` | Whisper from the Maze |
| `CYCLONE` | Skybound Odyssey |
| `DUSTER` | Seeds of Unity |
| `EOLE` | Roots of Corruption |
| `FUGUE` | Neverending Journey |

## Booster composition

Each pack is **13 cards**: 1 Hero · 9 Commons (1 per faction + 3 paired-faction draws) · 3 Rares, where roughly 1 in 8 packs swaps its last Rare for a Unique. With free-hero choice the hero slot is dropped (12-card packs). Cube and Multi-Set modes follow the same per-booster shape.

---

## Tech

React (Vite) · Tailwind CSS · Postgres (`pg`) · Vercel serverless functions, or a small Express server (self-hosted Docker) · Supabase-hosted or self-hosted `supabase/realtime` · Keycloak OIDC (Re:Union) · Vitest. Contributions welcome — see the Architecture section for the lay of the land.

---

## License

The project's **source code** is released under the [MIT License](LICENSE).

This is an **unofficial, non-commercial fan project** and is not affiliated with or endorsed by the publisher of Altered TCG. The MIT license covers this repo's own code only — it does **not** cover any Altered TCG game assets (card images, card names/text, set and faction names, logos). Those belong to their respective owners (Equinox / the publisher) and are included here only as a community convenience; see the note at the bottom of [LICENSE](LICENSE). In particular the snapshots under `card-images-backup/` are Equinox-owned art, not MIT-licensed.
