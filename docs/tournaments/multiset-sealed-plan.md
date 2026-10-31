# Multi-set sealed and random uniques (V3) — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer declare a sealed tournament whose 7 classic boosters are split over several sets, and let every sealed source (one set, multi-set, mono-faction) draw its in-booster uniques at random, one booster in N, instead of an exact count.

**Architecture:** A third `source.type`, `multiset`, in the shared config validator (normalized to `set` when one set is left), its own branch `buildMultisetPool` in the pool builder over a new `generateMultisetSealedPool` (single-set boosters, shuffled), and a `uniques.randomOneIn` option applied after the exact path of every source so lot 1 and V2 draws stay byte-identical. The form's "One set" tab becomes "Sets": the grid stays the one-click shortcut, a disclosure gives the per-set split; the uniques block gets an "Exact number / Random" switch with a "1 in N" slider.

**Tech Stack:** Node 22, Express 5 (same handler modules as the Vercel layout), `pg`, React 18 + react-router 6 + Tailwind semantic tokens, vitest (`npm test`, `npm run test:integration` against Docker Postgres), Playwright (`make e2e`, fakes + card fixtures CYCLONE / EOLE / FUGUE).

**Spec:** `docs/tournaments/user-tournaments-spec.md` §13 (design, decisions, rng contract), §5.1 (config), §5.2 (generation). Read §13 first. V2's PR (#25, `feat/mono-faction-sealed`) is the pattern: same files, same test layers, same recette conventions.

## Global Constraints

- Branch `feat/multiset-sealed`, created from `feat/mono-faction-sealed` (PR #25, still a draft). The PR is based on that branch and retargeted to `main` once #25 merges. Never rebase: update with merge commits.
- Scope: declared tournaments only. No change to the Lobby, to `current_format`, to legacy pools, nor to the BGA-facing contracts (`/api/tournament-bga-decklist`, `/api/tournament-pool*`).
- `source.boosters` stays `7` (`SEALED_BOOSTERS`); a multiset's counts sum to exactly 7; a multiset left with one set is stored as `set`.
- The two existing golden digests in `src/lib/__snapshots__/poolBuilder.golden.test.js.snap` **must not move**. Any task that touches `packGenerator.js`, `poolBuilder.js` or `uniqueFactionRanges.js` runs `npm test -- poolBuilder.golden` before committing.
- Rng contract (spec §13.3): booster stream = boosters, shuffle, rare-slot positions or random rolls; uniques stream = set draws, then `pickDeterministicUniques` per set in `SETS` order. `randomOneIn` is config-only (not in the seed nor the snapshot columns).
- Uniques always come from the bundled faction-range tables (`pickDeterministicUniques`), never from the live cards API.
- UI copy in both `src/lib/i18n/en.js` and `fr.js`; semantic Tailwind tokens only (`surface*`, `ink*`, `muted`, `faint`, `line`, `accent*`, `ok`, `danger`), never raw `gray-*` / `green-*` / `red-*`.
- Docs travel with the code: `docs/tournaments/README.md` **and** `docs/tournaments/index.html`, `CLAUDE.md`, the spec, in the same commits as the behaviour they describe (Task 14 gathers the doc pass; earlier tasks may not leave a doc stale at merge time).
- Recette conventions (`docs/tournaments/acceptance-mono-faction-sealed.html` is the template): every step that runs something carries its full copy-paste command, URLs quoted, no `!` inside double-quoted shell strings, checked with `zsh -n`; new steps start unchecked; ids are `ms-<group>-<slug>` and must not exist in another page.
- Code, comments, commit messages in English. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit only the files each task touches.
- Node ESM: JSON imports need `with { type: 'json' }`; `pg` jsonb parameters are `JSON.stringify`ed.

## Review Focus

Inputs the spec implies that a user will hit; each one gets a test in the task that owns the code.

1. **A multiset whose counts sum to 7 but include a set at 0, or a single set at 7** — stored exactly as the equivalent `set` config, so an old tournament and a "mix" of one set are indistinguishable downstream. → Task 1.
2. **Random mode on a multiset that mixes Neverending Journey with a set that has unique data** — accepted; NEJ boosters never hold a unique, the others roll; the form says so instead of disabling uniques. → Tasks 2, 5, 10.
3. **Exact in-booster uniques on a multiset with few eligible boosters** (`SKY ×1, NEJ ×6`, 4 uniques) — refused with a message naming the cap, never a 500 or a pool with fewer uniques than asked. → Tasks 2, 7, 10.
4. **Two per-set unique draws on the same uniques stream** (random hits on one set + guaranteed on another, or two sets in a multiset) — never the same serial twice in a pool. → Tasks 4, 5.
5. **A multiset pool's booster reveal** — the Roots of Corruption boosters show the pack photo, the others go straight to the cards, and the mono-faction pool still shows none. → Task 11.

---

## File structure

**Created**

| File | Responsibility |
| --- | --- |
| `tests/e2e/specs/multiset-sealed.spec.js` | Playwright replay of the V3 acceptance steps. |
| `docs/tournaments/acceptance-multiset-sealed.html` | The V3 recette page (`ms-` ids). |

**Modified**

| File | Change |
| --- | --- |
| `src/lib/tournamentConfig.js` (+ `.test.js`) | `multiset` source, normalization to `set`, `randomOneIn`, the `inBoosters` cap, `configSetCodes`. |
| `src/lib/packGenerator.js` (+ `.test.js`) | `generateMultisetSealedPool`, `pickRareSlots`, `rollBoosterHits`, `pickWeightedSet`; `swapUniquesIntoRareSlots` delegates. |
| `src/lib/poolBuilder.js` (+ `.test.js`, `.golden.test.js`, snapshot) | `buildMultisetPool`, `placeRandomUniques`, the shared `isAllowed`. |
| `api/_lib/tournamentPool.js` | `poolResponse.sourceType`. |
| `tests/integration/tournaments.test.js` | `buildPool` mock over `multiset`; API guards, normalization, `set_code NULL`, `sourceType`. |
| `src/lib/tournamentForm.js` (+ `.test.js`) | Issue mapping for `source.sets` and `uniques.inBoosters`. |
| `src/lib/i18n/en.js`, `fr.js` | The `tournaments.*` keys of §13.4. |
| `src/components/SetPresetGrid.jsx` | Optional `counts` prop: `×n` badge, ✓ at 7. |
| `src/components/SetWeightsList.jsx` | Generalized: `max`, `maxTotal`, `format`, `trailing`, `testIdPrefix`. |
| `src/components/TournamentCardsSource.jsx` | "Sets" tab: grid + "Mix several sets" disclosure + counter. |
| `src/components/TournamentUniqueFields.jsx` | Mode switch, slider, hidden stepper / even factions. |
| `src/pages/TournamentForm.jsx` | `setCounts`, `mixOpen`, `randomOneIn`, messages, draft / edit / imposed prefill. |
| `src/components/TournamentBits.jsx` (+ `.test.js`) | Multiset and random summary parts. |
| `src/components/PackReveal.jsx`, `src/components/TournamentPoolView.jsx` | Cover per set-pure booster, `sourceType`. |
| `tests/e2e/support/api.js` | `multisetTournamentBody()`. |
| `tests/e2e/specs/faction-sealed.spec.js`, `unique-faction.spec.js`, `tournament-create.spec.js` | `sourceOneSet` → `sourceSets`; `randomOneIn: null` in the `uniques` expectations. |
| `scripts/e2e-acceptance-coverage.mjs` | Third page in `ACCEPTANCE_PAGES`. |
| `docs/tournaments/README.md`, `index.html`, `CLAUDE.md`, `user-tournaments-spec.md` | §14.7, the V3 paragraph, cross-checks. |

---

### Task 1: `multiset` source in the config validator

**Files:**
- Modify: `src/lib/tournamentConfig.js`
- Test: `src/lib/tournamentConfig.test.js`

**Interfaces:**
- Produces: `SOURCE_TYPES = ['set', 'faction', 'multiset']`; `validateTournamentConfig(input)` accepts `{ type: 'multiset', sets: { CODE: 0..7 }, boosters?: 7 }` and returns `source: { type: 'multiset', sets: { CODE: n>0 } (SETS order), boosters: 7 }`, or `{ type: 'set', setCode, boosters: 7 }` when one set is left; `configSetCodes(config)` returns the `sets` keys in `SETS` order for `faction` **and** `multiset`, `[setCode]` for `set`; `legacyColumnsFromConfig` gives `set_code: null` for a multiset (already true: it tests `type === 'set'`).

- [ ] **Step 1: Write the failing tests** — new `describe('validateTournamentConfig multiset source')`, with `const multi = sets => ({ format: 'sealed', source: { type: 'multiset', sets }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0 } })`:

```js
it('accepts a split, drops zeros, coerces strings, keeps SETS order', () => {
  const r = validateTournamentConfig(multi({ EOLE: '3', CYCLONE: 4, FUGUE: 0 }))
  expect(r.ok).toBe(true)
  expect(r.config.source).toEqual({ type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 }, boosters: 7 })
  expect(Object.keys(r.config.source.sets)).toEqual(['CYCLONE', 'EOLE'])
})
it('normalizes a multiset left with one set to a set source', () => {
  for (const sets of [{ CYCLONE: 7 }, { CYCLONE: 7, EOLE: 0 }, { CYCLONE: '7' }]) {
    expect(validateTournamentConfig(multi(sets)).config.source).toEqual({ type: 'set', setCode: 'CYCLONE', boosters: 7 })
  }
})
it('refuses a total other than 7, a count out of range, a hidden or unknown set, an empty split', () => {
  for (const sets of [{ CYCLONE: 4, EOLE: 2 }, { CYCLONE: 4, EOLE: 4 }, { CYCLONE: 8 }, { CYCLONE: -1, EOLE: 8 }, { CYCLONE: 2.5, EOLE: 4.5 }, { COREKS: 7 }, { NOPE: 7 }, {}, { CYCLONE: 0 }, 'CYCLONE', null]) {
    expect(validateTournamentConfig(multi(sets)).errors, JSON.stringify(sets)).toEqual(['source.sets'])
  }
  expect(validateTournamentConfig({ ...multi({ CYCLONE: 4, EOLE: 3 }), source: { type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 }, boosters: 6 } }).errors).toEqual(['source.boosters'])
})
it('configSetCodes and legacyColumnsFromConfig on a multiset', () => {
  const { config } = validateTournamentConfig(multi({ EOLE: 3, CYCLONE: 4 }))
  expect(configSetCodes(config)).toEqual(['CYCLONE', 'EOLE'])
  expect(configSetCodes({ source: { type: 'multiset', sets: { FUGUE: 1, CORE: 6 } } })).toEqual(['CORE', 'FUGUE'])
  expect(legacyColumnsFromConfig(config).set_code).toBeNull()
})
```

- [ ] **Step 2: Run them to see them fail** — `npm test -- tournamentConfig` → the first three fail on `errors: ['source.type']`, the fourth on `configSetCodes` returning `[undefined]`.

- [ ] **Step 3: Implement** in `validateTournamentConfig`: a `src.type === 'multiset'` branch mirroring the `faction` one (visible sets only, `toInt` per code, `0 ≤ n ≤ SEALED_BOOSTERS`, zeros dropped, unknown key → bad, `Σ === SEALED_BOOSTERS`, at least one key; any problem → `errors.push('source.sets')`); when exactly one key is left, set `set = SETS.find(...)` and fall through to the `set` output. `configSetCodes`: `if (src.type === 'set') return [src.setCode]` then the existing sort over `Object.keys(src.sets)`. Keep `isFaction` logic untouched.

- [ ] **Step 4: Run the config tests and the goldens** — `npm test -- tournamentConfig poolBuilder.golden` → all pass, snapshot unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournamentConfig.js src/lib/tournamentConfig.test.js
git commit -m "Tournament config: multiset source, normalized to set when one set is left"
```

---

### Task 2: `uniques.randomOneIn`, the forced fields, the cap

**Files:**
- Modify: `src/lib/tournamentConfig.js`
- Test: `src/lib/tournamentConfig.test.js`

**Interfaces:**
- Produces: `MAX_RANDOM_ONE_IN = 10`, `DEFAULT_RANDOM_ONE_IN = 8`; normalized `uniques` is always `{ inBoosters, guaranteed, evenFactions, faction, randomOneIn }` with `randomOneIn: null | 1..10`; error codes `uniques.randomOneIn`, `uniques.inBoosters` (the multiset cap), `uniques.unsupportedSet` (now also for random mode); `configFromLegacyFormat(row).uniques.randomOneIn === null`.

Rules (spec §5.1, §13.2): `randomOneIn` absent/null → `null`; otherwise an integer 1–10 else `uniques.randomOneIn`. In random mode `inBoosters` is forced to `0` (client value not even range-checked), `evenFactions` to `false`; `guaranteed` and `faction` keep their rules. `wantsUniques = inBoosters > 0 || guaranteed > 0 || random`. `uniques.faction` is kept (or forced, faction source) when `inBoosters + guaranteed > 0 || random`. `evenFactions` is also forced `false` when the normalized source is `multiset`. Cap: a `multiset` (after normalization) in exact mode with `inBoosters > 3 × Σ counts of sets with hasFactionRanges` → `uniques.inBoosters`, checked only when at least one included set has ranges (otherwise `unsupportedSet` already covers it).

- [ ] **Step 1: Write the failing tests** — `describe('validateTournamentConfig randomOneIn')` (`valid` = the file's lot 1 valid config, `multi` from Task 1):

```js
it('accepts 1..10, coerces a string, forces inBoosters to 0 and evenFactions off', () => {
  const r = validateTournamentConfig({ ...valid, uniques: { inBoosters: 3, guaranteed: 1, evenFactions: true, randomOneIn: '8' } })
  expect(r.config.uniques).toEqual({ inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 8 })
  expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 1, guaranteed: 0, randomOneIn: null } }).config.uniques.randomOneIn).toBeNull()
})
it('refuses 0, 11, 2.5 and a non-number', () => {
  for (const randomOneIn of [0, 11, 2.5, 'x', true]) expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 0, guaranteed: 0, randomOneIn } }).errors).toEqual(['uniques.randomOneIn'])
})
it('keeps the uniques faction in random mode without any exact unique, forces it for a faction source', () => {
  expect(validateTournamentConfig({ ...valid, uniques: { inBoosters: 0, guaranteed: 0, randomOneIn: 8, faction: 'AX' } }).config.uniques.faction).toBe('AX')
  expect(validateTournamentConfig(factionCfg({ uniques: { inBoosters: 0, guaranteed: 0, randomOneIn: 4, faction: 'BR' } })).config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: 'AX', randomOneIn: 4 })
})
it('refuses random mode when no included set has unique data, accepts it next to one that has', () => {
  expect(validateTournamentConfig({ ...valid, source: { type: 'set', setCode: 'FUGUE' }, uniques: { inBoosters: 0, guaranteed: 0, randomOneIn: 8 } }).errors).toEqual(['uniques.unsupportedSet'])
  expect(validateTournamentConfig({ ...multi({ FUGUE: 7 }), uniques: { randomOneIn: 8 } }).errors).toEqual(['uniques.unsupportedSet'])
  expect(validateTournamentConfig({ ...multi({ CYCLONE: 1, FUGUE: 6 }), uniques: { randomOneIn: 8 } }).ok).toBe(true)
})
it('caps exact in-booster uniques at 3 per booster of the sets with unique data', () => {
  expect(validateTournamentConfig({ ...multi({ CYCLONE: 1, FUGUE: 6 }), uniques: { inBoosters: 4, guaranteed: 0 } }).errors).toEqual(['uniques.inBoosters'])
  expect(validateTournamentConfig({ ...multi({ CYCLONE: 1, FUGUE: 6 }), uniques: { inBoosters: 3, guaranteed: 7 } }).ok).toBe(true)
  expect(validateTournamentConfig({ ...multi({ CYCLONE: 1, FUGUE: 6 }), uniques: { inBoosters: 7, randomOneIn: 2 } }).ok).toBe(true) // ignored in random mode
})
it('forces even factions off for a multi-set split, keeps it for the normalized single set', () => {
  expect(validateTournamentConfig({ ...multi({ CYCLONE: 4, EOLE: 3 }), uniques: { inBoosters: 2, guaranteed: 0, evenFactions: true } }).config.uniques.evenFactions).toBe(false)
  expect(validateTournamentConfig({ ...multi({ CYCLONE: 7 }), uniques: { inBoosters: 2, guaranteed: 0, evenFactions: true } }).config.uniques.evenFactions).toBe(true)
})
```

- [ ] **Step 2: Update the existing expectations** in this file that `toEqual` a normalized `uniques` or the `configFromLegacyFormat` output (lines ~16–20, 56–60, 101, 132, 173): add `randomOneIn: null`.

- [ ] **Step 3: Run to see the new tests fail** — `npm test -- tournamentConfig`.

- [ ] **Step 4: Implement** the rules above in `validateTournamentConfig` and add `randomOneIn: null` to `configFromLegacyFormat`'s `uniques`. Export the two constants.

- [ ] **Step 5: Run** — `npm test -- tournamentConfig poolBuilder.golden` → pass, snapshot unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tournamentConfig.js src/lib/tournamentConfig.test.js
git commit -m "Tournament config: random uniques (one in N boosters), in-booster cap for a multi-set split"
```

---

### Task 3: Pack generator — multiset boosters and the shared slot helpers

**Files:**
- Modify: `src/lib/packGenerator.js`
- Test: `src/lib/packGenerator.test.js`

**Interfaces:**
- Produces (all exported):
  - `generateMultisetSealedPool(cardsBySet, rng, { counts, includeHeroes = true }) → string[][]` — for each set with `counts[code] > 0` and cards, in `SETS` order (unknown codes after, insertion order, like `generateFactionSealedPool`), `splitPools(cards, includeHeroes)` then `counts[code]` boosters via `generateOnePack(heroes, commons, rares, [], i, 0, rng)`; then `return shuffle(packs, rng)`.
  - `pickRareSlots(packs, eligibleIdx, n, rng, rareStart) → [packIdx, slotIdx][]` — positions `[p, rareStart + s]` for `p` of `eligibleIdx` in order, `s` in 0..2, `shuffle(positions, rng).slice(0, n)`. `swapUniquesIntoRareSlots` becomes `pickRareSlots(packs, packs.map((_, i) => i), uniqueRefs.length, rng, rareStart)` + the assignment loop (same list, same shuffle: byte-identical).
  - `rollBoosterHits(count, oneIn, rng) → boolean[]` — `rng() < 1 / oneIn` per booster, in order.
  - `pickWeightedSet(weights, rng) → string` — cumulative draw over the keys in `SETS` order (same `rank` sort as `quotas`), weights > 0 only; `rng() * total` against the running sum.
- Consumes: `shuffle`, `splitPools`, `generateOnePack` (existing, same file).

- [ ] **Step 1: Write the failing tests** (reuse the file's `card`/`makeCardPool` fixtures; a per-set pool is `makeCardPool()` whose refs are prefixed by the set: build `const bySet = code => makeCardPool().map(c => ({ ...c, reference: `ALT_${code}_B_${c.reference}` }))`):

```js
describe('generateMultisetSealedPool', () => {
  const sets = { CYCLONE: bySet('CYCLONE'), EOLE: bySet('EOLE'), FUGUE: bySet('FUGUE') }
  const byRef = new Map(Object.values(sets).flat().map(c => [c.reference, c]))
  const setOf = ref => ref.split('_')[1]
  it('deals the requested boosters per set, each set-pure, hero first, shuffled together', () => {
    const packs = generateMultisetSealedPool(sets, mulberry32(1), { counts: { CYCLONE: 4, EOLE: 3 } })
    expect(packs).toHaveLength(7)
    const tally = {}
    for (const p of packs) {
      expect(p).toHaveLength(13)
      expect(new Set(p).size).toBe(13)
      expect(new Set(p.map(setOf)).size).toBe(1)
      expect(byRef.get(p[0]).cardType).toBe('HERO')
      expect(p.slice(1, 10).every(r => byRef.get(r).rarity === 'C')).toBe(true)
      expect(p.slice(10).every(r => ['R1', 'R2'].includes(byRef.get(r).rarity))).toBe(true)
      tally[setOf(p[0])] = (tally[setOf(p[0])] ?? 0) + 1
    }
    expect(tally).toEqual({ CYCLONE: 4, EOLE: 3 })
    const orders = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(s => generateMultisetSealedPool(sets, mulberry32(s), { counts: { CYCLONE: 4, EOLE: 3 } }).map(p => setOf(p[0])).join())
    expect(orders.some(o => o !== 'CYCLONE,CYCLONE,CYCLONE,CYCLONE,EOLE,EOLE,EOLE')).toBe(true)
  })
  it('is deterministic for a seed, skips zero counts and sets without cards, deals 12 cards without heroes', () => {
    const a = generateMultisetSealedPool(sets, mulberry32(2), { counts: { CYCLONE: 3, EOLE: 0, FUGUE: 4 } })
    expect(a).toEqual(generateMultisetSealedPool(sets, mulberry32(2), { counts: { CYCLONE: 3, EOLE: 0, FUGUE: 4 } }))
    expect(a.map(p => setOf(p[0])).filter(s => s === 'EOLE')).toHaveLength(0)
    expect(generateMultisetSealedPool(sets, mulberry32(2), { counts: { CYCLONE: 3, NOPE: 4 } })).toHaveLength(3)
    expect(generateMultisetSealedPool(sets, mulberry32(2), { counts: { CYCLONE: 7 }, includeHeroes: false })[0]).toHaveLength(12)
  })
})
describe('pickRareSlots, rollBoosterHits, pickWeightedSet', () => {
  it('pickRareSlots only takes rare slots of the eligible packs, n distinct positions', () => {
    const packs = Array.from({ length: 4 }, () => Array(13).fill('x'))
    const chosen = pickRareSlots(packs, [0, 2], 4, mulberry32(1), 10)
    expect(chosen).toHaveLength(4)
    expect(new Set(chosen.map(([p, s]) => `${p}:${s}`)).size).toBe(4)
    for (const [p, s] of chosen) { expect([0, 2]).toContain(p); expect([10, 11, 12]).toContain(s) }
    expect(pickRareSlots(packs, [1], 5, mulberry32(1), 10)).toHaveLength(3)
  })
  it('rollBoosterHits: every booster at 1 in 1, none when the rng stays above 1/N', () => {
    expect(rollBoosterHits(7, 1, () => 0.999)).toEqual(Array(7).fill(true))
    expect(rollBoosterHits(7, 10, () => 0.5)).toEqual(Array(7).fill(false))
    expect(rollBoosterHits(3, 2, () => 0.49)).toEqual([true, true, true])
  })
  it('pickWeightedSet draws by weight in SETS order', () => {
    expect(pickWeightedSet({ EOLE: 1, CYCLONE: 6 }, () => 0.1)).toBe('CYCLONE')
    expect(pickWeightedSet({ EOLE: 1, CYCLONE: 6 }, () => 0.9)).toBe('EOLE')
    expect(pickWeightedSet({ EOLE: 1, CYCLONE: 0 }, () => 0.0)).toBe('EOLE')
  })
})
```

- [ ] **Step 2: Run to see them fail** — `npm test -- packGenerator`.

- [ ] **Step 3: Implement** the four functions; rewrite `swapUniquesIntoRareSlots` over `pickRareSlots`.

- [ ] **Step 4: Run** — `npm test -- packGenerator poolBuilder` (the goldens must be unchanged: `swapUniquesIntoRareSlots` is on their path).

- [ ] **Step 5: Commit**

```bash
git add src/lib/packGenerator.js src/lib/packGenerator.test.js
git commit -m "Pack generator: multi-set sealed boosters, eligible-only rare slots, booster rolls, weighted set draw"
```

---

### Task 4: Pool builder — `buildMultisetPool` (exact mode)

**Files:**
- Modify: `src/lib/poolBuilder.js`
- Test: `src/lib/poolBuilder.test.js`, `src/lib/poolBuilder.golden.test.js` (+ snapshot)

**Interfaces:**
- Consumes: Task 3's exports; `configSetCodes` (Task 1); `hasFactionRanges`, `pickDeterministicUniques`; `setCodeFromRef` from `src/lib/assets.js` (server-safe, already imported by `api/_lib/tournamentPool.js`).
- Produces: `buildPool` routes `source.type === 'multiset'` to `buildMultisetPool(sub, { config, nonce }, fetchCards)` (module-private like `buildFactionPool`); a module-private `uniqueGate(config) → { isAllowed, drawn }` where `isAllowed = ref => !drawn.has(ref) && (!config.excludeBanlist || !isBanned(ref))` and the caller adds every drawn ref to `drawn` — used by **every** `pickDeterministicUniques` call of the module from now on (the `set` and `faction` paths too: an always-true predicate consumes no extra rng, the goldens prove it).

Algorithm (spec §13.3): seed string via `legacyColumnsFromConfig` (`set_code` null); `rng` / `uRng` as the other branches; fetch each set once (`fetchCards(code)`, loop, never `.map(fetchCards)`), ban list per set; `boosters = generateMultisetSealedPool(cardsBySet, rng, { counts: config.source.sets, includeHeroes })`; `setOf = i => setCodeFromRef(boosters[i][0])`; `eligible = indices with hasFactionRanges(setOf(i))`; `positions = pickRareSlots(boosters, eligible, inBoosters, rng, boosters[0].length - 3)` grouped by `setOf(p)`; guaranteed: `guaranteed` times `pickWeightedSet(countsOfEligibleSets, uRng)`; then per eligible set in `SETS` order with a need: one `pickDeterministicUniques(code, uRng, { uniqueCount: inN + outN, faction: config.uniques.faction ?? null, isAllowed })`, throw `could only draw …` when short, first `inN` refs into that set's positions (position order), the rest appended outside; `cards` = booster refs + outside uniques + (heroes `free`) every `HERO` card of every included set once (lot 1 rule, per set).

- [ ] **Step 1: Write the failing tests** — `describe('buildPool multiset source')`, reusing the file's `fakeFactionSet(code)` or a `fakeSet(code)` with the set code in the refs (heroes, commons per faction, rares); `fetchCards = vi.fn(async code => fakeSet(code))`:

```js
const multiConfig = (over = {}) => ({ v: 1, format: 'sealed', source: { type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 }, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null }, excludeBanlist: false, ...over })
const setOf = ref => ref.split('_')[1]
it('is deterministic, fetches each set once with the code only', ...)   // same shape as the faction tests
it('deals the per-set boosters, set-pure, hero of their own set', async () => {
  const { boosters, cards } = await buildPool(SUB, { config: multiConfig(), nonce: 'n' }, { fetchCards })
  expect(boosters.map(b => setOf(b[0])).sort()).toEqual(['CYCLONE', 'CYCLONE', 'CYCLONE', 'CYCLONE', 'EOLE', 'EOLE', 'EOLE'])
  for (const b of boosters) { expect(b).toHaveLength(13); expect(new Set(b.map(setOf)).size).toBe(1) }
  expect(Object.values(cards).reduce((a, b) => a + b, 0)).toBe(91)
})
it('puts exact in-booster uniques in boosters of their own set, never in a set without data', async () => {
  const config = multiConfig({ source: { type: 'multiset', sets: { CYCLONE: 4, FUGUE: 3 }, boosters: 7 }, uniques: { inBoosters: 2, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: null } })
  const { boosters, cards } = await buildPool(SUB, { config, nonce: 'n' }, { fetchCards })
  const inBoosters = boosters.flatMap((b, i) => b.map((r, j) => ({ r, i, j }))).filter(x => x.r.includes('_U_'))
  expect(inBoosters).toHaveLength(2)
  for (const { r, i, j } of inBoosters) { expect(setOf(boosters[i][0])).toBe('CYCLONE'); expect(setOf(r)).toBe('CYCLONE'); expect(j).toBeGreaterThanOrEqual(10) }
  const outside = Object.keys(cards).filter(r => r.includes('_U_') && !boosters.flat().includes(r))
  expect(outside).toHaveLength(1)
  expect(setOf(outside[0])).toBe('CYCLONE')
  expect(new Set(Object.keys(cards).filter(r => r.includes('_U_'))).size).toBe(3)
})
it('appends every hero of every included set with heroes "free"', ...)  // 12-card boosters, hero refs of both sets in cards
it('applies the ban list set by set', ...)                               // as the faction test
it('throws when a set has no cards', ...)
```

- [ ] **Step 2: Add the golden** in `poolBuilder.golden.test.js`, `describe('multi-set pool (golden)')`: config `{ type: 'multiset', sets: { CORE: 4, EOLE: 3 }, boosters: 7 }`, uniques `{ inBoosters: 2, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: null }`, nonce `'n-multiset'`, the file's `fakeSet(code)`; `toMatchSnapshot()` on the sha256 as the others.

- [ ] **Step 3: Run to see them fail** — `npm test -- poolBuilder` (the multiset config falls into the `set` branch and throws on `setCode`).

- [ ] **Step 4: Implement** `buildMultisetPool`, `uniqueGate`, and switch the `set` / `faction` paths to the gate (collect their drawn refs).

- [ ] **Step 5: Run** — `npm test -- poolBuilder` → pass; the two older digests unchanged, one new snapshot written (`-u` is **not** needed: a new snapshot is written on first run; if vitest reports an obsolete or mismatched old snapshot, stop and find the rng leak).

- [ ] **Step 6: Commit**

```bash
git add src/lib/poolBuilder.js src/lib/poolBuilder.test.js src/lib/poolBuilder.golden.test.js src/lib/__snapshots__/poolBuilder.golden.test.js.snap
git commit -m "Pool builder: multi-set sealed pools, uniques of their booster's set, guaranteed by weighted draw"
```

---

### Task 5: Pool builder — random mode on every source

**Files:**
- Modify: `src/lib/poolBuilder.js`
- Test: `src/lib/poolBuilder.test.js`, `src/lib/poolBuilder.golden.test.js` (+ snapshot)

**Interfaces:**
- Produces: `placeRandomUniques(boosters, { rng, uRng, oneIn, setForHit, faction, isAllowed, onDrawn }) → string[]` (exported for tests): `hits = rollBoosterHits(boosters.length, oneIn, rng)`; for each hit `i`, `code = setForHit(i)` (null = dropped); group `i` by code; per code in `SETS` order one `pickDeterministicUniques(code, uRng, { uniqueCount, faction, isAllowed })` (throw when short); write each ref into `boosters[i][boosters[i].length - 1]` in hit order; `onDrawn(refs)` feeds the gate; returns the placed refs.
- Wiring, after each source's exact path (which, with `inBoosters` forced to 0, only drew the guaranteed uniques and swapped nothing): `set` → `setForHit = () => hasFactionRanges(setCode) ? setCode : null`; `multiset` → `i => hasFactionRanges(setOf(i)) ? setOf(i) : null`; `faction` → `() => pickWeightedSet(eligibleWeights, uRng)` with `eligibleWeights` = the source weights restricted to `hasFactionRanges` sets. The `set` path must keep its `uRng` in a variable (today it is built inline) so the random draws continue the same stream.

- [ ] **Step 1: Write the failing tests** — `describe('buildPool random uniques')`:

```js
it('placeRandomUniques: every eligible booster at 1 in 1, none above the threshold, data-less hits dropped', () => {
  const mk = () => [['ALT_CYCLONE_B_AX_1_C', ...Array(12).fill('ALT_CYCLONE_B_AX_2_C')], ['ALT_FUGUE_B_AX_1_C', ...Array(12).fill('ALT_FUGUE_B_AX_2_C')]]
  const gate = () => true
  const b = mk()
  const placed = placeRandomUniques(b, { rng: () => 0, uRng: mulberry32(1), oneIn: 8, setForHit: i => (setOf(b[i][0]) === 'CYCLONE' ? 'CYCLONE' : null), faction: null, isAllowed: gate, onDrawn: () => {} })
  expect(placed).toHaveLength(1)
  expect(b[0][12]).toMatch(/^ALT_CYCLONE_B_.*_U_\d+$/)
  expect(b[1][12]).toBe('ALT_FUGUE_B_AX_2_C')
  const c = mk()
  expect(placeRandomUniques(c, { rng: () => 0.9, uRng: mulberry32(1), oneIn: 8, setForHit: () => 'CYCLONE', faction: null, isAllowed: gate, onDrawn: () => {} })).toEqual([])
})
it('set source at 1 in 1: a unique in every booster\'s last slot, plus the guaranteed one, no serial twice', async () => {
  const cfg = config({ source: { type: 'set', setCode: 'EOLE', boosters: 7 }, uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 1 } })
  const { boosters, cards } = await buildPool(SUB, { config: cfg, nonce: 'n' }, { fetchCards: async () => fakeSet() })
  for (const b of boosters) { expect(b[12]).toMatch(/^ALT_EOLE_B_.*_U_\d+$/); expect(b.slice(0, 12).some(r => r.includes('_U_'))).toBe(false) }
  expect(Object.keys(cards).filter(r => r.includes('_U_'))).toHaveLength(8)
})
it('multiset at 1 in 1: only the boosters of sets with data get one, of their own set', async () => {
  const cfg = multiConfig({ source: { type: 'multiset', sets: { CYCLONE: 3, FUGUE: 4 }, boosters: 7 }, uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: 1 } })
  const { boosters } = await buildPool(SUB, { config: cfg, nonce: 'n' }, { fetchCards })
  const hits = boosters.filter(b => b[12].includes('_U_'))
  expect(hits).toHaveLength(3)
  for (const b of hits) { expect(setOf(b[0])).toBe('CYCLONE'); expect(setOf(b[12])).toBe('CYCLONE') }
})
it('faction source at 1 in 1: seven uniques from the range-capable sets, after the guaranteed ones', async () => {
  const cfg = factionConfig({ source: { type: 'faction', faction: 'AX', sets: { CORE: 1, FUGUE: 1 }, boosters: 7 }, uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: 'AX', randomOneIn: 1 } })
  const { boosters, cards } = await buildPool(SUB, { config: cfg, nonce: 'n' }, { fetchCards: async code => fakeFactionSet(code) })
  for (const b of boosters) expect(b[12]).toMatch(/^ALT_CORE_B_.*_U_\d+$/)
  expect(new Set(Object.keys(cards).filter(r => r.includes('_U_'))).size).toBe(8)
})
it('random mode leaves the exact draw of a set source untouched when randomOneIn is null', ...) // covered by the goldens; keep as a comment pointer
```

- [ ] **Step 2: Add three goldens** (`describe('random uniques (golden)')`): `set` EOLE `randomOneIn: 1, guaranteed: 1`, nonce `'n-random-set'`; `multiset` `{ CORE: 4, EOLE: 3 }`, `randomOneIn: 2`, nonce `'n-random-mix'`; `faction` AX `{ CORE: 1, EOLE: 2 }`, `randomOneIn: 1, guaranteed: 1`, nonce `'n-random-faction'`.

- [ ] **Step 3: Run to see them fail** — `npm test -- poolBuilder`.

- [ ] **Step 4: Implement** `placeRandomUniques` and the three wirings.

- [ ] **Step 5: Run** — `npm test -- poolBuilder` → pass; the three older digests (lot 1, V2, Task 4) unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/lib/poolBuilder.js src/lib/poolBuilder.test.js src/lib/poolBuilder.golden.test.js src/lib/__snapshots__/poolBuilder.golden.test.js.snap
git commit -m "Pool builder: random uniques, one booster in N, on every sealed source"
```

---

### Task 6: Server — `sourceType` in the pool response, integration tests

**Files:**
- Modify: `api/_lib/tournamentPool.js` (`poolResponse`)
- Test: `tests/integration/tournaments.test.js`

**Interfaces:**
- Produces: `poolResponse(...)` adds `sourceType: poolRow.config?.source?.type ?? 'set'`.
- The `buildPool` mock of the integration file derives its sets as `config.source.type === 'set' ? [config.source.setCode] : Object.keys(config.source.sets)`.

- [ ] **Step 1: Write the failing tests** — `describe('V3: multi-set sealed and random uniques')` using the file's `api(...)`/`mkTournament` helpers:

```js
it('POST stores a multiset split, normalizes a single set to a set source', ...)   // 201; config.source toEqual multiset {CYCLONE:4, EOLE:3}; a {CYCLONE:7} body → config.source.type 'set' in the response AND in `SELECT config->'source'->>'type'`
it('POST refuses each V3 problem with its code', ...)                               // Σ 6 → ['source.sets']; randomOneIn 11 → ['uniques.randomOneIn']; {CYCLONE:1, FUGUE:6} inBoosters 4 → ['uniques.inBoosters']; set FUGUE randomOneIn 8 → ['uniques.unsupportedSet']
it('POST in random mode forces inBoosters to 0 and even factions off', ...)        // uniques toEqual { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 8 }
it('PATCH normalizes a multiset config too', ...)
it('a multiset pool is stored with set_code NULL and reports sourceType multiset; a set pool reports set', ...) // GET /api/tournaments/:id/pool → body.sourceType; SELECT set_code IS NULL
it('BGA path on a multiset tournament creates the pool from its config', ...)       // mirrors the existing BGA-path test with FACTION_CONFIG
```

- [ ] **Step 2: Update** the mock and any existing `toEqual` on a normalized `uniques` (add `randomOneIn: null`).

- [ ] **Step 3: Run** — `npm run test:integration` (Docker up) → the new ones fail on `sourceType` / the mock.

- [ ] **Step 4: Implement** `sourceType` in `poolResponse`.

- [ ] **Step 5: Run** — `npm run test:integration` → pass.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/tournamentPool.js tests/integration/tournaments.test.js
git commit -m "Tournament pools: sourceType in the pool response, integration coverage of the V3 config"
```

---

### Task 7: Form issues for the split and the cap

**Files:**
- Modify: `src/lib/tournamentForm.js`
- Test: `src/lib/tournamentForm.test.js`

**Interfaces:**
- Produces: `tournamentFormIssues` maps `source.sets` → `{ field: 'sets', code: 'required' }` (unchanged) and lets `uniques.inBoosters` / `uniques.randomOneIn` reach `{ field: 'uniques', code }` through the existing `other` fallback. No signature change; the task pins the behaviour with tests.

- [ ] **Step 1: Write the failing tests**:

```js
it('reports a multiset split that does not reach 7 under the sets field', () => {
  const issues = tournamentFormIssues({ body, config: { ...config, source: { type: 'multiset', sets: { CYCLONE: 4 } } }, now: NOW, isCreate: true })
  expect(issues).toEqual([{ field: 'sets', code: 'required' }])
})
it('reports the in-booster cap under the uniques field', () => {
  const issues = tournamentFormIssues({ body, config: { source: { type: 'multiset', sets: { CYCLONE: 1, FUGUE: 6 } }, heroes: 'packs', uniques: { inBoosters: 4, guaranteed: 0 } }, now: NOW, isCreate: true })
  expect(issues).toEqual([{ field: 'uniques', code: 'uniques.inBoosters' }])
})
it('accepts a valid multiset split and random mode', () => {
  expect(tournamentFormIssues({ body, config: { source: { type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 } }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 1, randomOneIn: 8 } }, now: NOW, isCreate: true })).toEqual([])
})
```

- [ ] **Step 2: Run** — `npm test -- tournamentForm` → they pass already if Tasks 1–2 are right (the mapping is generic). If one fails, fix `tournamentForm.js`; either way keep the tests.

- [ ] **Step 3: Commit**

```bash
git add src/lib/tournamentForm.js src/lib/tournamentForm.test.js
git commit -m "Tournament form: issues for a multi-set split and the in-booster cap"
```

---

### Task 8: i18n keys (EN + FR)

**Files:**
- Modify: `src/lib/i18n/en.js`, `src/lib/i18n/fr.js` (the `tournaments` block)

Add, verbatim (EN / FR):

| Key | EN | FR |
| --- | --- | --- |
| `sourceSets` | `Sets` | `Extensions` |
| `cardsHint` (reworded) | `Each player receives 7 boosters. Pick a set, or mix several below.` | `Chaque joueur reçoit 7 boosters. Choisissez une extension, ou mélangez-en plusieurs ci-dessous.` |
| `mixSetsToggle` | `Mix several sets` | `Mélanger plusieurs extensions` |
| `mixSetsHint` | `Boosters of each set, 7 in total. Each booster holds only cards of its set.` | `Boosters de chaque extension, 7 au total. Chaque booster ne contient que des cartes de son extension.` |
| `mixSetsCounter` | `{{n}} / 7` | `{{n}} / 7` |
| `errBoostersTotal` | `The boosters must add up to 7 ({{n}} now).` | `Les boosters doivent faire 7 au total ({{n}} pour l’instant).` |
| `errUniquesTooMany` | `Too many uniques in boosters for the sets with unique data ({{n}} max).` | `Trop d’uniques dans les boosters pour les extensions avec données d’uniques ({{n}} max).` |
| `uniquesModeLabel` | `Uniques inside boosters` | `Uniques dans les boosters` |
| `uniquesModeExact` | `Exact number` | `Nombre exact` |
| `uniquesModeRandom` | `Random, like real packs` | `Aléatoire, comme de vrais boosters` |
| `randomOneInLabel` | `Chance of a unique per booster` | `Chance d’avoir une unique par booster` |
| `randomOneInText` | `1 booster in {{n}} ({{pct}} %)` | `1 booster sur {{n}} ({{pct}} %)` |
| `randomOneInEvery` | `every booster (100 %)` | `chaque booster (100 %)` |
| `randomOneInMin` | `1 in 10` | `1 sur 10` |
| `randomOneInMax` | `every booster` | `chaque booster` |
| `randomOneInHint` | `Each booster rolls on its own: a pool holds 0 to 7 uniques.` | `Chaque booster tire à part : un pool contient de 0 à 7 uniques.` |
| `uniquesPartialSupport` | `Boosters of Neverending Journey never hold a unique: no unique data yet.` | `Les boosters Neverending Journey n’ont jamais d’unique : pas encore de données d’uniques.` |
| `summaryUniquesRandom` | `1 unique in {{n}} boosters` | `1 unique pour {{n}} boosters` |
| `summaryUniquesEvery` | `a unique in every booster` | `une unique dans chaque booster` |

Remove `sourceOneSet` from both files (Task 9 stops using it).

- [ ] **Step 1: Add the keys** in both files, same order, next to the V2 keys (`sourceFactionMix`, `uniquesUnsupportedSets`, `summaryUniquesOutMany`).
- [ ] **Step 2: Verify** — `node -e "import('./src/lib/i18n/en.js').then(async en => { const fr = await import('./src/lib/i18n/fr.js'); const a = Object.keys(en.default.tournaments), b = Object.keys(fr.default.tournaments); console.log(a.filter(k => !b.includes(k)), b.filter(k => !a.includes(k))) })"` → `[] []` (adapt the default-export access to how the files export). `npm run build` still passes.
- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n/en.js src/lib/i18n/fr.js
git commit -m "i18n: multi-set sealed and random uniques strings (EN, FR)"
```

---

### Task 9: Cards section — the "Sets" tab with its disclosure

**Files:**
- Modify: `src/components/SetPresetGrid.jsx`, `src/components/SetWeightsList.jsx`, `src/components/TournamentCardsSource.jsx`

**Interfaces:**
- `SetPresetGrid({ selected, onSelect, disabled = false, counts = null })` — unchanged without `counts` (the Lobby). With `counts`: a set with `1 ≤ counts[code] ≤ 6` shows `<span data-testid={`set-badge-${code}`}>×{n}</span>` where the ✓ sits; `aria-pressed` and the ✓ stay driven by `selected`.
- `SetWeightsList({ weights, onChange, disabled = false, max = MAX_SET_WEIGHT, maxTotal = null, format = v => `×${v}`, trailing = 'share', testIdPrefix = 'set-weight' })` — `+` disabled when `maxTotal !== null && total >= maxTotal`; `trailing === 'share'` renders today's percentage column, `null` renders nothing; the row's test id is `${testIdPrefix}-${code}`.
- `TournamentCardsSource({ sourceType, onSourceType, setCounts, onSetCounts, faction, onFaction, weights, onWeights, mixOpen, onMixOpen, disabled = false })` — the `set` tab, labelled `t('tournaments.sourceSets')`: hint `cardsHint`; `SetPresetGrid selected={single} counts={setCounts} onSelect={code => onSetCounts(code ? { [code]: 7 } : {})}` where `single` = the only key of `setCounts` when its count is 7, else null; then a disclosure button (`type="button"`, `aria-expanded={mixOpen}`, `aria-controls="tn-set-mix"`, `data-testid="set-mix-toggle"`, text `mixSetsToggle`, plus the counter `<span data-testid="set-count-total">{t('tournaments.mixSetsCounter', { n: total })}</span>` in `text-ok` at 7 and `text-accent-ink` otherwise, shown when `mixOpen || Object.keys(setCounts).length > 1`); when open, `<div id="tn-set-mix">` with `mixSetsHint` and `SetWeightsList weights={setCounts} onChange={onSetCounts} max={7} maxTotal={7} format={v => String(v)} trailing={null} testIdPrefix="set-count"`. The faction tab is unchanged. `onSetCounts` always receives a map without zero entries (strip zeros in the `onChange` adapter).

- [ ] **Step 1: Implement** the three components as specified (no unit test layer for components in this repo; Task 13's e2e `@ms-a-grid`, `@ms-a-mix`, `@ms-a-switch` pin them).
- [ ] **Step 2: Check the Lobby is untouched** — `grep -n "SetPresetGrid\|SetWeightsList" src/pages/Lobby.jsx src/components/*.jsx` and confirm every other caller still compiles: `npm run build`.
- [ ] **Step 3: Commit**

```bash
git add src/components/SetPresetGrid.jsx src/components/SetWeightsList.jsx src/components/TournamentCardsSource.jsx
git commit -m "Tournament form: Sets tab with a per-set booster split behind a disclosure"
```

---

### Task 10: Form state and the uniques block (mode switch, slider)

**Files:**
- Modify: `src/pages/TournamentForm.jsx`, `src/components/TournamentUniqueFields.jsx`

**Interfaces:**
- Consumes: Task 9's props; Task 2's `DEFAULT_RANDOM_ONE_IN`, `MAX_RANDOM_ONE_IN`; Task 8's keys.
- `TournamentUniqueFields({ uniques, onChange, uniqueSupport = true, partialSupport = false, disabled = false, factionSource = false, fixedFaction = null, multiSet = false, lastOneIn = DEFAULT_RANDOM_ONE_IN, onLastOneIn })`:
  - mode radiogroup (`role="radiogroup"`, `aria-label={t('tournaments.uniquesModeLabel')}`, two `role="radio"` buttons `uniquesModeExact` / `uniquesModeRandom`, test ids `uniques-mode-exact` / `uniques-mode-random`, same look as the source switch). `random = uniques.randomOneIn != null`. Exact → `set({ randomOneIn: null })` after `onLastOneIn(uniques.randomOneIn)`; Random → `set({ randomOneIn: lastOneIn, evenFactions: false })`.
  - exact: today's in-booster stepper (`uniques-in-boosters`), its `max` = `Math.min(MAX_UNIQUES, maxInBoosters)` (new prop `maxInBoosters`, `Infinity` when every chosen set has data) so "+" greys out at the cap; a value that became too high after the sets changed is reported by the live issue, never clamped silently. random: label `randomOneInLabel`, `<input type="range" min={1} max={MAX_RANDOM_ONE_IN} step={1} value={uniques.randomOneIn} data-testid="random-one-in" style={{ direction: 'rtl' }} className="accent-accent w-full" aria-valuetext={text}>` between two captions `randomOneInMin` (left) and `randomOneInMax` (right); live text `<span data-testid="random-one-in-text">` = `n === 1 ? t('randomOneInEvery') : t('randomOneInText', { n, pct: Math.round(1000 / n) / 10 })`; hint `randomOneInHint`.
  - the guaranteed stepper and the faction chips in both modes; chips enabled when `total > 0 || random` (`set` keeps `faction` null only when `nextTotal === 0 && !random`); the even-factions checkbox only when `!random && !multiSet && !factionSource` (plus today's `total ≥ 2 && !faction`); `partialSupport` renders `<p className="text-xs text-accent-ink">{t('tournaments.uniquesPartialSupport')}</p>` under the title; `uniqueSupport === false` keeps today's behaviour and also forces exact mode in the config (the form sends `randomOneIn: null` then).
- `TournamentForm.jsx`:
  - state: `setCounts` (`{}`) replaces `setCode`; `mixOpen` (false); `uniques` gains `randomOneIn: null`; `lastOneIn` (`DEFAULT_RANDOM_ONE_IN`).
  - derived: `chosen = Object.keys(setCounts)`, `uniqueSupport = isFaction ? (today) : (!chosen.length || chosen.some(hasFactionRanges))`, `partialSupport = !isFaction && chosen.some(hasFactionRanges) && chosen.some(c => !hasFactionRanges(c))`, `multiSet = !isFaction && chosen.length > 1`, `boosterTotal = Σ setCounts`, `maxInBoosters = 3 × Σ counts of chosen sets with ranges`.
  - config: `source: isFaction ? { type: 'faction', ... } : { type: 'multiset', sets: setCounts, boosters: 7 }`; `uniques: !uniqueSupport ? { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null } : isFaction ? { ...uniques, faction, evenFactions: false } : uniques`.
  - `issueMessage(issue, t, { isFaction, boosterTotal, maxInBoosters })`: `sets` → `isFaction ? errSelectSets : boosterTotal === 0 ? errSelectSet : errBoostersTotal { n: boosterTotal }`; `uniques` + `uniques.inBoosters` → `errUniquesTooMany { n: maxInBoosters }`; the rest as today. Update the three call sites (`ErrorLine`, `issuesText`, the 400 handler).
  - draft: write `setCounts`, `mixOpen`, `lastOneIn`; `applyDraft` reads them (`d.setCounts`, else an old `d.setCode` → `{ [d.setCode]: 7 }`).
  - edit prefill: `src.type === 'multiset'` → `setSetCounts(src.sets); setMixOpen(true)`; `'set'` → `{ [src.setCode]: 7 }`; `faction` as today; `setUniques({ randomOneIn: null, ...tn.config.uniques })` (older rows lack the key), still stripping `faction`/`evenFactions` for a faction source; when the stored config is in random mode, put `inBoosters: 1` (the creation default) in the form state so switching back to exact does not show 0; `setLastOneIn(tn.config.uniques.randomOneIn ?? DEFAULT_RANDOM_ONE_IN)`.
  - imposed legacy: `setSetCounts({ [c.source.setCode]: 7 })`.
  - `setWeightsFrom` and the faction state are unchanged.

- [ ] **Step 1: Implement** both files.
- [ ] **Step 2: Smoke it by hand** — `make dev`, `/tournament/new`: pick Skybound Odyssey → "7 / 7" hidden, ✓; open "Mix several sets" → steppers, badges, counter; Settings → Random → slider at 1 in 8, "12.5 %"; create → the tournament page shows the summary (Task 11 makes it right; until then the set part may read oddly). Check the console is clean.
- [ ] **Step 3: Verify** — `npm run build`, `npm test`.
- [ ] **Step 4: Commit**

```bash
git add src/pages/TournamentForm.jsx src/components/TournamentUniqueFields.jsx
git commit -m "Tournament form: per-set booster counts, exact or random uniques with a one-in-N slider"
```

---

### Task 11: Summary line and the booster cover per set

**Files:**
- Modify: `src/components/TournamentBits.jsx`, `src/components/PackReveal.jsx`, `src/components/TournamentPoolView.jsx`
- Test: `src/components/TournamentBits.test.js`

**Interfaces:**
- `configSummaryParts(config, t, tc)`: a `multiset` source gives `[{ text: t('summaryBoostersCount', { n: 7 }) }, { text: setsText }]` with `setsText` = the sets with a count, `SETS` order, `SET_ABBREV` + ` ×n` when `n > 1`, joined by `, `; then `u.randomOneIn` → one part `u.randomOneIn === 1 ? t('summaryUniquesEvery') : t('summaryUniquesRandom', { n })` **instead of** the in-booster part; the guaranteed, faction (non-faction sources), even (only when `!u.randomOneIn`), heroes and ban-list parts as today.
- `PackReveal({ packs, hasBonus, sourceType = 'set', cardMap, ... })` (drop `noCover`): `coverImage = isBonusPack || sourceType === 'faction' ? null : boosterCoverFor(singleSetOf(currentPack), lang)` with `singleSetOf(refs)` = the one `setCodeFromRef` of every ref, else `null` (`boosterCoverFor(null)` returns null).
- `TournamentPoolView`: drop `mixedSets`, pass `sourceType={pool.sourceType ?? 'set'}`.

- [ ] **Step 1: Write the failing tests** in `TournamentBits.test.js`:

```js
const multi = (sets, uniques = {}) => ({ v: 1, format: 'sealed', source: { type: 'multiset', sets, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null, ...uniques }, excludeBanlist: false })
it('lists a multi-set split by abbreviation with ×n above 1', () => {
  const parts = configSummaryParts(multi({ EOLE: 3, CYCLONE: 3, FUGUE: 1 }), t, tc)
  expect(parts[0]).toEqual({ text: 'tournaments.summaryBoostersCount {"n":7}' })
  expect(parts[1]).toEqual({ text: 'SKY ×3, ROC ×3, NEJ' })
})
it('says one unique in N boosters in random mode, every booster at 1, and drops the even part', () => {
  expect(configSummaryParts(multi({ CYCLONE: 7 }, { randomOneIn: 8, guaranteed: 1, evenFactions: true }), t, tc).map(p => p.text))
    .toEqual(['tournaments.summaryBoostersCount {"n":7}', 'SKY ×7', 'tournaments.summaryUniquesRandom {"n":8}', 'tournaments.summaryUniquesOut 1'])
  expect(configSummaryParts({ source: { type: 'set', setCode: 'CYCLONE', boosters: 7 }, uniques: { randomOneIn: 1 }, heroes: 'packs' }, t, tc).map(p => p.text))
    .toEqual(['tournaments.summaryBoosters {"n":7,"set":"Skybound Odyssey"}', 'tournaments.summaryUniquesEvery'])
})
```

- [ ] **Step 2: Run** — `npm test -- TournamentBits` → fail.
- [ ] **Step 3: Implement** the three components.
- [ ] **Step 4: Run** — `npm test -- TournamentBits`, `npm run build`; then `make e2e -- --grep "@mf-c-pool"` (or `npx playwright test -c tests/e2e/playwright.config.js --grep @mf-c-pool` with the stack up): the mono-faction reveal still shows no cover.
- [ ] **Step 5: Commit**

```bash
git add src/components/TournamentBits.jsx src/components/TournamentBits.test.js src/components/PackReveal.jsx src/components/TournamentPoolView.jsx
git commit -m "Tournaments: multi-set and random-uniques summary, booster cover per set-pure booster"
```

---

### Task 12: The V3 recette page

**Files:**
- Create: `docs/tournaments/acceptance-multiset-sealed.html` (copy `acceptance-mono-faction-sealed.html`, keep its CSS/JS shell, replace the hero text, `GROUPS`, `AUTO_STEPS = []`, `AUTO_PARTIAL = {}`, the storage key and the recap title)
- Modify: `scripts/e2e-acceptance-coverage.mjs` (`ACCEPTANCE_PAGES` += the new page)

Title "Multi-set sealed and random uniques — V3". BGA ids 123490 (the mix), 123491 (random, one set), 123492 (random, mix), 123493 (random, mono-faction), 123494 (API guards), 123495 (normalization), 123496 (draft), 123497 (issues), 123498 (cap). The tournament of groups B–D is **"SKY ROC NEJ mix"**: Skybound Odyssey ×3, Roots of Corruption ×3, Neverending Journey ×1, heroes in packs, uniques exact 2 in boosters / 1 guaranteed, all factions.

Groups and step ids (titles are indicative; every step carries its full commands, expected outputs and the psql lines on the `DB` helper like V2):

| Group | Steps |
| --- | --- |
| 0 Setup | `ms-0-lot1`, `ms-0-branch` (`git switch feat/multiset-sealed`), `ms-0-dev` (no migration: `set_code` already nullable, just `make dev`), `ms-0-tests` (`npm test && npm run test:integration`), `ms-0-e2e` (`make e2e && npm run test:e2e:coverage`, three pages listed), `ms-0-clean` (ids 123490–123498) |
| A Form: the Sets tab | `ms-a-grid` (tab "Sets" selected, hint, one click = ✓ and no counter, second click = none), `ms-a-mix` (disclosure closed by default; open: 7 steppers at 0, "0 / 7"; tile click → 7 and "+" greyed; − ×3 on SKY → "4 / 7" and the ×4 badge; + ×3 on ROC → "7 / 7"), `ms-a-issues` (SKY 4 only → "The boosters must add up to 7 (4 now)." in the bar, button greyed; ROC +3 → bar empty; all 0 → "Choose a set."), `ms-a-switch` (Sets ↔ Mono-faction mix keeps each tab's state), `ms-a-draft` (the reconnect flow of V2's `mf-a-draft` with SKY 3 / ROC 3 / NEJ 1 and random 1 in 4 kept) |
| B Create | `ms-b-create` (stored config through the `?bgaId=123490` curl, printed with a fixed key list including `randomOneIn`), `ms-b-summary` ("7 boosters · SKY ×3, ROC ×3, NEJ · 2 uniques in boosters · 1 guaranteed unique", menu card, 375 px) |
| C The pool | `ms-c-reveal` (the ROC boosters open on the Roots of Corruption pack photo, SKY and NEJ go straight to the cards, the 8th is the guaranteed unique), `ms-c-boosters` (psql: `set_code` null, 7 boosters of 13, per-set counts of slot 1 = SKY 3 / ROC 3 / NEJ 1, every booster set-pure: `count(DISTINCT split_part(ref,'_',2)) = 1` per booster), `ms-c-heroes` (slot 1 is a hero of the booster's set), `ms-c-deck` (pool page grouped by set: 3 groups; a deck saves and syncs like lot 1) |
| D Exact uniques in a multi-set | `ms-d-in-boosters` (psql: 2 `_U_` refs in rare slots, each in a SKY or ROC booster and of that booster's set; none in the NEJ booster), `ms-d-guaranteed` (1 ref outside the boosters, SKY or ROC), `ms-d-cap` (form: SKY ×1, NEJ ×6, uniques 4 in boosters → "Too many uniques in boosters for the sets with unique data (3 max)."; 3 → ok; do not create) |
| E Random uniques | `ms-e-form` (switch, slider 1 in 10 → every booster, "1 booster in 8 (12.5 %)" default, stepper hidden, even factions hidden, guaranteed and faction chips still there, back to exact restores the count), `ms-e-set` (create "Random SKY", id 123491, one set, 1 in 1, guaranteed 1 → psql: the last slot of every booster is `_U_`, 8 uniques), `ms-e-mix` (id 123492, SKY 3 / ROC 3 / NEJ 1, 1 in 1, guaranteed 0 → 6 uniques, none in the NEJ booster, each of its booster's set), `ms-e-faction` (id 123493, Axiom mono-faction over all sets, 1 in 1 → 7 uniques, all Axiom through the cards API, none from NEJ), `ms-e-summary` ("1 unique in 4 boosters" / "a unique in every booster") |
| F API | `ms-f-api` (curl refusals: Σ 6, 8 in one set, COREKS, randomOneIn 0 and 11, FUGUE + random, the cap), `ms-f-normalize` (POST `{ CYCLONE: 7 }` → stored `type: set`; id 123495) |
| G BGA | `ms-g-bga` (the lot 1 G-group curl on 123490 as carol: a "Random SKY ROC NEJ mix" deck taken from a multiset pool) |
| H Edit | `ms-h-locked` (edit with a pool: disclosure open, steppers 3/3/1 greyed, grid and mode switch greyed), `ms-h-unlocked` (edit before any pool: change the split, save, summary follows) |
| I Cross-cutting | `ms-i-fr`, `ms-i-theme`, `ms-i-mobile`, `ms-i-console` |
| K Before production | `ms-k-preprod` (create the three E tournaments on preprod and check one pool each) |

- [ ] **Step 1: Write the page** (new steps unchecked, V2 conventions, commands checked with `zsh -n` on each `pre(...)` block: extract them with `node -e` or review by hand).
- [ ] **Step 2: Register it** in `ACCEPTANCE_PAGES`; run `npm run test:e2e:coverage` → the new page lists every id under "no tag" and no id is declared twice.
- [ ] **Step 3: Commit**

```bash
git add docs/tournaments/acceptance-multiset-sealed.html scripts/e2e-acceptance-coverage.mjs
git commit -m "Acceptance: multi-set sealed and random uniques recette page (V3)"
```

---

### Task 13: Playwright replay

**Files:**
- Create: `tests/e2e/specs/multiset-sealed.spec.js`
- Modify: `tests/e2e/support/api.js` (`multisetTournamentBody`), `tests/e2e/specs/faction-sealed.spec.js` (`sourceOneSet` → `sourceSets`, lines ~75, 108, 338; `randomOneIn: null` at ~265, 302; `factionTournamentBody` keeps working), `tests/e2e/specs/unique-faction.spec.js` (~90, 159), `tests/e2e/specs/tournament-create.spec.js` (~186), `docs/tournaments/acceptance-multiset-sealed.html` (`AUTO_STEPS`, `AUTO_PARTIAL`), `docs/tournaments/acceptance-mono-faction-sealed.html` (the V2 page quotes the tab as “One set” in `mf-a-switch`, `mf-a-hints` and `mf-g-imposed`: replace the label by “Sets” **and rename those three ids** to `mf-a-switch-r2`, `mf-a-hints-r2`, `mf-g-imposed-r2` so they show up unchecked again — recette versioning rule; retag the `@mf-a-switch` test accordingly and update `AUTO_STEPS` / `AUTO_PARTIAL` of that page through the coverage script)

**Interfaces:**
- `multisetTournamentBody(overrides = {})` → `tournamentBody({ name: 'SKY ROC NEJ mix', bgaUrl: 'https://boardgamearena.com/tournament?id=123490', config: { source: { type: 'multiset', sets: { CYCLONE: 3, EOLE: 3, FUGUE: 1 } }, heroes: 'packs', uniques: { inBoosters: 2, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: null }, excludeBanlist: false }, ...overrides })`.
- Locators (same style as `faction-sealed.spec.js`): `sourceRadio(page, 'sourceSets')`, `page.getByRole('button', { name: 'Skybound Odyssey' })` (the tile), `page.getByTestId('set-mix-toggle')`, `page.getByTestId('set-count-CYCLONE')` + its `+`/`−` buttons, `page.getByTestId('set-count-total')`, `page.getByTestId('set-badge-CYCLONE')`, `page.getByTestId('uniques-mode-random')`, `page.getByTestId('random-one-in')` (`fill('1')` sets a range input), `page.getByTestId('random-one-in-text')`.

Tests (one per tag; assertions follow the recette step; stored pools are read with V2's `storedPool` helper):

- `@ms-a-grid`: the Sets tab is checked by default and reads `t('tournaments.sourceSets')`; tile click → `aria-pressed=true`, no badge, no `set-count-total`; click again → none pressed; `set-mix-toggle` has `aria-expanded=false` and no `set-count-*` is visible.
- `@ms-a-mix`: open the disclosure → 7 `set-count-<CODE>` steppers (no COREKS) all `0`, total `0 / 7`; tile SKY → stepper `7`, total `7 / 7`, every `+` disabled; `−` ×3 on SKY → `4 / 7`, badge `set-badge-CYCLONE` = `×4`, SKY not pressed; `+` ×3 on ROC → `7 / 7`, badge ROC `×3`; tile NEJ → NEJ `7`, SKY and ROC `0`, badges gone, NEJ pressed.
- `@ms-a-issues`: name + link 123497, SKY at 4 → problems contain `t('tournaments.errBoostersTotal', { n: 4 })`, submit disabled; ROC +3 → problems empty, enabled; everything to 0 → `t('tournaments.errSelectSet')`.
- `@ms-a-switch`: SKY 4 / ROC 3, switch to the faction tab and back → counts kept; the faction tab's weights untouched.
- `@ms-b-create`: fill SKY 3 / ROC 3 / NEJ 1, uniques 2 / 1, create; `GET /api/tournaments/:id` config `toEqual` the normalized multiset config (with `randomOneIn: null`); summary text = `7 boosters · SKY ×3, ROC ×3, NEJ · 2 uniques in boosters · 1 guaranteed unique` built from the `t`/`tc` keys.
- `@ms-c-reveal` (partial: the photo itself stays a human check): seed the mix, open the pool from the tournament page; for booster n = 1..7 compare with the stored `boosters[n-1]`: a ROC booster shows `img[src*="/boosters/EOLE"]` or the `cardZoom.openBooster` button, a SKY or NEJ booster shows neither; the 8th shows `packReveal.guaranteedUnique`.
- `@ms-c-boosters`: stored pool: `set_code` null, 7 × 13, `countBySet(boosters.map(b => b[0]))` = `{ CYCLONE: 3, EOLE: 3, FUGUE: 1 }`, each booster set-pure, slot 0 a HERO of that set, slots 1–9 COMMON, 10–12 non-COMMON or unique, no duplicate ref in a booster.
- `@ms-d-in-boosters` + `@ms-d-guaranteed` (one test, two tags): exactly 2 `_U_` refs inside boosters, each at slot ≥ 10 of a booster whose set is CYCLONE or EOLE and matches the ref's set; 1 unique ref outside, set CYCLONE or EOLE; 3 distinct unique refs.
- `@ms-d-cap`: form SKY 1 / NEJ 6, in-boosters 4 → problems contain `t('tournaments.errUniquesTooMany', { n: 3 })`; `−` once → gone.
- `@ms-e-form`: default `uniques-mode-exact` checked; click random → `uniques-in-boosters` count 0, `random-one-in` value `8`, text `t('tournaments.randomOneInText', { n: 8, pct: 12.5 })`, `#even-factions` count 0, `uniques-guaranteed` visible, faction chips enabled; `fill('1')` → `t('tournaments.randomOneInEvery')`; back to exact → stepper back at `1`, slider gone; create with random 4 (id 123496) → `uniques` `toEqual({ inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 4 })`, summary contains `t('tournaments.summaryUniquesRandom', { n: 4 })`.
- `@ms-e-set`: seed `tournamentBody({ bgaUrl: …123491, config: { source: { type: 'set', setCode: 'CYCLONE' }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 1, randomOneIn: 1 } } })`, pool: every `boosters[i][12]` is `_U_` of CYCLONE, 8 distinct unique refs.
- `@ms-e-mix`: seed the mix with `uniques: { inBoosters: 0, guaranteed: 0, randomOneIn: 1 }` (id 123492): 6 boosters end with a `_U_` of their own set, the FUGUE booster does not.
- `@ms-e-faction`: seed `factionTournamentBody({ bgaUrl: …123493, config: { ...factionTournamentBody().config, uniques: { inBoosters: 0, guaranteed: 1, randomOneIn: 1 } } })`: 7 boosters end with `_U_`, every unique ref matches `/^ALT_(CYCLONE|EOLE)_B_/`, 8 distinct; the first one's `faction.code` is `AX` through the fakes' cards API (as `mf-c-pool` does).
- `@ms-f-api` + `@ms-f-normalize`: `POST /api/tournaments` cases → 400 with `config` `['source.sets']` (Σ 6; 8 in one set; COREKS), `['uniques.randomOneIn']` (0; 11), `['uniques.unsupportedSet']` (FUGUE + random 8), `['uniques.inBoosters']` ({ CYCLONE: 1, FUGUE: 6 }, inBoosters 4); `{ CYCLONE: 7 }` → 201 with `config.source` `toEqual({ type: 'set', setCode: 'CYCLONE', boosters: 7 })`, then DELETE.
- `@ms-g-bga`: as `mf-f-bga` on the mix (carol's BGA deck list → a `Random SKY ROC NEJ mix` deck from a pool with `set_code` null).
- `@ms-h-locked`: seed the mix + bob's pool; alice's edit page: `set-mix-toggle` `aria-expanded=true`, steppers `3 / 3 / 1` with every button disabled, tiles disabled, `uniques-mode-*` disabled, name still editable.
- `@ms-i-mobile` (`@mobile`, partial): 375 px form with the disclosure open → no horizontal scroll, stepper and total on one line; the Settings block in random mode → slider visible, no horizontal scroll; the pool page.

- [ ] **Step 1: Write the helper and the spec**; update the three older specs.
- [ ] **Step 2: Run** — `make e2e` → everything passes (lot 1 and V2 included). A step the app does not meet goes in as `test.fixme` with its tag and is listed in the PR, never silently fixed.
- [ ] **Step 3: Coverage** — `npm run test:e2e:coverage -- --write` rewrites the three `AUTO_STEPS` lines; add the `AUTO_PARTIAL` notes for `ms-c-reveal` and `ms-i-mobile` by hand; re-run without `--write` → exit 0.
- [ ] **Step 4: Commit**

```bash
git add tests/e2e/specs/multiset-sealed.spec.js tests/e2e/support/api.js tests/e2e/specs/faction-sealed.spec.js tests/e2e/specs/unique-faction.spec.js tests/e2e/specs/tournament-create.spec.js docs/tournaments/acceptance-multiset-sealed.html
git commit -m "E2E: multi-set sealed and random uniques acceptance steps"
```

---

### Task 14: Docs and the final verification

**Files:**
- Modify: `docs/tournaments/README.md` (new §14.7 "Multi-set sealed and random uniques (V3)" after §14.6, same structure: Format, Config, Generation, Uniques, Data and server, UI, Recette, Merge; update §4.2's "Details that matter" with the random roll and the multiset unique placement; §14.6's "UI" sentence now names the tab "Sets" and its "Recette" sentence says three pages), `docs/tournaments/index.html` (the same §14.7 rendered, the §1 overview sentence that lists the sources, the lot paragraph before §14.1), `CLAUDE.md` (a **Multi-set sealed + random uniques (V3)** sentence after the V2 one: config shape, normalization, `buildMultisetPool`, `placeRandomUniques`, the rng contract, the third acceptance page), `docs/tournaments/user-tournaments-spec.md` (re-read §13 against what was built; fix any drift)

- [ ] **Step 1: Write the docs** (README and index.html together, same wording).
- [ ] **Step 2: Full verification** — `npm run build && npm test && npm run test:integration && make e2e && npm run test:e2e:coverage` → all green; paste the four summary lines in the PR description.
- [ ] **Step 3: Commit**

```bash
git add docs/tournaments/README.md docs/tournaments/index.html CLAUDE.md docs/tournaments/user-tournaments-spec.md
git commit -m "Docs: multi-set sealed and random uniques (V3)"
```

- [ ] **Step 4: Draft PR** — push `feat/multiset-sealed` and open a **draft** PR based on `feat/mono-faction-sealed` (English; the "Why", the decisions of spec §13.2, the test counts, the merge plan: retarget `main` after #25, run group K of the V3 recette on preprod). Do not merge.

---

## Self-review (done while writing; kept for the executor)

- **Spec coverage:** §13.2 config → Tasks 1–2; normalization → Task 1; boosters, heroes, dedup, shuffle → Tasks 3–4; in-booster exact / guaranteed weighted / cap → Tasks 2, 4; random mode and its set rules → Task 5; unsupported / partial support → Tasks 2, 10; even factions forcing → Tasks 2, 10; determinism and goldens → Tasks 3–5; data (no schema change) → none needed; pool page cover and `sourceType` → Tasks 6, 11; summary → Task 11; form Cards / Settings → Tasks 9–10; recette → Task 12; tests → Tasks 1–7, 13; docs → Task 14. §13.6's builder choices are left open on purpose.
- **Review Focus:** 1 → Task 1 (`normalizes a multiset left with one set`); 2 → Tasks 2 (`accepts it next to one that has`), 5 (`data-less hits dropped`), 13 (`@ms-e-mix`); 3 → Tasks 2 (cap), 7, 13 (`@ms-d-cap`); 4 → Tasks 4 (`3 distinct`), 5 (`no serial twice`); 5 → Tasks 11, 13 (`@ms-c-reveal`, `@mf-c-pool` re-run).
- **Names used across tasks:** `generateMultisetSealedPool`, `pickRareSlots`, `rollBoosterHits`, `pickWeightedSet` (Task 3) consumed by Tasks 4–5; `placeRandomUniques` (Task 5) tested in Task 5 only; `poolResponse.sourceType` (Task 6) consumed by Task 11; `setCounts` / `mixOpen` / `lastOneIn` (Task 10) feed Task 9's props; `sourceSets` and the other keys (Task 8) used by Tasks 9–11 and 13; `DEFAULT_RANDOM_ONE_IN` / `MAX_RANDOM_ONE_IN` (Task 2) used by Task 10.
- **Proportion:** signatures, assertions and commands only; no function body except the rng order, which the goldens pin.
- **Builder check (2026-11-01, fresh reviewer on spec §13):** nothing blocking. Its four low-stakes calls, settled here: `randomOneIn` always present in the normalized config (Task 2); the in-booster cap both greys out the stepper and keeps the live message (Task 10); an edited random-mode tournament shows `1` when switched back to exact (Task 10); the V2 recette steps that quote “One set” are reworded and re-id'd (Task 13).
