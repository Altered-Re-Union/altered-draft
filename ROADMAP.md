# Altered Draft Simulator — Roadmap

Working notes for upcoming work, kept in the repo so it's available from any machine.
See `CLAUDE.md` for full project/architecture context.

Context (June 2026): the site was shared on the Altered Discord and got a strong reception.
Equinox (the publisher) is winding down; **Re:Union / Altered Reunion** is the official
community project keeping Altered alive — and its dev reached out to integrate. The two
forces shaping this roadmap are (1) building toward that Re:Union integration and (2) a
closing window on the old `api.altered.gg` card/unique API before it's retired.

**Update (Jul 2026): that window has closed.** `api.altered.gg` (DNS gone) and both Altered S3
image buckets are down (`403 AllAccessDisabled`). The app now depends entirely on community
infrastructure: card data from the PolluxTroy0 GitHub DB, card+unique lookups from
`cards.alteredcore.org`, and card images from the `cdn.alteredcore.org` community CDN
(built by reference — see "Recently shipped"). No remaining dependency on Altered-hosted APIs.

---

## Now — active priorities (in order)

### 0. Make the website as good as possible — CURRENT FOCUS (Jun 2026, user's call)
With Re:Union **account integration live and verified**, the priority shifts from new integrations to
**polishing and validating what's deployed**. Plugin integration and open-sourcing are both **postponed**
(the account integration already delivers the Re:Union value; being embedded on their site is now a
nice-to-have, not a goal). Backlog ideas (draft log/replay, cube analytics) are **not being pursued**.
Immediate work: **QA the recent batch** (`TESTING.md` checklist — the alternate formats, the lobby wizard,
mode-driven pool size, random uniques, Winston, hover zoom), then continue UX/visual polish.

### 1. Re:Union (Altered Reunion) account integration — core SHIPPED; site-plugin thread POSTPONED
Connect the app to the **official Re:Union identity** so logged-in users can push their
drafted deck straight into their account. This does NOT mean building our own accounts
(see Dropped) — Re:Union owns the identity layer (Keycloak), DB, and auth; we're a client.
Strictly **optional and additive**: anonymous use (paste cubes, localStorage decks, file
export) is unchanged; "Connect Re:Union" just unlocks extras for those who opt in.

**✅ Auth FOUNDATION shipped (June 2026):** login/logout works in code — `api/token.js`
(serverless code↔token exchange), `src/lib/reunion.js` (PKCE OIDC client), `AuthProvider` +
`useAuth()`, `/auth/callback` route, `ReunionButton` on Home. Deployed and **verified live end-to-end**: a real user logged in (redirect URIs registered by the
dev) and their pseudo renders — the full Connect → Keycloak → callback → token exchange (function +
`KEYCLOAK_CLIENT_SECRET`) → userinfo flow works.

**✅ Step 2 (deck read/write) shipped (June 2026) — pending live user test.** Both features built +
deployed; the proxy layer is verified live (no-auth → our 401; bogus token → upstream's 401, proving
forwarding). Decks API `https://decks.alteredcore.org` via same-origin Vercel proxies
(`api/decks/index.js` GET list/POST create, `api/decks/[id].js` GET detail) forwarding the Bearer token
(no browser CORS). **Load a cube from your decks** (Lobby Cubes tab) and **save pool + final deck**
(one `ExportMenu` dropdown on Results/Sealed). Shared `resolveCubeRefs` (`src/lib/cubeResolve.js`) turns
deck cards into a cube like paste. **UX pass shipped (17 Jun 2026)** after first live testing: deck picker
now fetches the WHOLE list (`itemsPerPage=1000&order[name]=asc`) with a name-search box + format-filter
chips + a Preview-cube button; the 4 export/save buttons collapsed into one **Export / Save** dropdown
(copy card list, copy decklist, save pulls, save deck); saves use **`format:'sandbox'`** and are named
`"<code> · <Draft|Sealed> <pool|deck> · DDMM"`. Decks-API contract (format enum, query filters) confirmed
from the live OpenAPI `https://decks.alteredcore.org/api/docs.json`. **✅ Live save VERIFIED (17 Jun 2026):** logged-in user saved both a Sealed pool (91 cards / 7 heroes)
and a Sealed deck to their Re:Union account — both appear in the deckbuilder. No 403 (our `openid profile`
token is accepted as-is, no extra scope needed); sandbox pool/deck not rejected. **Fixed same day:**
connect was only reachable inside the Export/Save dropdown, so users mid-session couldn't log in to save —
added `ReunionButton` to the Sealed + Results top bars (login redirect is safe; pool/picks are in Supabase
room state, deck + identity in localStorage, so they survive the round-trip). **✅ Saved-deck "open ↗"
links reworked (Jun 2026):** a finished **deck** opens in **altered.re's** clean per-deck viewer
(`altered.re/pages/deck?id={id}` — altered.re IS Re:Union, same deck data, handles its own login so no
raw 401); a saved **pool** opens in the **deckbuilder** (`deckbuilder.alteredcore.org/decks/{id}`), which
lists the full pool incl. every hero (altered.re's legality-lens deck view only surfaces ONE hero, which
made a multi-hero pool look like it lost heroes — but the decks API stores all heroes as `deckCards`, no
single-hero field; verified via OpenAPI, nothing dropped on save). **The earlier deckbuilder-401 → flag a
silent-SSO to the Re:Union dev is NO LONGER NEEDED** (user's call) — the altered.re link sidesteps it.
**Priority note:** **saving the built DECK is the headline feature; the POOL save is secondary** — don't
over-invest in pool polish. **Not feasible:** a deck-size (≥80 cards) picker filter — the list endpoint
returns no card count (only the per-deck detail does).
_Hardening fast-follow: move the refresh token to an httpOnly cookie._ ✅ done.

**Re:Union site plugin integration — POSTPONED (Jun 2026, user's call).** Account integration is live, so
being embedded on the Re:Union site is no longer a priority; the feasibility is assessed (below) and can be
revived later. Original thread: noobiwow [ALTR] reached out: Re:Union has a
**plugin system** to add community tools directly onto the Re:Union site, and invited the project into the
`software-dev-website` channel to discuss with their web dev team. **Plugin docs received (Jun 2026):**
- How-to / API: **`https://altered.re/plugins/README.html`** (also in the repo below).
- Repo + example plugins: **`github.com/Altered-Community/alteredcore-website/tree/dev/plugins`**.
- Devs' advice (Darigaaz, Shnk, Haalford [ALTR]): read the doc first to learn what's possible, then feed
  the doc + the example plugins to Claude Code to get going. **Likely can't embed this app directly** (no
  iframe / as-is drop-in); we may have to **re-implement** the features we want to port as a native plugin.
  Shnk offered to guide the first steps (DM).
**Status:** intro + project updates posted to Discord; docs now in hand. **Next concrete step:** read the
plugin doc and scope which features port first (draft/sealed engine vs. just the cube/deck tooling).

**Plugin feasibility — assessed (Jun 2026, from README.html + `plugin.schema.json` + the `equinox-deck-import`
example).** The plugin system is **server-side PHP inside the alteredcore-website**, NOT an iframe/embed:
- A plugin = `plugin.json` manifest + `pages/` (PHP templates served at `/pages/{slug}`), `admin/`, `api/`
  endpoints (`/api/{id}/{endpoint}` → JSON), `assets/` (css/js), `sql/` (own MySQL tables via `$db` PDO).
  Manifest fields: `id,name,version,description,author,icon,table_prefix,pages[],admin[],api[],assets{css,
  js,global_*},sql,tables[]`.
- **Auth/data come FOR FREE:** `kcIsLoggedIn()`, `kcUser()`→`{sub,email,username}`, `deckApiToken()`, plus
  `CARDS_API_URL`/`DECKS_API_URL`/`COLLECTION_API_URL`/`CDN_URL`. So inside a plugin our **entire
  Vercel-token-exchange + decks-proxy layer disappears** (server-side API calls, no CORS, Keycloak already
  wired). `equinox-deck-import` already does deck-API writes server-side (`CurlDeckApiClient` +
  `KeycloakTokenProvider`) — a solved pattern we can copy.
- **Client-side UI is possible:** a page PHP template can mount a JS bundle from `assets.js` into a div
  (equinox-deck-import ships a vanilla-JS app driving `papi/` endpoints). So our **React UI can be bundled
  and mounted** — we don't have to rewrite it in vanilla JS, just drop `react-router` (the page is the
  mount point) and adapt the build to emit one asset bundle.
- **THE blocker = realtime.** The host gives PHP + MySQL + request/response JSON only. **No websockets/SSE
  anywhere** in the schema or examples. Our whole multiplayer layer is **Supabase Realtime** (row-UPDATE
  subscription + optimistic `version` writes). Porting it means **polling** a plugin API endpoint backed by
  a MySQL `draft_rooms`-equivalent table.
  - Turn-based formats (Rochester/Rotisserie/Winston/hero draft) are low-frequency (one writer per turn) →
    polling every ~1-2s is fine; ports cleanly.
  - Booster draft is simultaneous, but our optimistic version-concurrency already handles contention;
    polling just gets chattier. Feasible, more work.
- **Feature feasibility verdict:** single-player / async (cube preview, deckbuilding, stats, sealed-solo,
  **save/load to Re:Union**) ports well and gets *simpler*. Multiplayer realtime draft is the real
  re-implementation (sync layer Supabase→MySQL-poll).
- **Recommended path = phased.** (1) Ship a small plugin first — cube preview + sealed-solo + deck
  save/load — to validate the PHP toolchain and the bundled-React-mount, near-zero risk, immediate value on
  the Re:Union site. (2) Then port the realtime layer to MySQL-poll and bring the draft modes over. **Open
  question for Shnk before committing to multiplayer:** does/will the host expose any realtime channel, and
  is bundling a client-side SPA on a plugin page blessed? Standalone Vercel app stays as-is meanwhile.

**Auth setup (provided by the Re:Union dev):**
- Protocol: **OpenID Connect** via **Keycloak**.
- Issuer / base: `https://auth.altered.re/`, realm `players`
  (discovery: `https://auth.altered.re/realms/players/.well-known/openid-configuration`).
- `clientId`: `altered-draft`. **Confidential client** (a client secret exists).
- **Client secret is NEVER in git / never in the browser bundle / never pasted into chat or repo.**

**Decided architecture — confidential client + one Vercel Serverless Function:**
- The app is a frontend-only static SPA, so the secret can't live client-side. A single
  stateless Vercel function (e.g. `/api/token`) holds the secret as a **Vercel env var**
  (`KEYCLOAK_CLIENT_SECRET`) and performs the `code → token` exchange (+ refresh). Still no
  database, still no real backend — just one function. (Public-client+PKCE was the
  alternative; we chose to keep his confidential client and add the function.)
- Use **Authorization Code + PKCE** on top (defense in depth; Keycloak supports both).
- Flow: SPA redirects to Keycloak → user logs in → back to `/auth/callback?code=…` →
  SPA POSTs the code to `/api/token` → function exchanges it (with the secret) → returns the
  user's access/refresh tokens → SPA calls the Re:Union **decks API** with the user's Bearer token.
- Public OIDC config (issuer, realm, clientId) can be plain constants / `VITE_` vars; only the
  secret is server-side.

**Local dev environment — DROPPED (user's call).** `github.com/Altered-Community/altered-dev-environment`
(a .NET Aspire stack running the whole Re:Union backend locally) exists, but with `collection`/`profile`
scopes dropped and deck read/write already shipped + verified on prod, there's nothing left that needs
it. Verify-on-deploy is sufficient. Kept below for reference only if a future scope ever revives the need:
- **Keycloak** (realm `players`) at `http://auth.altered.local.gd:18080`, admin `admin`/`admin`;
  test users `alice`/`bob` (pw `TestPassword1234`). `*.local.gd` → 127.0.0.1 (no hosts-file edit).
- **decks-api** at `http://localhost:8001` (the deck-write target); **collection-api** OpenAPI at
  `http://localhost:8002/api/docs`. Read the deck contract straight from the running API.
- Register our own **confidential `altered-draft`** client via the realm seed
  `AlteredAuth/dev/clean.js` (then restart `altered-auth`): redirect `http://localhost:5173/auth/callback`,
  web-origin `http://localhost:5173`; copy its secret. `DEV_AUTH_ENABLED` (HS256 `iss:dev`) shortcut
  exists for testing deck-writes without the full login.
- Confirms our architecture: the decks-api "uses a confidential client requiring consent."
- Prereqs (ALL on one machine — `*.local.gd` is 127.0.0.1): Docker, .NET 10 SDK, Aspire CLI, plus
  Node + Vercel CLI for our `vercel dev` side. Run `./run.ps1` / `./run.sh`.
- **Setup deferred — not started (user's call).** This Windows box has only `git` on PATH; macOS
  already has Node, likely the lighter lift.

**Decks API contract — FOUND in `github.com/Altered-Community/alteredcore-website`**
(the `equinox-deck-import` plugin's `CurlDeckApiClient.php` + `Domain/{Card,Deck}.php`):
- Auth: `Authorization: Bearer <user access token>` + `Accept: application/json`.
- **List my decks:** `GET {base}/api/decks` → array (or `{items|decks|data:[...]}` wrapper).
- **Deck detail (with cards):** `GET {base}/api/decks/{id}` → full deck incl. `deckCards`.
- **Create:** `POST {base}/api/decks` JSON `{ name, format:"standard", isPublic:false, isDraft:false,
  deckCards:[{cardReference:"ALT_…", quantity:1-99}] }` → 2xx `{ id }`. Hero = just a 1-of entry in
  `deckCards`. Card ref must match `^ALT_[A-Z0-9_]+$` (uppercase).
- Maps cleanly to both objectives: load-cube = GET list → GET {id} → expand `deckCards`; save =
  POST twice (pool + final deck).

**Resolved by probing (step 2 now effectively unblocked):**
- **Prod base URL = `https://decks.alteredcore.org`** ✅ (`GET /api/decks` → 401
  `application/problem+json` "Full authentication is required"; Symfony API behind Cloudflare).
- **CORS → MUST proxy** ✅ — preflight returns allow-methods/headers but **no `Access-Control-Allow-Origin`**
  for our origin, so direct browser calls are blocked. Route decks calls through **Vercel proxy functions**
  (`api/decks…`) that forward the user's Bearer token server-side (BFF pattern; also enables the httpOnly
  hardening later).
- **Scope:** resource APIs validate the realm JWT signature (per dev-env README), so our `openid profile`
  token is very likely accepted as-is — confirm on the first authenticated call; add a scope only if it 403s.

**Feature tiers (each maps to a Keycloak/API scope):**
- 🟢 **`deck:write`** ✅ shipped — save pool + final deck to your Re:Union account.
- 🟢 **`deck:read`** ✅ shipped — build a cube from one (or several, merged) of your account decks.
- ✅ **`profile` (pseudo)** — display name auto-fills from your Re:Union pseudo at room creation/join
  when logged in (Home, June 2026). **DROPPED from scope (user's call):** draft history, account-based
  cross-device rejoin, authenticated-only rooms — not wanted.
- ❌ **`collection:read` — DROPPED (user's call).** Reading the collection mainly helps with uniques,
  but Re:Union's spirit is "all cards playable regardless of collection," which is exactly the
  draft/sealed ethos. We deliberately keep play collection-agnostic; no owned/not-owned overlay,
  no "draft from my collection."
- ❌ **card-data API — NOT NEEDED for now (user's call).** Our current card source
  (`cards.alteredcore.org`, see #2) is treated as the long-term solution, so we don't need Re:Union
  to ship its own. Card-fetch stays isolated in `cardData.js` so swapping later would be a small
  adapter change if it ever becomes worthwhile.

### 2. Uniques — dying-API dependency REMOVED ✅ (bundling now just an offline hedge)
**✅ Shipped (June 2026):** `fetchUnique` was the last live caller of the retiring
`api.altered.gg` (hit for any non-bundled unique or non-EN locale). Repointed it to
**`cards.alteredcore.org/api/cards?reference=<ref>`** — the durable community API that resolves
**any** unique. New `normalizeAlteredCore` adapter for its JSON shape; `prodImage()` host-swaps
the locked `altered-dev` S3 bucket → public `altered-prod-eu`; CORS verified; bundled EN snapshot
kept as offline/fast path + failure fallback. `api.altered.gg` is no longer referenced anywhere.
So unique-heavy community cubes (CptKawaii's "cube unique", wordcandy70's "Uniques Cube") now
resolve durably, not just our 24.

**✅ Community-cube art backed up (Jun 2026).** All 640 cards across `COMMUNITY_CUBES` are
snapshotted as ~720px WebP in `card-images-backup/` (~53MB) via the committed, resumable
`scripts/snapshot-cube-images.sh` (pulls compressed copies through `images.weserv.nl` — no local
image tools needed). **Backup only** — NOT wired into app rendering (still loads full-res from
Equinox at runtime); `.vercelignore`'d so it stays git-only, not served. Re-run after editing cubes.

**Remaining (DROPPED FOR NOW — user's call, Jun 2026):** bundling MORE unique images locally was the
last open thread here. Dropped: the community-cube art is already snapshotted (above), both Equinox
buckets currently serve art (200), and the whole ecosystem (incl. Re:Union's deckbuilder) shares the
same dependency — so this isn't worth doing pre-emptively. Revisit only if the prod S3 bucket actually
goes dark (data stays fine regardless). The how-to below is kept for reference if that day comes.
Only 24 are bundled (`src/lib/uniquesData.js` `UNIQUES_EN` + `public/uniques/<ref>.jpg`); everything
else loads live from `cards.alteredcore.org` (data) + the prod S3 bucket (art).
- **⚠️ Why this is the residual risk — `altered-prod-eu.s3.amazonaws.com` is Equinox's OWN
  production image bucket** (same company/infra as the retiring `api.altered.gg`), NOT the community
  `cards.alteredcore.org`. So: card **data** is community-rebuilt and durable, but card **art** still
  comes from Equinox infra that isn't guaranteed to outlive the API. If that bucket ever goes dark,
  images break (data stays fine). Hence snapshotting art locally is the only Equinox dependency left
  to neutralise — opportunistic, prioritise refs people actually paste. Needs Node (run on macOS).

**New durable data source (tested June 2026):** `api.altered.gg` is being retired, but the
community site **`cards.alteredcore.org`** serves the same data and should outlive it.
- **Endpoint:** `https://cards.alteredcore.org/api/cards?reference=<REF>` (Symfony / API
  Platform; no auth). Returns `{ member: [<card>], totalItems }`. The single-id path
  (`/api/cards/<ref>`) 500s — always use the `?reference=` filter.
- **Verified:** all 24 bundled uniques **+** an arbitrary new ref (`ALT_CORE_B_AX_16_U_5075`)
  resolve with full data, and `faction.code` matches our hardcoded factions exactly — including
  every out-of-faction case (e.g. `..._AX_16_U_...` → Bravos, `..._BR_19_...` → Lyra). So this
  source can snapshot **any** unique, not just our 24, even after the old API dies.
- **Different JSON shape** than the old API (needs its own adapter, NOT `normalizeCard`):
  `name` / `imagePath` / `cardType.name` are **per-locale objects** (use `.en`); faction is
  `faction.code` + `faction.name`; `rarity.reference`; `cardType.reference`; and **flat integer**
  `mainCost` / `recallCost` / `forestPower` / `mountainPower` / `oceanPower` (no `#...#` markers).
- **⚠️ Images = the one remaining Equinox dependency; NO community mirror exists (checked Jun 2026).**
  The cards API only returns Equinox S3 URLs/paths (`imagePath.en` → `altered-dev.s3.eu-west-3.amazonaws.com`).
  alteredcore.org does NOT host card art (probed cards./images./media./cdn./assets.alteredcore.org →
  404/none) — and **Re:Union's own deckbuilder also loads art straight from the Equinox `altered-dev`
  bucket.** So the whole ecosystem shares this dependency, not just us. Current status: **both Equinox
  buckets serve the art (200)** — `altered-dev` AND `altered-prod-eu` (we host-swap `imagePath.en` to
  `altered-prod-eu.s3.amazonaws.com`; identical path+hash). **Implication:** if the buckets ever go
  dark it breaks Re:Union's deckbuilder too, so the community would likely stand up an image mirror —
  which we'd adopt with a one-line base-URL change. Until then, our only way to be Equinox-independent
  is self-hosting snapshots (below).

**Action (snapshot script, when refs are in hand — no code yet):** for each unique ref, GET
`cards.alteredcore.org/api/cards?reference=<ref>`, map the fields above into a `UNIQUES_EN`
entry, and download the art from the **prod**-bucket URL (host-swap the returned `imagePath.en`)
to `public/uniques/<ref>.jpg`. Commit the script this time (the original wasn't committed).
Prioritise refs from the community cubes people are actually pasting. Needs Node → run on macOS
(not on PATH on Windows).
- **Urgency reassessed:** card **data** is now future-proofed by `cards.alteredcore.org`, so this
  is no longer a hard deadline for metadata. **Art still depends on the prod S3 bucket staying
  public** — so grabbing images sooner is the remaining time-sensitive part. May later be
  superseded if Re:Union ships its own card-data + image API (1🔴), but that's not guaranteed.
- Possible enhancement: accept a pasted list of unique refs and snapshot them on demand.

### 3. Import Marcus' cube (data-only) — ON HOLD until functionality feedback (user's call, Jun 2026)
A cube by a game designer (MarcusK, engaged on Discord). Add it the manual way, like LuigiNico's.
**On hold:** new cubes wait until there's user feedback on the recently-shipped functionality
(free-hero pool, full boosters, Re:Union save, etc.) — no point importing more cubes before the
current cube experience is validated. Also still blocked on the author's full card list regardless.
- **Blocker:** the current list is **missing a few cards** — author is completing it. Don't
  finalise `refs[]`/`cardCount` until the full list lands.
- Add an object to `COMMUNITY_CUBES` in `src/lib/cubes.js` (`id, name, author, description,
  cardCount, refs[]`, plus `heroDraft`/`heroes`/`booster`/`maxPlayers` if it applies).
- Convert official identifiers (e.g. `BTG-131-U-894`) to internal refs
  `ALT_<SET>_B_<FAC>_<n>_<rarity>`. Out-of-faction cards use their real `_R2` ref (see the OOF
  note in `CLAUDE.md`); uniques stay as-is.
- If it has uniques, bundle them (see #2 — same script) while the API is up.
- Add a `booster` recipe (`{ commons, rares, uniques }`) if the rarity mix can't use the classic
  split — see `generateCubeRecipePacks` in `src/lib/packGenerator.js`.
- **Heroes:** has 12 heroes → set `heroDraft: true` + `heroes:[…12 refs]`; the in-app hero draft
  (shipped) handles it. Cap `maxPlayers` to what the pool supports (LuigiNico = 4 because 192 = 4×4×12).
- Source CSV parsed so far: 12 heroes + 367 cards across **all 6 factions** (Ordis + Yzmir
  included, no faction relabel needed); rarities C / R / O (off-faction) / U. Uncertain entries
  still need author input or substitution (no live API): `Halua (unique ?)`, `Nike Unique à 6`,
  `Spotter Unique`, `Jumper R ?`, `Sakarabru?`, blank-rarity `Wingsuit Jumper` — plus the
  not-yet-listed missing cards.

---

## Planned

### From Dev-Discord feedback (Jun 2026) — SHIPPED
First reactions to the alternate-formats build, from the Re:Union dev channel:
- **✅ Sealed "4 packs" → "7 packs" helper bug** (Haalford [ALTR]). The Presets-tab helper text hard-coded
  "4 packs"; it's now mode-aware (`draftMode === 'sealed' ? 7 : 4`) in `Lobby.jsx`.
- **✅ Help modal headings unreadable.** `HelpModal` section titles were `text-accent` (low-contrast gold
  on the cream/dark bg) → now `text-ink font-semibold`.
- **✅ Em-dash sweep.** Per "the — looks too AI coded", removed em-dashes from all user-facing copy
  (descriptions, blurbs, errors/toasts, cube descriptions, format/hero option text), using `. , : ;` or
  parens instead. Code/JSX comments left as-is. Style preference recorded for future copy.

### From live testing (17 Jun 2026) — mostly SHIPPED
Backlog captured after the user tried the deployed app; the batch was built the same day.

- **✅ Bug — top-nav wordmark sent in-room users to room creation.** `TopNav` now uses
  `useParams`: inside a room the wordmark links to that room's lobby instead of `/`.
- **✅ Free hero choice (all heroes available).** A single **Heroes** control in the lobby (radio:
  **In packs** | **Free choice**, replacing the two overlapping checkboxes) drives `heroMode` →
  `includeHeroes`/`config.freeHero`. Free choice keeps heroes out of all packs/boosters (every mode,
  draft + sealed). `packHeroes = includeHeroes && !freeHero` gates pack generation; cube hero-draft /
  sealed slot-0 / custom-cube hero folding are all skipped when on. **NOTE: the original `HeroPicker`
  deckbuild UI was REPLACED (17 Jun 2026) by pool-seeding** — see "Cube booster fixes" below; the
  picker component is deleted.
- **✅ Cube of the Month spotlight — live with "All Commons".** `SPOTLIGHT` in `cubes.js` points at
  the `all-commons` cube (192 commons, exactly 32 per faction, 12 heroes snake-drafted); banner atop
  the Cubes tab features it. Swap `SPOTLIGHT.cubeId`/`blurb` to rotate next month. Hero names were
  resolved to refs via `cards.alteredcore.org`; `ALT_COREKS_B_BR_03_C` stays OUT (it's Basira, a hero,
  already in the 12).
- **✅ Promo/alt-art cards in cubes.** `cardData.needsCardApi(ref)` (uniques + any non-booster print)
  now drives the cube "extra fetch" everywhere (Lobby draft+sealed, Draft, Sealed, Results,
  CubePreviewModal), so promo-ONLY cards with no booster print resolve from the cards API — e.g.
  "Sofia, First Outpost" (`ALT_BISE_P_BR_64_C`), the 32nd Bravos common in All Commons.
- **✅ Export/Save menu harmonized.** Parallel verb-noun labels (Copy/Save your pulls · your deck)
  with a count on every row.
- **✅ Cube booster fixes (17 Jun 2026).** Three issues from live cube play: (1) **full-size
  boosters** — `generateOnePack` backfilled nothing when a cube had no rares/uniques (e.g. All
  Commons), giving 9-card boosters; it now backfills empty rare slots with unused commons → 12 body
  cards (+ hero = 13). (2) **Free-hero = pool seeding, not a picker** — removed the `HeroPicker`
  deckbuild UI; "Free choice" now seeds every player's pool with one copy of each *available* hero
  (the cube's hero list, or the played sets' heroes — not the whole roster), picked like any card.
  `handleStart` computes `config.freeHeroPool` per mode; Results/Sealed merge it into the pool + load
  its data. (3) **Naming** — unified "pulls" → "pool" (Copy/Save your pool; Results tab "Full Pool").
- **◑ Graphic polish — first pass done.** Light-mode page background deepened so panels separate;
  more look-and-feel work (card grids, spacing, iconography) can continue once eyeballed.
- **✅ Menu improvements — Help + Feedback live.** `TopNav` has a Help modal (`HelpModal`) and a
  **Feedback ↗** link to a "Bugs & Ideas" Google Form (`FEEDBACK_URL` in `src/lib/links.js`).
- **✅ Menu font matched to Altered Core.** AC's title font is the commercial **Tiller**; used
  **Fraunces** (closest free Google match) as `font-display`. Swap in real Tiller if licensed.
- **✅ Harden code for Re:Union — robustness pass done.** decks client: clearer 401/403 ("session
  expired") errors, empty-save guard, name trimmed to 150 chars, `toDeckCards` drops non-`ALT_`
  refs and clamps qty 1–99 per the live OpenAPI. (The bigger httpOnly-cookie hardening is now also
  done — see its own section below; only open-sourcing remains deferred.)

### ✅ Fix: heroes in built-in cube sealed — SHIPPED (verified not happening)
Hero-draft cubes (LuigiNico, All Sets, All Commons) used to deal **zero heroes** in sealed.
Resolved by `dealHeroSlots` (`src/lib/packGenerator.js`): each sealed booster gets a hero in
slot 0 drawn (with repetition) from `cube.heroes`, for both recipe and non-recipe cubes, with the
hero sets loaded so they render in `Sealed.jsx`. Confirmed live (Jun 2026). With **Free hero
choice** on, slot-0 heroes are skipped (you free-pick at deckbuild instead).

### ✅ Security hardening — httpOnly refresh-token cookie (SHIPPED Jun 2026)
The Re:Union **refresh token** no longer touches JS: `api/token.js` stores it in an **httpOnly,
Secure, SameSite=Strict cookie** (`reunion_rt`, `Path=/api/token`) and the browser keeps only the
short-lived **access token in memory** (`reunion.js` `session`). Refresh sends no token from JS (the
function reads the cookie + rotates it); a readable `reunion_auth=1` hint cookie lets `isLoggedIn()`
skip the refresh probe for anonymous loads; logout clears both. Proper BFF pattern — closes the one
real auth-flow security debt and unblocks open-sourcing.

### Open-source under Altered-Community — REPO PREPPED ✅, move POSTPONED (user's call, Jun 2026)
**Postponed alongside the plugin** — focus is on polishing the live site, not the org move. Everything is
ready (below); the actual transfer is a user-driven GitHub step whenever it's wanted.
The Re:Union dev offered to host the project open-source on the official
[Altered-Community](https://github.com/Altered-Community) GitHub org.

**✅ Repo made public-ready (Jun 2026):**
- **License = MIT** (`LICENSE` + `package.json` `"license":"MIT"`). The MIT grant covers our **code
  only**; a NOTICE block in `LICENSE` (and a README License section + `card-images-backup/README.md`)
  makes explicit that **Altered TCG game assets — card art, names, text, logos — are Equinox property
  and NOT MIT-licensed**, included only as an unofficial/non-commercial fan-project convenience.
- **Secret history scan = CLEAN** (re-run Jun 2026): `git log --all -S` for `service_role`, `sb_secret`,
  `client_secret=`, `KEYCLOAK_CLIENT_SECRET=`, `-----BEGIN`/private keys → **0 commits each**; `.env`
  never tracked; `.env.example` blank; Supabase **publishable/anon** key only (env-injected, safe).
- **Card art = LEFT IN by choice (user's call).** `card-images-backup/` (641 Equinox WebP, ~53MB) stays
  committed; covered by the asset-rights carve-out above rather than removed. (It also remains in history
  — a future fresh/squashed push could drop it if ever wanted.)

**Move when ready — the remaining step is on GitHub, user-driven:** transfer/create the repo under the
Altered-Community org (or push there). Nothing left to prep in-repo.

### LuigiNico's newest cube (set 1–5) — PARKED by choice
Author shared a now-public [Google Sheet](https://docs.google.com/spreadsheets/d/1a3ZZ2AzzPp05rWJq9Mzt6torBro4noEC74Pn27KXxX0/edit?gid=0)
with tag-column notes, but it's **missing some uniques** ("add any six you feel like") and a bit
out of date. **Parked** until set 6 is playable on BGA **and** there's feedback on the new
functionality (user's call, Jun 2026) — new cubes wait on validating the current experience first.
This is a DIFFERENT, newer cube than the LuigiNico cube already in the app.

---

## Recently shipped

- **Card images migrated to the community CDN** (Jul 2026, **incident fix**). Altered disabled public
  access to BOTH its S3 image buckets (`altered-prod-eu` AND `altered-dev` now return `403
  AllAccessDisabled`) and retired `api.altered.gg` (DNS gone), so every card image 404'd/403'd at once
  (the community DB's `imagePath` and the cards API's `imagePath` both pointed at the dead buckets). New
  `cardImageUrl(reference, lang)` builds the URL from the reference against
  `https://cdn.alteredcore.org/cards/<lang>/<SET>/<REF>.webp` (web-optimized `.webp`, CORS `*`,
  deterministic — no per-card hash). Both `normalizeCard` and `normalizeAlteredCore` route through it;
  the dead `prodImage()` host-swap is removed. **Uniques** aren't on the CDN but share their base rare's
  art, so it falls back to the `…_R1` printing (so a live/random unique shows the rare's face — right art,
  rare's stats; the 24 bundled cube uniques keep their local `/uniques/*.jpg`). (`src/lib/cardData.js`)
- **Hero-draft overhaul — heroes drafted FIRST** (Jul 2026). Rochester / Rotisserie / Winston now
  snake-draft heroes at the **very start**, before the cards, instead of an end-of-draft snake. Booster
  still interleaves a hero pass between card rounds. Implemented with a `heroStart` flag: the build
  functions seed the full card-phase state but start in `phase:'heroDraft'`; `applyHeroPick` flips to the
  named card phase once the opening snake completes. Winston gains a **`draft`** hero option; a new
  **"Heroes per player" stepper** (`config.heroCount`, min 1, max = `floor(pool/players)`) with copy
  clarifying that **every** hero from the boosters or cube goes into one shared pool. (`draftLogic.js`
  `heroTargetFor`, `rochesterLogic.js`, `rotisserieLogic.js`, `winstonLogic.js`, `SettingsFields.jsx`)
- **"My pool" overlay during drafts** (Jul 2026). An accent **My pool (N)** button in the draft top bar
  opens a full-screen read-only `PoolGrid` of everything drafted so far (heroes + picks), with the same
  faction filter / group-by / hover zoom as the Results pool. `PoolCard` +/- controls are now conditional
  so the grid renders read-only. (`Draft.jsx`, `PoolGrid.jsx`)
- **Two-column Winston board** (Jul 2026). Piles on the left, the **revealed card + take/decline actions +
  blind-draw shown to the right** (`xl:flex-row`) instead of stacked, so the card you're deciding on sits
  beside the piles. (`WinstonBoard.jsx`)
- **Rotisserie / Winston cube duplicate fix** (Jul 2026). Formats that flatten all packs into one shared
  pool now route recipe cubes (e.g. LuigiNico) through `generateCubeDraftPacks` (no pool recycling)
  instead of `generateCubeRecipePacks` (which recycles per-pack and produced duplicate cards once
  flattened). Also: the **Rotisserie grid** was made denser (10 cols at lg, matching the deckbuilder) after
  it rendered too large, and the sealed **"Advanced" tab was renamed "Multi-Set"** everywhere for
  consistency. (`Lobby.jsx`, `RotisserieGrid.jsx`)
- **Wizard recap + crash safety** (Jul 2026). A recap line under the wizard progress bar shows the chosen
  **mode** (and, from step 3, the **card summary**) so the host can see their selections while on settings.
  Fixed a **blank-page crash** on room creation (a `const` derived from `equalPacks` was declared before
  the `useState` — a temporal-dead-zone `ReferenceError` Vite doesn't catch at build); wrapped the app in
  an **`ErrorBoundary`** so a render crash shows a message + Reload instead of a silent blank page.
  (`Lobby.jsx`, `ErrorBoundary.jsx`, `main.jsx`)
- **Lobby reframed as a mode-first 3-step wizard** (Jun 2026). FIFA-style: **how to play → cards →
  settings** (replaces the old draft/sealed toggle + the pre-flight modal). Step 1 picks the **mode**
  (Booster Draft + Sealed up front; Rochester / Rotisserie / Winston behind an "Other draft options"
  toggle). Step 2 picks the card pool (the existing Presets / Cubes / Multi-Set / Advanced sources,
  filtered to the mode). Step 3 is mode-aware settings (`SettingsFields`, extracted from the deleted
  `StartSettingsModal`). `mode` state drives everything (draftMode + draftFormat now derived);
  `wizardStep` + Back/Next/Start replace the modal. Engines, generation, and `handleStart` logic
  unchanged. (`Lobby.jsx`, `SettingsFields.jsx`)
- **Mode-driven pool size** (Jun 2026). Each mode targets boosters per player (`BOOSTERS_PER_PLAYER` in
  `Lobby.jsx`): booster/rochester/rotisserie 4, **Winston 6** (= 12 total for 2p ≈ 72 cards each), sealed
  7. `bpp` replaces the hardcoded 4 across every draft path — Presets generate it automatically, the
  Multi-Set/Boosters source validates against it (asks the host for the right number), cubes generate
  `players × bpp` packs. Only Winston's amount changed; fixes its previously-thin pool. The sealed
  **Advanced** picker was also restyled to match the Multi-Set picker (set icons + −/+ steppers + running
  "Boosters per player" total). (`SetSelector.jsx`)
- **Winston polish** (Jun 2026). Selectable hero handling instead of the end-of-draft snake (heroMode
  `packs` = shuffle into pool, `free` = pick from all, **`split`** = each seat pre-dealt one hero per
  faction into `heroPicks`, NEW). Board redone: piles render as a card-back **stack with a big count**;
  the **blind-drawn card** (decline all three) is surfaced highlighted to the drawer only (`state.lastBlind`).
  (`winstonLogic.js`, `WinstonBoard.jsx`)
- **Deckbuilder-style hover zoom in the draft** (Jun 2026). Replaced the detached bottom-right
  `CardPreview` (deleted) with the deckbuilder's **in-place zoom** (`useZoomOrigin`): cards grow under the
  cursor, anchored to stay on-screen. New shared `ZoomCard` for standalone cards (Winston piles, hero
  strip) hovers at 2x and **opens a full-size lightbox on click**; `CardGrid`/`RotisserieGrid` zoom the
  art in place. (`ZoomCard.jsx`, `CardGrid.jsx`, `RotisserieGrid.jsx`, `Draft.jsx`)
- **"Add random uniques to packs"** (Jun 2026). Optional StartSettingsModal toggle (`config.addUniques`),
  booster-based modes only (presets / multi-set / custom-pool draft + sealed; NOT cubes). Standard set
  files carry no uniques, so off by default = no uniques as before. On: each booster has an independent
  **1/6** chance its **last slot** becomes a **real, live-fetched unique** (`fetchRandomUniques` →
  `cards.alteredcore.org` `rarity=UNIQUE&set.reference=<SET>&random=1`). Threaded through
  `generateAllPacks`/`generateChaosPacks`/`generateStructuredPacks` + `generateOnePack(randomUniqueRate)`.
  Injected serialized `_U_` refs resolve for display via a new `uniqueRefsIn(state)` scan + `fetchUniques`
  in Draft/Sealed/Results. (`src/lib/cardData.js`, `src/lib/packGenerator.js`, `StartSettingsModal.jsx`, `Lobby.jsx`)
- **Cube sealed booster labels fixed** (June 2026). Cube sealed packs are multiset, but the
  booster header labeled each by its first card's set (e.g. "Booster 2 · Skybound Odyssey 1/1").
  Now cube rooms (built-in or pasted) show the cube name, no set icon/ordinal; Multi-Set/Chaos
  sealed (genuinely single-set) unchanged. (`src/pages/Sealed.jsx`)
- **Usage monitoring** (June 2026). `draft_rooms` self-purges hourly (pg_cron `cleanup-old-rooms`,
  >24h), so a `room_stats(day, rooms_created)` table is tallied by the cron BEFORE the delete for
  permanent history. Snapshot + history queries documented in `supabase-monitoring.sql`.
- **Personal cubes via paste**. NO accounts / storage. Cubes tab "＋ Paste your own cube" panel
  (name + `<qty> <REF>` decklist). `parseDecklist` (`src/lib/cubeParser.js`) → refs with
  quantities (refs-only). On Parse: refs resolved against set data + bundled uniques, **heroes
  auto-detected** and split out, duplicates kept, **unresolved refs surfaced** (callout) and
  skipped. Carried inline as `config.customCube = { name, cards:[refs], heroes:[refs] }`, synced
  via Realtime. **Draft:** `generateCubeDraftPacks` on the non-hero multiset; heroes use the
  shared-pool snake draft when `uniqueHeroes ≥ players`, else fold into packs. **Sealed:** heroes
  stay in pool, 7 multiset boosters/player. Player cap auto-derived. Mutually exclusive with
  built-in cube selection. `Draft.jsx`/`Results.jsx`/`Sealed.jsx` resolve uniques from `customCube`.
- **Merged "Multi-Set" draft tab**. Advanced + Chaos → ONE draft tab with "All players receive the
  same packs" (default ON, `config.equalPacks`). One per-set selector (`MultiSetSelector.jsx`);
  required total follows the toggle: **ON → per-player, sum = 4**; **OFF → whole bag, sum =
  players × 4**. Both deal single-set boosters: ON → `generateStructuredPacks` (same set per round
  for all seats); OFF → `generateChaosPacks` (shuffled bag). Stored as `config.multiSetMix` +
  `config.equalPacks`. DRAFT only — sealed keeps its Advanced tab. Removed `ChaosSelector.jsx` +
  `config.chaosMix`.
- **In-app hero draft**. For `heroDraft` cubes, heroes are snake-drafted from ONE shared pool
  (`cube.heroes`): one hero per player after each card round, until each has `min(3,
  floor(pool/players))` → 3 at 2–4 players, 2 at 5–6. `applyPick` pauses into `heroDraft` after
  each round; `applyHeroPick` resumes. Drafted heroes merge into each seat's Results pool.
  `Draft.jsx` phase-aware. Used by LuigiNico (12 heroes, maxPlayers 4) and the All Sets cube
  (12 heroes, 324 cards, maxPlayers 6).

## Alternate draft formats (in priority order)
Each is a new draft **format** (not a new lobby tab) chosen in the pre-flight settings modal; it produces
each player's pool, then hands off to the EXISTING Results/deckbuilder/save flow unchanged (no changes to
card data, cubes, or Re:Union). All are **turn-based / sequential** (one active picker at a time) — which
actually *simplifies* the optimistic-concurrency writes (only one writer per turn, ~no contention) but adds
turn-waiting downtime, fine at low player counts. **Architecture note:** the room `state` is a single
anon-readable Supabase row, so **open-information formats fit cleanly** (nothing to hide); hidden-info
formats can only be "honor system" — acceptable IF the UI never surfaces the hidden cards (so you can't
cheat *through the UI*, only by inspecting raw network/state).

**✅ Pre-flight settings modal shipped (Jun 2026) — later SUPERSEDED by the lobby wizard (see Recently
shipped).** The format/heroes/timer choices it gathered now live in the 3-step wizard (`StartSettingsModal`
→ `SettingsFields`), and the draft-format selector became the wizard's step-1 "mode" picker. The original
design: "Start draft"/"Start sealed" opened a modal with **Draft format**, card language, **Heroes** (In
packs / Free choice / **Draft**), pick timer. The **Heroes → Draft** option snake-drafts heroes in-app
(generalizes cube hero-draft to any pool via `resolveDraftHeroes` in `Lobby.jsx`; too few heroes → seeded
into pools as a fallback). All draft branches build state through `buildDraftState` (`draftLogic.js`),
which dispatches on `config.draftFormat`.

1. **✅ Rochester — SHIPPED (Jun 2026).** One booster opened **face-up for everyone**; players draft one
   card each in **snake order** from that single shared pack until it's empty, then the next pack opens
   (opener rotates each pack for fairness). Fully open info. `src/lib/rochesterLogic.js`:
   `phase: 'rochester'` with `{ activePack, packQueue, pickOrder, turnPos, opener, packNum, totalPacks }`;
   `rochesterOrder` (snake), `applyRochesterPick`. `Draft.jsx` renders the shared pack with a
   "your turn / waiting for X" banner + a pack counter, reusing `CardGrid`/`PlayerStatus`/`DraftSidebar`
   and the existing version-retry pick loop. Heroes=Draft runs a finishing hero snake after the last pack
   (`heroFinish` in `applyHeroPick`). **Pending live 2-player test** (verify-on-deploy below).
2. **✅ Rotisserie — SHIPPED (Jun 2026).** No packs — the whole draftable pool is laid out face-up and
   players snake-draft ANY single card until each has `target` cards (`ROTISSERIE_CAP = 45`, adapts down
   for small pools). Fully open info. `src/lib/rotisserieLogic.js`: `phase: 'rotisserie'` with
   `{ pool, pickOrder, turnPos, target }`; `buildRotisserieState` flattens the generated packs into one
   shared pool (so it works for any config, not just cubes); `applyRotisseriePick` reuses
   `rochesterOrder` (snake) + the same `heroFinish` finishing hero snake. New `RotisserieGrid.jsx` (the
   pool is too big / has duplicates for `CardGrid`) — faction-filtered, deduped with ×N, click-to-draft on
   your turn. `Draft.jsx` shares turn logic with Rochester (`isSnakePick`). **Pending live test.**
3. **✅ Winston — SHIPPED (Jun 2026, 2 players).** Face-down main `deck` + 3 small `piles` (seeded 1 card
   each). On your turn you look at the current pile and **Take** it (into your pool, then refill from the
   deck) or **Pass** (adds a face-down card to it and moves you to the next pile); pass all 3 and you draw
   the top of the deck blind. `src/lib/winstonLogic.js`: `phase: 'winston'` with `{ deck, piles, turn,
   peekIndex }`; `applyWinstonAction(state, seat, 'take'|'decline')`, plus the same `heroFinish` finishing
   hero snake. Termination is guaranteed (when the deck empties, Pass walks to the next non-empty pile and
   the last pile must be taken). **Honor system enforced in the UI:** `WinstonBoard.jsx` reveals pile
   contents ONLY to the active player and ONLY for `piles[peekIndex]`; every other pile (and all piles, to
   the waiting player) renders face-down as a count. 2-player only — the format is disabled in the selector
   and `handleStart` guards unless exactly 2 players. `Draft.jsx` uses a separate `doWinstonAction` (same
   optimistic-concurrency commit as picks, but the move is an action not a card ref). **Pending live test.**
- (Grid draft — also open-info, the other canonical 2-player format — considered but not prioritized;
  revisit if 2-player demand shows up.)

All three alternate formats (Rochester, Rotisserie, Winston) are built and have since been **refined from
user feedback** (see Recently shipped): the lobby is now a mode-first wizard, pool size is mode-driven
(Winston gets a deeper 12-booster pool), Winston has selectable hero handling + a reworked board, and the
draft uses deckbuilder-style hover zoom. **Still pending: a real multiplayer playtest of each format.**
Then we explore the Re:Union plugin feasibility (see Now #1). Hero handling across all modes is flagged for
a later consistency review.

## Other candidate / backlog — NOT being pursued (user's call, Jun 2026)
Parked indefinitely; focus is polishing what's live, not adding features.
- **Draft log & replay** — record each seat's picks *and* passes; review after the draft.
- **Cube analytics** — extend `CubePreviewModal` with curve / faction-balance / rarity stats.

## Waiting on assets
- FUGUE logo, Exalted gem (currently fall back to text / reuse the rare gem).

## Dropped (do not implement)
- **Homegrown accounts / login / user database** — still dropped. We do NOT build our own auth.
  NOTE: integrating with **Re:Union's official Keycloak OIDC** is a different thing and IS in scope
  (Now #1) — identity, DB and auth live on Re:Union's side; we only hold the client secret in a
  Vercel env var and call their API with the user's token. Personal cube *sharing* stays paste-based.
- Bot players; asymmetric pack distribution (superseded by Multi-Set/Chaos); spectator mode; card
  flagging (built then reverted — not wanted).
