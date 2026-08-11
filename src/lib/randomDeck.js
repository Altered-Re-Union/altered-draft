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
  const countOf = f => (byFaction[f] ?? []).reduce((sum, ref) => sum + (poolCards[ref] ?? 1), 0)

  // Pick up to 3 factions total (heroFaction, if any, is one of them) whose combined count
  // covers `remaining` cards — checked BEFORE drawing any individual card, so a random pick
  // of sparse factions can't leave the deck short (and invalid) when a better combo existed.
  const otherFactions = Object.keys(byFaction).filter(f => f !== heroFaction)
  const slotsLeft = heroFaction ? 2 : 3
  const baseCovered = heroFaction ? countOf(heroFaction) : 0

  const byCountDesc = [...otherFactions].sort((a, b) => countOf(b) - countOf(a))
  let pick = byCountDesc.slice(0, slotsLeft) // the best any combo of `slotsLeft` factions can cover
  const bestTotal = baseCovered + pick.reduce((sum, f) => sum + countOf(f), 0)

  if (bestTotal >= remaining) {
    // The pool CAN reach a full-size deck — look for a random combo that also reaches it,
    // so the pick isn't always "the biggest factions". Falls back to the best combo above
    // if no random attempt covers it within a reasonable number of tries.
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = shuffle(otherFactions).slice(0, slotsLeft)
      const total = baseCovered + candidate.reduce((sum, f) => sum + countOf(f), 0)
      if (total >= remaining) { pick = candidate; break }
    }
  }
  // else: even the best combo falls short — the pool itself is too small for a full deck
  // across ≤3 factions; use the best combo anyway (maximizes what's achievable).

  const chosen = new Set(heroFaction ? [heroFaction, ...pick] : pick)

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