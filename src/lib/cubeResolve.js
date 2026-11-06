import { fetchSet, fetchUniques, isUniqueRef, canonicalCardRef } from './cardData.js'
import { setsForCube } from './cubes.js'
import { resolveRefs } from './cubeSource.js'

// Resolve a list of card refs into a custom-cube shape { cards, heroes, unresolved }.
// Shared by the paste-a-cube flow and the load-from-Re:Union-deck flow, so a loaded deck
// becomes a customCube identical to a pasted one. Canonicalizes alt-art/promo printings to
// their standard B card (canonicalCardRef), fetches the needed sets + bundled/live uniques,
// splits heroes (cardType HERO) from cards, and reports refs that didn't resolve.
export async function resolveCubeRefs(rawRefs, lang = 'EN') {
  const refs = rawRefs.map(canonicalCardRef)
  const rawCodes = [...new Set(setsForCube(refs))]
  const results = await Promise.all(rawCodes.map(s => fetchSet(s, lang).catch(() => [])))
  const byRef = new Map(results.flat().map(c => [c.reference, c]))
  const uniqueCards = await fetchUniques(refs.filter(isUniqueRef), lang)
  for (const c of uniqueCards) byRef.set(c.reference, c)

  const resolved = [], unresolved = []
  for (const r of refs) (byRef.has(r) ? resolved : unresolved).push(r)
  const heroes = resolved.filter(r => byRef.get(r).cardType === 'HERO')
  const cards = resolved.filter(r => byRef.get(r).cardType !== 'HERO')
  return { cards, heroes, unresolved: [...new Set(unresolved)] }
}

// Client resolver of the tournament form's CubePicker, on top of resolveRefs (cubeSource.js):
// `ref` is the stored form, duplicates (and two given refs that map to one stored ref) fold into
// `qty`, heroes are split out by cardType, `unresolved` is as resolveRefs lists it.
export async function resolveCubeCards(rawRefs, lang = 'EN') {
  const { byRef, unresolved } = await resolveRefs(rawRefs, { lang })
  const cards = new Map(), heroes = new Map()
  for (const g of rawRefs) {
    const hit = byRef.get(g)
    if (!hit) continue
    const { ref, card } = hit
    if (card.cardType === 'HERO') {
      if (!heroes.has(ref)) heroes.set(ref, { ref, faction: card.faction, name: card.name })
    } else {
      const prev = cards.get(ref)
      if (prev) prev.qty += 1
      else cards.set(ref, { ref, qty: 1, faction: card.faction, cardType: card.cardType, name: card.name })
    }
  }
  return { cards: [...cards.values()], heroes: [...heroes.values()], unresolved }
}
