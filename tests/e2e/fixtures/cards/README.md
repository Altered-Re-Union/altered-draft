# E2E card fixtures

Trimmed copies of the community card database set files, served by the fake process at
`/carddb/<SET>/<SET>_EN.json` (the app reaches it through `CARD_DB_URL`).

- Source: `https://raw.githubusercontent.com/PolluxTroy0/Altered-TCG-Card-Database/main/SETS`
- Snapshot: 2026-10-26, `main` at `3e37693714e98cbf83f1f04bdb045493f80f5c90`
- Content: only the `B` printings (what `fetchSet` keeps anyway) and the fields `normalizeCard`
  reads (`reference`, `name`, `mainFaction`, `rarity`, `cardType`, `elements` costs and powers),
  minified. EN only.
- Refresh: `node scripts/e2e-card-fixtures.mjs` (or `node scripts/e2e-card-fixtures.mjs CYCLONE`
  for one set), then re-run the suite — a changed card list can move the pools' contents.

Why these three sets:

| Set | Name | Why |
|---|---|---|
| `CYCLONE` | Skybound Odyssey | the acceptance steps' working set for declared tournaments |
| `EOLE` | Roots of Corruption | the active format seeded by `sealed-pools-schema.sql`: normal / preparation pools and the "imposed format" steps draw it |
| `FUGUE` | Neverending Journey | no faction-range data, which the "uniques unsupported" steps depend on |

Cube sets, for the V5 cube-sealed steps (the All commons community cube and its alt-art paste case):

| Set | Content |
|---|---|
| `CORE`, `BISE`, `DUSTER`, `ALIZE` | the All commons cube's refs only, every printing (no `B` filter: BISE holds the promo-only `ALT_BISE_P_BR_64_C`), plus the kept refs |

Refresh: `node scripts/e2e-card-fixtures.mjs --cube all-commons --keep ALT_DUSTER_B_AX_98_C`
(the full sets above are left as they are).

Any other set answers 404 from the fake, so a pool of that set fails to generate — intended.
