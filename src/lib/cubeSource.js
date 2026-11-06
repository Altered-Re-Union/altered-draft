// Resolves cube refs into card objects and stored forms (spec §15.2 "Resolving a ref").
// Isomorphic: no server-only import, the fetchers are injectable.
import * as cardData from './cardData.js'

const { SETS, canonicalCardRef, needsCardApi, isUniqueRef } = cardData

/** Thrown when the card data could not be loaded (spec §15.2): a 503 / pool_unavailable, never "unresolved". */
function cardsUnavailable(message) {
  const err = new Error(`card data unavailable: ${message}`)
  err.code = 'cards_unavailable'
  return err
}

export async function resolveRefs(refs, {
  fetchSet = cardData.fetchSet,
  fetchUniques = cardData.fetchUniques,
  lang = 'EN',
} = {}) {
  const given = [...new Set(refs)]
  const known = new Set(SETS.map(s => s.code))
  const canons = new Map(given.map(g => [g, canonicalCardRef(g)]))

  // Sets of the canon refs that SETS knows, each fetched once, sequentially.
  const setCodes = []
  for (const canon of canons.values()) {
    if (isUniqueRef(canon)) continue
    const code = canon.split('_')[1]
    if (known.has(code) && !setCodes.includes(code)) setCodes.push(code)
  }
  const bySet = new Map()
  for (const code of setCodes) {
    let cards
    // A set SETS knows that does not load is an outage (network, timeout, 5xx), not a bad ref.
    try { cards = await fetchSet(code, lang) } catch (e) { throw cardsUnavailable(e.message) }
    bySet.set(code, new Map(cards.map(c => [c.reference, c])))
  }

  const byRef = new Map()
  const byApi = []
  const missing = new Set(given)
  for (const g of given) {
    const canon = canons.get(g)
    const card = isUniqueRef(canon) ? undefined : bySet.get(canon.split('_')[1])?.get(canon)
    if (card) { byRef.set(g, { ref: canon, card }); missing.delete(g) }
    else if (needsCardApi(g)) byApi.push(g)
  }
  if (byApi.length) {
    const fetched = new Map((await fetchUniques(byApi, lang, { stopOnUnavailable: true })).map(c => [c.reference, c]))
    for (const g of byApi) {
      const card = fetched.get(g)
      // The cards API did not answer: try again later, never list the ref as unknown.
      if (card?.unavailable) throw cardsUnavailable(`cards API unavailable for ${g}`)
      if (card && !card.synthetic) { byRef.set(g, { ref: g, card }); missing.delete(g) }
    }
  }
  return { byRef, unresolved: given.filter(g => missing.has(g)) }
}

export async function resolveCubeSource(source, deps) {
  const cardRefs = Object.keys(source.cards)
  const heroRefs = source.heroPool
  const { byRef, unresolved } = await resolveRefs([...cardRefs, ...heroRefs], deps)

  const merged = new Map()
  for (const g of cardRefs) {
    const hit = byRef.get(g)
    if (!hit) continue
    const prev = merged.get(hit.ref)
    if (prev) prev.qty += source.cards[g]
    else merged.set(hit.ref, { ref: hit.ref, qty: source.cards[g], faction: hit.card.faction, cardType: hit.card.cardType })
  }
  const cards = [...merged.values()]

  const heroMap = new Map()
  for (const g of heroRefs) {
    const hit = byRef.get(g)
    if (hit && !heroMap.has(hit.ref)) heroMap.set(hit.ref, { ref: hit.ref, faction: hit.card.faction, cardType: hit.card.cardType })
  }
  const heroes = [...heroMap.values()]

  return {
    cards,
    heroes,
    unresolved,
    heroesInCards: cards.filter(c => c.cardType === 'HERO').map(c => c.ref),
    nonHeroesInPool: heroes.filter(h => h.cardType !== 'HERO').map(h => h.ref),
    stored: {
      cards: Object.fromEntries(cards.map(c => [c.ref, c.qty])),
      heroPool: [...heroMap.keys()].sort(),
    },
  }
}
