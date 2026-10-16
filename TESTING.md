# Testing checklist — recent batch (Jun 2026)

Everything shipped in the recent push that needs a real check on the deployed site
(https://altered-draft.vercel.app). Most multiplayer items need **two browsers / tabs** (open the
room link in a second tab as a 2nd player). Tick as you go.

---

## 1. Lobby wizard (mode → cards → settings)
- [ ] Step 1 shows **Booster Draft** then **Sealed** first; **▶ Other draft options** expands Rochester / Rotisserie / Winston.
- [ ] If you pick an "other" mode, leave, and come back, the toggle is **auto-expanded** (selection visible).
- [ ] **Next** is disabled on step 2 until a valid pool is chosen; **Back** returns without losing choices.
- [ ] Step indicator (1 · 2 · 3) reflects the current step.
- [ ] Switching to **Sealed** swaps the card tab to **Advanced** (not Multi-Set) and hides the pick timer in settings.
- [ ] Switching to **Winston** with ≠ 2 players shows "Needs exactly 2", and **Start** is disabled.
- [ ] Non-host sees "Waiting for the host…" (no wizard).

## 2. Card sources (step 2), per mode
- [ ] **Presets** helper text is mode-aware: draft "drafts 4 packs", Winston "12 boosters pooled and split", Sealed "7 packs".
- [ ] **Multi-Set** (draft): the target updates per mode — booster needs 4/player (or players×4 in the bag), **Winston needs 12** — and the X/target counter validates.
- [ ] **Advanced** (sealed): new styled rows (set icon + −/+ stepper); "Boosters per player" total turns green at **7**; you can still build any size.
- [ ] **Cubes** still work as a source (built-in cube, paste-your-own, load-from-Re:Union) for the chosen mode.

## 3. Mode-driven pool size (check final pool at Results/Sealed)
- [ ] **Booster Draft** (2p): each player ends ~52 cards. *(unchanged baseline)*
- [ ] **Winston** (2p): each player ends **~72 cards** (the key change — was ~48).
- [ ] **Sealed**: 7 boosters/player (~90 cards). *(unchanged)*
- [ ] **Rochester / Rotisserie**: 4 boosters/player feel unchanged.

## 4. Random uniques in packs
- [ ] Toggle appears in settings **only for booster sources** (presets/multi-set), **not on the Cubes tab**, for both draft and sealed.
- [ ] **Off by default** → no uniques appear (same as before).
- [ ] **On** → roughly **1 in 6 boosters** has a real unique in its **last slot**; the "can take up to a minute" warning shows.
- [ ] Uniques render with **real art** in the draft pack, in Results, and in Sealed pools.
- [ ] **Both players** see the uniques (not just the host) — confirm in the 2nd tab.
- [ ] Perf: with the toggle on while you sit on the settings step, **Start feels snappy** (pool was prefetched).

## 5. Winston (2 players, two browsers)
- [ ] **Heroes = Shuffle into pool**: heroes appear as normal cards you take via piles.
- [ ] **Heroes = Free pick**: every hero is available at deckbuild for both players.
- [ ] **Heroes = Random split**: each player has their own **6 heroes, one per faction** in their pool at Results (best tested on the 12-hero all-sets cube; a single set has only ~6 heroes total so the split is thinner).
- [ ] Board: piles render as a **card-back stack with a big count**; only the **active** player sees the current pile's cards; the waiting player sees all piles face-down.
- [ ] **Take** adds the pile to your pool and refills it; **Pass** grows the pile / moves on; passing all three **draws blind**.
- [ ] The blind-drawn card shows **"You drew this off the deck"**, highlighted, **only to you**.
- [ ] Draft terminates cleanly (deck empties → last pile must be taken) and goes to Results with ~72 cards each.

## 6. Hover zoom / full-card view (draft)
- [ ] Hovering a card in the **pack grid** (booster/rochester) grows it **in place** (no more bottom-right panel).
- [ ] Cards near the **screen edge** anchor so the zoom doesn't get clipped off-screen.
- [ ] **Rotisserie** pool and **Winston** piles + hero strip all zoom in place too.
- [ ] On Winston cards: hover is **bigger (2x)** and **clicking opens a full-size lightbox** (Esc or click-outside closes).

## 7. Alternate formats end-to-end (still need a real multiplayer playtest)
- [ ] **Rochester**: one shared face-up pack, snake order, only the active seat can pick, pack counter advances, → Results with correct pools.
- [ ] **Rotisserie**: whole pool face-up, snake picks, stops at the per-player cap (45), → Results.
- [ ] **Winston**: covered in §5.
- [ ] Heroes = Draft (snake) still works for Rochester/Rotisserie (hero snake runs after the cards).

## 8. Regression — make sure the basics still work
- [ ] **Booster Draft** (the classic), 2+ players, plays start-to-finish.
- [ ] **Sealed** (presets + advanced) opens, builds, saves.
- [ ] **Cube** draft and sealed (built-in + pasted) still work.
- [ ] **Re:Union**: connect, load a deck as a cube, **save pool + deck** still work.
- [ ] **Mobile** (narrow window): wizard, draft pack grid, and the Winston board are usable.

## 9. User-created tournaments (lot 1)
Local: `make dev` (+ altered-dev-environment for login, users `alice` / `bob`). Apply the schema first (`make db-migrate`).

**Form (`/tournament/new`)**
- [ ] As `alice`: name "Test cup", paste `https://fr.boardgamearena.com/tournament/?id=123456` → green "Tournament id 123456 detected". Pick Skybound Odyssey, leave uniques 1/1, submit → redirect to `/tournament/t/<id>`; `curl -s localhost:8080/api/tournaments | jq '.tournaments[0] | {name, bgaTournamentId, status}'` shows the row.
- [ ] Submit again with the same link in a new form → "A tournament already exists for this BGA link." under the link field.
- [ ] Start set to yesterday → "The start must be a valid date in the future." without a request (network tab idle).
- [ ] Pick Neverending Journey → the unique steppers are disabled with the "No unique data…" hint; submitting succeeds with 0 uniques.

**Tournament page (`/tournament/t/:id`)**
- [ ] Logged out: header, dates in your timezone, summary line; step 2 shows "Connect to prepare your pool"; no organizer panel.
- [ ] As `alice` (organizer): organizer panel with "0 from this site · 0 created by BGA games", Delete enabled.
- [ ] "Open my pool" → `/tournament/t/<id>/pool`: the pack reveal shows 7 boosters + the guaranteed unique; title "Test cup"; the back link returns to the tournament page where step 2 is ticked and the panel reads "1 from this site"; Delete is disabled with the tooltip.
- [ ] As `bob` in another browser → "Open my pool" → a different pool; `alice`'s page shows "2 pools prepared".
- [ ] As `alice`: Edit → Cards/Settings and the BGA link are disabled with the locked notice; renaming works. Cancel → pill "Cancelled", step 2 for a third account shows "Pool creation is closed"; the organizer panel and Edit stay available while cancelled (rename works); Restore brings it back.
- [ ] BGA path: `curl -s "http://localhost:8080/api/tournament-bga-decklist?tournamentId=123456&tournamentName=X&gameId=g1" -H "Authorization: Bearer $TOKEN"` for an account without a pool → one `hydra:member` named "Random Test cup"; the organizer panel shows "1 created by BGA games"; that account's "My tournaments" lists "Test cup".

**Menu (`/tournament`)**
- [ ] Logged out: "Upcoming tournaments" shows the "Test cup" card (status pill, local start time, summary, organizer, pool count); Create sends to login; "My tournaments" is replaced by the Connect box.
- [ ] As `alice`: the card shows "✓ Your pool is ready"; "My tournaments" lists "Test cup" with its pill and "Change my deck" → `/tournament/t/<id>/pool`; "Prepare my next tournament" sits at the bottom in a small block.
- [ ] Edit the start to yesterday (as organizer) → the card moves to "Ongoing tournaments".

**Follow-ups after the lot-1 review**
- [ ] Logged out, open `/tournament/t/<id>/edit` → the Connect prompt shows (no redirect to the tournament page).
- [ ] Close a tournament whose end date has passed, then Reopen → status back to Ongoing, end date cleared.
- [ ] As a player with a declared-tournament pool AND a legacy-bound pool, "My tournaments" lists the declared one first.
- [ ] Form: set uniques to 1 + 1, tick "even factions", lower to 1 + 0 → the box unticks; the saved config has `evenFactions: false`.
- [ ] Rename a tournament that has pools → "My tournaments" and the pool page title show the new name; the deck is renamed on its next sync / BGA load.
- [ ] Relink an unlocked tournament to a BGA link another tournament uses → "A tournament already exists for this BGA link." under the field (409, not a 500).
- [ ] Detach (needs a moderator: `TOURNAMENT_MODERATORS=<sub>` in `.env`, restart the API): as a moderator, the panel shows "Detach (moderator)" with its hint; the confirm says how many pools will be deleted; after it, status "Detached", the red notice, only Delete left; the players' pools are gone ("My tournaments"); a new declaration with the same BGA link succeeds and a BGA deck-list call for that id lands on it. As the organizer (not moderator), no Detach button; Edit on a detached tournament redirects to its page.

**Regression / deploy**
- [ ] Lobby → Sealed → Cards: the set grid looks and toggles as before (select, click again to deselect, Next disabled until a set is chosen); Sealed settings still show the card-language row.
- [ ] Deploy: `sealed-pools-schema.sql` applied on the target DB (Supabase SQL editor / AlteredOps migration), then `node --env-file=.env scripts/freeze-sealed-pools.mjs` once; the log reports `frozen N/N pools (0 failed)`.
- [ ] A legacy bound pool (created before the deploy) still opens from "My tournaments" and its deck validates on BGA (pool contents unchanged after freezing).
- [ ] **Verify with Re:Union on a real multi-stage BGA tournament** that the public URL's `id` equals the `tournamentParentId` altered-bga-api forwards (organizer panel: "created by BGA games" > 0 after round 1).
- [ ] Vercel preview: the nested route `api/tournaments/[id]/pool.js` answers (only exercised through Express in the tests).

---

### Notes / things to watch — RESOLVED (fixed/verified, no need to re-check)
- ~~Winston + Multi-Set "same packs" toggle~~ — **fixed**: the toggle is now hidden for Winston (replaced by "All boosters are pooled… and split"), and it forces the whole-bag total (12).
- ~~Uniques in a non-EN language~~ — **verified**: the cards API returns all five locales; `normalizeAlteredCore` picks the right name and falls back to the EN image if a locale's art is missing.
- ~~Split-hero faction bucketing~~ — **verified**: the all-sets heroes are standard `ALT_<SET>_B_<FAC>_NN_C` refs (exactly 2 per faction), so the ref's faction letters bucket them correctly.
