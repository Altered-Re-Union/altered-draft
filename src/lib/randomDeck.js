// Builds a random, roughly-valid deck (≤3 factions, ≤1 hero, up to `size` cards) from a
// pool of owned cards. Shared by the in-app "Make random deck" button
// (TournamentPoolView.jsx) and the BGA decklist endpoint's auto-fallback
// (api/_lib/tournamentPool.js's ensureDeck, server-side — same algorithm, same shape).
// `poolCards` is a ref -> owned-quantity map (e.g. a sealed pool's `cards`); `cardMap`
// resolves each ref to its card object (only `.cardType`/`.faction` are read).
export function buildRandomDeck(poolCards, cardMap, { size = 30 } = {}) {
  const refs = Object.keys(poolCards)
  const heroRefs = refs.filter(r => cardMap[r]?.cardType === 'HERO')
  const others = refs.filter(r => cardMap[r]?.cardType !== 'HERO')

  const next = {}
  let heroFaction = null
  let remaining = size
  if (heroRefs.length) {
    const hero = heroRefs[Math.floor(Math.random() * heroRefs.length)]
    next[hero] = 1
    heroFaction = cardMap[hero]?.faction ?? null
    remaining -= 1
  }

  const byFaction = {}
  for (const ref of others) {
    const f = cardMap[ref]?.faction
    if (f) (byFaction[f] = byFaction[f] ?? []).push(ref)
  }

  // Pick up to 3 factions (in random order), stopping once they cover the remaining slots.
  const chosen = new Set(heroFaction ? [heroFaction] : [])
  let covered = 0
  for (const f of shuffle(Object.keys(byFaction))) {
    if (chosen.size >= 3) break
    if (chosen.has(f)) continue
    chosen.add(f)
    covered += byFaction[f].reduce((sum, ref) => sum + (poolCards[ref] ?? 1), 0)
    if (covered >= remaining) break
  }

  // Flatten the chosen factions' cards into one copy-per-owned-copy list, shuffle, and take
  // only as many as still needed — lands the deck on exactly `size` cards (or the pool's
  // max, if it's short) instead of dumping every owned card in.
  const pickable = []
  for (const f of chosen) {
    for (const ref of byFaction[f] ?? []) {
      const qty = poolCards[ref] ?? 1
      for (let i = 0; i < qty; i++) pickable.push(ref)
    }
  }
  for (const ref of shuffle(pickable).slice(0, remaining)) {
    next[ref] = (next[ref] ?? 0) + 1
  }
  return next
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}