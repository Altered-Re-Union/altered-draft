#!/usr/bin/env node
// One-shot (idempotent): swaps the banned cards out of the STORED pools of the open
// declared tournaments that tick the ban list (`config.excludeBanlist`). A card added to
// src/lib/banlist.js only keeps it out of the pools generated afterwards; the pools
// already stored keep it (they are never regenerated), so this script fixes them.
//
// Each banned card becomes one random card of the SAME set, the SAME rarity group
// (common → common, R1/R2 → R1 or R2) and the SAME real faction (the card object's
// `mainFaction`, so an R2 is replaced by a rare of its out-of-faction faction), never a
// hero, never another banned card. "Banned" = the ban-list version of the pool's
// tournament (banlist.js `banlistVersionOf`), so the replacement follows the same rules
// as the tournament's other pools. It takes the banned card's place in its booster, and
// `cards` is recounted. The draw is seeded by the pool id and the slot, so the dry run
// prints exactly what --apply writes and a re-run is reproducible.
//
// Decks already saved on decks-api are NOT touched: the script lists the affected pools
// that have a deck, so their players can be told to check it.
//
// Dry run by default (nothing written), --apply to write:
//   docker exec altered-draft node scripts/replace-banned-cards.mjs            (deployed, AlteredOps)
//   docker exec altered-draft node scripts/replace-banned-cards.mjs --apply
//   make db-replace-banned-cards [ARGS=--apply]                                 (local dev)
import { fileURLToPath } from 'node:url'
import { query, getPool } from '../src/lib/db.js'
import { fetchSet } from '../src/lib/cardData.js'
import { isBanned, banlistVersionOf } from '../src/lib/banlist.js'
import { seededRng } from '../src/lib/prng.js'
import { setCodeFromRef } from '../src/lib/assets.js'

const RARE = new Set(['R1', 'R2'])
const rarityGroup = rarity => (rarity === 'C' ? 'C' : RARE.has(rarity) ? 'R' : null)

/** Replacement candidates for a banned card object, sorted by reference (stable draws). */
function candidatesFor(card, setCards, banned) {
  const group = rarityGroup(card.rarity)
  if (!group) return []
  return setCards
    .filter(c => c.cardType !== 'HERO' && c.cardType !== 'TOKEN'
      && c.faction === card.faction && rarityGroup(c.rarity) === group && !banned(c.reference))
    .sort((a, b) => (a.reference < b.reference ? -1 : a.reference > b.reference ? 1 : 0))
}

/**
 * Pure: the pool with its banned cards replaced.
 * @param {{ id: string, cards: Record<string, number>, boosters: string[][] }} pool
 * @param {Record<string, object[]>} cardsBySet - normalized cards of every set a banned ref belongs to
 * @returns {{ cards, boosters, replacements: {from, to, booster, slot}[], unresolved: {from, reason}[] }}
 *   booster/slot are null for a copy held outside the boosters.
 */
export function planReplacements(pool, cardsBySet, { banned = isBanned } = {}) {
  const boosters = (pool.boosters ?? []).map(b => [...b])
  const cards = { ...(pool.cards ?? {}) }
  const replacements = []
  const unresolved = []

  const draw = (from, seed) => {
    const set = setCodeFromRef(from)
    const setCards = cardsBySet[set] ?? []
    const card = setCards.find(c => c.reference === from)
    if (!card) { unresolved.push({ from, reason: `not found in the ${set} card data` }); return null }
    const options = candidatesFor(card, setCards, banned)
    if (!options.length) { unresolved.push({ from, reason: `no replacement for rarity ${card.rarity} / faction ${card.faction}` }); return null }
    return options[Math.floor(seededRng(`banfix:${pool.id}:${seed}`)() * options.length)].reference
  }
  const swap = (from, to) => {
    cards[from] -= 1
    if (cards[from] <= 0) delete cards[from]
    cards[to] = (cards[to] ?? 0) + 1
  }

  boosters.forEach((booster, b) => {
    booster.forEach((ref, s) => {
      if (!banned(ref)) return
      const to = draw(ref, `${b}:${s}`)
      if (!to) return
      booster[s] = to
      swap(ref, to)
      replacements.push({ from: ref, to, booster: b, slot: s })
    })
  })

  // Copies held outside the boosters (heroes / guaranteed uniques are appended there).
  const inBoosters = {}
  for (const ref of (pool.boosters ?? []).flat()) inBoosters[ref] = (inBoosters[ref] ?? 0) + 1
  for (const [ref, count] of Object.entries(pool.cards ?? {})) {
    if (!banned(ref)) continue
    for (let k = 0; k < count - (inBoosters[ref] ?? 0); k++) {
      const to = draw(ref, `extra:${ref}:${k}`)
      if (!to) continue
      swap(ref, to)
      replacements.push({ from: ref, to, booster: null, slot: null })
    }
  }

  return { cards, boosters, replacements, unresolved }
}

// Same "open" definition as tournamentStore's OPEN_SQL (upcoming or ongoing).
const POOLS_SQL = `
  SELECT p.id, p.sub, p.cards, p.boosters, p.deck_id, p.deck_name,
         t.id AS t_id, t.name AS t_name, t.starts_at AS t_starts_at, t.config AS t_config
    FROM sealed_pools p
    JOIN tournaments t ON t.id = p.tournament_ref
   WHERE t.config->>'excludeBanlist' = 'true'
     AND t.detached_at IS NULL AND t.cancelled_at IS NULL AND t.ended_at IS NULL
     AND (t.ends_at IS NULL OR t.ends_at > now())
     AND p.cards IS NOT NULL
   ORDER BY t.starts_at, t.id, p.created_at, p.id`

const bannedUnder = config => {
  const version = banlistVersionOf(config)
  return ref => isBanned(ref, version)
}

export async function replaceBannedCards({ apply = false, fetchCards = fetchSet, log = console.log } = {}) {
  const { rows } = await query(POOLS_SQL)
  const affected = rows.filter(r => Object.keys(r.cards ?? {}).some(bannedUnder(r.t_config)))

  const sets = [...new Set(affected.flatMap(r => Object.keys(r.cards).filter(bannedUnder(r.t_config)).map(setCodeFromRef)))]
  const cardsBySet = Object.fromEntries(await Promise.all(sets.map(async s => [s, await fetchCards(s)])))
  const nameOf = ref => cardsBySet[setCodeFromRef(ref)]?.find(c => c.reference === ref)?.name ?? '?'

  const result = { scanned: rows.length, pools: 0, replaced: 0, unresolved: 0, conflicts: 0, decks: [] }
  log(`${apply ? '[apply]' : '[dry run]'} ${rows.length} pools in open ban-list tournaments, ${affected.length} with a banned card`)

  let tournament = null
  for (const row of affected) {
    if (row.t_id !== tournament) {
      tournament = row.t_id
      log(`\nTournament "${row.t_name}" (${row.t_id}, starts ${new Date(row.t_starts_at).toISOString()}, ban list ${banlistVersionOf(row.t_config)})`)
    }
    const plan = planReplacements(row, cardsBySet, { banned: bannedUnder(row.t_config) })
    log(`  pool ${row.id} (sub ${row.sub})`)
    for (const r of plan.replacements) {
      const where = r.booster == null ? 'outside the boosters' : `booster ${r.booster + 1}, slot ${r.slot + 1}`
      log(`    ${r.from} ${nameOf(r.from)} → ${r.to} ${nameOf(r.to)} (${where})`)
    }
    for (const u of plan.unresolved) log(`    UNRESOLVED ${u.from}: ${u.reason}`)
    result.unresolved += plan.unresolved.length
    if (!plan.replacements.length) continue

    if (apply) {
      // Only if the pool hasn't changed since it was read (no concurrent write lost).
      const { rowCount } = await query(
        `UPDATE sealed_pools SET cards = $2, boosters = $3
          WHERE id = $1 AND cards = $4::jsonb AND boosters = $5::jsonb`,
        [row.id, JSON.stringify(plan.cards), JSON.stringify(plan.boosters), JSON.stringify(row.cards), JSON.stringify(row.boosters)],
      )
      if (!rowCount) { result.conflicts++; log('    CONFLICT: the pool changed meanwhile, not written (re-run)'); continue }
    }
    result.pools++
    result.replaced += plan.replacements.length
    if (row.deck_id) result.decks.push({ tournament: row.t_name, poolId: row.id, sub: row.sub, deckId: row.deck_id, deckName: row.deck_name })
  }

  if (result.decks.length) {
    log(`\nDecks saved before the fix (may still list a replaced card — tell their players):`)
    for (const d of result.decks) log(`  - ${d.tournament} · "${d.deckName ?? ''}" · deck ${d.deckId} · sub ${d.sub} · pool ${d.poolId}`)
  }
  log(`\n${apply ? 'Wrote' : 'Would write'} ${result.replaced} replacements in ${result.pools} pools`
    + ` (${result.unresolved} unresolved, ${result.conflicts} conflicts, ${result.decks.length} decks to check)`
    + (apply ? '' : ' — dry run, nothing written. Re-run with --apply.'))
  return result
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  replaceBannedCards({ apply: process.argv.includes('--apply') })
    .then(({ unresolved, conflicts }) => getPool().end().then(() => process.exit(unresolved || conflicts ? 1 : 0)))
    .catch(e => { console.error(e); process.exit(1) })
}
