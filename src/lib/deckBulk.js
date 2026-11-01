// Bulk deck edits for PoolGrid's "+ All" / "− All" group buttons (faction and cost groups).
// They act on the refs the group shows. Heroes are always left alone (a deck takes at most
// one, so they stay a deliberate pick), and the 3-faction limit is not enforced here — the
// validity badge already reports it.
// `deck` and `poolCounts` are ref -> quantity maps; `cardMap` resolves `.cardType`.

function bulkRefs(refs, cardMap) {
  return [...new Set(refs)].filter(r => cardMap[r] && cardMap[r].cardType !== 'HERO')
}

// Every non-hero card of `refs` at its full pool quantity.
export function addRefsToDeck(deck, poolCounts, cardMap, refs) {
  const next = { ...deck }
  for (const ref of bulkRefs(refs, cardMap)) {
    if (poolCounts[ref] > 0) next[ref] = poolCounts[ref]
  }
  return next
}

// Drops every non-hero card of `refs` from the deck.
export function removeRefsFromDeck(deck, cardMap, refs) {
  const next = { ...deck }
  for (const ref of bulkRefs(refs, cardMap)) delete next[ref]
  return next
}

// What the buttons can do right now, to disable the one that would be a no-op.
export function bulkDeckState(deck, poolCounts, cardMap, refs) {
  const own = bulkRefs(refs, cardMap)
  return {
    canAdd: own.some(r => (deck[r] ?? 0) < (poolCounts[r] ?? 0)),
    canRemove: own.some(r => (deck[r] ?? 0) > 0),
  }
}
