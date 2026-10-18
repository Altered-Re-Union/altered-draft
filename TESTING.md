# Manual regression checklist

The things the automated suites can't see: real browsers, several players, the Re:Union login,
BGA. Run the whole list before a risky change ships (Lobby refactor, new format, deploy-target
change), and the relevant section for any change in that area. Keep it current: a feature that
ships adds its section here, a behaviour that changes updates its line. Detailed, one-off test
campaigns (setup steps, curl commands, every edge case of a new feature) belong in a
per-campaign recette, not here.

**Automated first.** `npm test` (unit) and `npm run test:integration` (API handlers + SQL against
a throwaway Postgres, needs Docker) must be green; `npm run build` must succeed.

**Where to test.** Locally with `make dev` (+ `../altered-dev-environment` for login: users
`alice` / `bob`, password `TestPassword1234`; Chrome or Firefox), or on preprod
(https://altered-draft-preprod.altered.re, AlteredOps). Multiplayer items need **two browsers / tabs** (open the room
link in a second tab as a 2nd player). Locally there is no Realtime: pages poll every 1.5 s.

---

## 1. Lobby wizard (mode → cards → settings)
- [ ] Step 1 shows **Booster Draft** then **Sealed** first; **▶ Other draft options** expands Rochester / Rotisserie / Winston, and stays expanded when an "other" mode is selected.
- [ ] **Next** is disabled on step 2 until a valid pool is chosen; **Back** returns without losing choices; the step indicator (1 · 2 · 3) follows.
- [ ] **Sealed** swaps the card tab to **Advanced** (not Multi-Set) and hides the pick timer.
- [ ] **Winston** with ≠ 2 players shows "Needs exactly 2" and **Start** is disabled.
- [ ] Non-host sees "Waiting for the host…" (no wizard).
- [ ] Settings show the **card language** row (EN FR ES DE IT) in draft and sealed.

## 2. Card sources (step 2)
- [ ] **Presets**: the set grid selects / deselects on click (COREKS absent); the helper text is mode-aware (draft 4 packs, Winston 12 boosters pooled, sealed 7 packs).
- [ ] **Multi-Set** (draft): the target follows the mode (4 per player, or players × 4 in the bag; Winston 12) and the X/target counter validates.
- [ ] **Advanced** (sealed): set rows with −/+ steppers; the total turns green at **7**; any size can still be built.
- [ ] **Cubes**: built-in cube, paste-your-own and load-from-Re:Union all work as a source, for draft and sealed.

## 3. Pool size per mode (check the final pool on Results / Sealed)
- [ ] **Booster Draft** (2p): ~52 cards each. **Rochester / Rotisserie**: 4 boosters per player.
- [ ] **Winston** (2p): ~72 cards each.
- [ ] **Sealed**: 7 boosters per player (~90 cards).

## 4. Random uniques in packs
- [ ] The toggle shows only for booster sources (presets / multi-set), not on the Cubes tab, in draft and sealed; it is **off by default** (no uniques).
- [ ] **On**: roughly 1 booster in 6 has a real unique in its last slot, with real art in the pack, Results and Sealed, for **both** players; the "up to a minute" warning shows; Start stays snappy (pool prefetched on the settings step).

## 5. Draft formats (multiplayer)
- [ ] **Booster Draft**, 2+ players, start to finish → Results with the right pools; Heroes = Draft (snake hero pass between rounds) works.
- [ ] **Rochester**: one shared face-up pack, snake order, only the active seat picks, pack counter advances → Results.
- [ ] **Rotisserie**: whole pool face-up, snake picks, stops at the per-player cap (45) → Results.
- [ ] **Winston**: piles render as a card-back stack with a count; only the active player sees the current pile; Take adds and refills, Pass grows the pile, passing all three draws blind ("You drew this off the deck", only to you); the draft ends cleanly when the deck empties.
- [ ] **Winston heroes**: Shuffle into pool (taken via piles) / Free pick (all heroes at deckbuild) / Random split (6 heroes, one per faction, each).
- [ ] **Hover zoom**: cards grow in place in the pack grid, the Rotisserie pool and the Winston piles, anchored away from screen edges; on Winston, click opens a full-size lightbox (Esc / click outside closes).

## 6. Sealed, deckbuilding, export
- [ ] **Sealed** (presets + advanced + cube) opens, the deckbuilder works, the validity badge follows the rules (≥ 30 cards, ≤ 3 factions, ≤ 1 hero).
- [ ] **Export menu** (Results and Sealed): copy card list, copy decklist; logged in, **Save your pulls** and **Save your deck** create decks on Re:Union with working deckbuilder links.

## 7. Re:Union account
- [ ] Connect / disconnect from Home; the session survives a reload (refresh-token cookie) and a logged-out visit makes no refresh call.
- [ ] Load a deck as a cube (search + format chips), preview it, draft it.

## 8. Tournaments (BGA sealed) — see `docs/tournaments/README.md`
- [ ] **Normal pool** (`/tournament/normal`): pool + pack reveal; **Reset pool** gives a new pool, then a 30-minute cooldown.
- [ ] **Generic preparation pool** (`/tournament/prep`, bottom of `/tournament`): one-shot pool, no reset.
- [ ] **Declare a tournament** (`/tournament/new`, logged in): validation is live — the BGA link is parsed as you paste it ("Tournament id … detected", or "already exists"), and the submit bar stuck to the bottom of the screen stays disabled while it lists the remaining problems (too-short name, past start, end before start, no set…), each one jumping to its field; a set without unique data disables the unique steppers. Session expired before submitting (wait out the access token, or block `/api/token`): "Reconnect (your input is kept)" brings the form back filled in.
- [ ] **Tournament page** (`/tournament/t/:id`): public header, local-time dates, config summary; the 3-step checklist (register on BGA, remembered → open my pool → build my deck); organizer panel with pool counts by origin.
- [ ] **Pool** (`/tournament/t/:id/pool`): one stored pool per player (same contents on every visit), deck sync to decks-api, back link to the tournament. **Random deck** then a few quick card edits on a fresh pool → exactly ONE deck on decks-api (no duplicate).
- [ ] **Lifecycle**: once a pool exists, cards / settings / BGA link are locked and Delete is disabled; rename reaches the pools; Cancel closes pool creation (existing pools stay usable, the tournament stays editable) and Restore reopens; Mark as ended / Reopen (a passed end date is cleared).
- [ ] **Moderation** (moderator via `TOURNAMENT_MODERATORS` / `TOURNAMENT_MODERATOR_ROLE`): **Detach** deletes the pools created for the declaration, keeps the ones that already existed on BGA before it (they re-attach to the next declaration of that BGA link, with their format), and frees its BGA link; the detached tournament is read-only.
- [ ] **Menu** (`/tournament`): "My ongoing tournaments" grid at the top (started tournaments you have a pool in: the card opens the tournament page, "Change my deck" opens the pool); tabs Upcoming (default) / Ongoing / My pools (declared tournaments first, generic preparation block at the bottom) / My created tournaments (ongoing then upcoming, chronological; ended / cancelled / detached folded in "Ended and cancelled (N)"), each with its one-line explanation, the active tab kept in the URL (`?tab=`); Create and the personal tabs prompt a login when logged out.
- [ ] **BGA path**: a deck-list call (`/api/tournament-bga-decklist?tournamentId=…`) for a declared tournament creates or returns the player's pool for it ("Random <tournament name>" deck when none was built), for an undeclared id binds the generic preparation pool; the organizer panel counts pools "created by BGA games".
- [ ] **Declared after BGA started**: declaring (or relinking to) a BGA id that players already play with pools in the default format shows, as soon as the link is pasted, that the format is imposed (set and settings locked to theirs); the created tournament adopts their pools at once (they see it on the tournament page, it is locked). Pools of different formats on that id → the declaration is refused (message under the link, 409 server-side).
- [ ] A pool bound before the stored-pools migration still opens from "My pools" and its deck validates on BGA.

## 9. Cross-cutting
- [ ] **FR UI**: no English leftovers or raw keys on the pages touched by the change.
- [ ] **Light and dark themes** (☀ / ☾): everything readable, status pills and error boxes included.
- [ ] **Mobile** (375 px): wizard, draft pack grid, Winston board, tournament form and page are usable, no horizontal scroll.
- [ ] No JS error in the console, no 500 in the network tab along the way.

---

## Before deploying
- [ ] Schemas applied on the target DB (the AlteredOps migrations image applies them on deploy; the Re:Union fork is not deployed on Vercel).
- [ ] **Active format drawable** (on the target DB, before deploying): `SELECT * FROM current_format ORDER BY created_at DESC, id DESC LIMIT 1;` must not name a set outside `CORE`, `COREKS`, `ALIZE`, `BISE`, `CYCLONE`, `DUSTER`, `EOLE` with `unique_count > 0` or `guaranteed_uniques > 0` (no faction-range data: the unique draw throws, every new normal / pending pool would fail).
- [ ] **Legacy rows freezable** (tournaments lot 1, before the freeze): `SELECT count(*) FROM sealed_pools WHERE cards IS NULL AND set_code NOT IN ('CORE','COREKS','ALIZE','BISE','CYCLONE','DUSTER','EOLE') AND (unique_count > 0 OR guaranteed_uniques > 0);` → 0 (those rows would fail to regenerate).
- [ ] **Freeze, once, after the stored-pools migration**, when the new container serves: `docker exec altered-draft node scripts/freeze-sealed-pools.mjs` → `frozen N/N pools (0 failed)` (locally: `make db-freeze-pools`). Re-running is harmless.
- [ ] New env vars set (`.env.example` lists them); on AlteredOps they must also be in the service's explicit `environment:` list (`TOURNAMENT_MODERATOR_ROLE`, `TOURNAMENT_MODERATORS`).

## Open verifications (need someone outside this repo)
- [ ] **Re:Union, on a real multi-stage BGA tournament**: the public URL's `id` equals the `tournamentParentId` altered-bga-api forwards (organizer panel: "created by BGA games" > 0 after round 1).
- [ ] **Re:Union**: create/assign the moderator realm role (`TOURNAMENT_MODERATOR_ROLE`); until then, the `TOURNAMENT_MODERATORS` allowlist.
