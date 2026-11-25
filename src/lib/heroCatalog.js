import { SETS, FACTIONS, fetchSet } from './cardData.js'

// Every non-unique hero of every visible set, for the tournament form's hero pool picker.
// Deduplicated by reference, sorted by faction (FACTIONS order) then name; memoized per lang
// (a failed load is not cached, so the picker can retry).
const cache = new Map()

export function _resetHeroCatalog() { cache.clear() }

export function loadAllHeroes(lang = 'EN') {
  if (!cache.has(lang)) {
    const p = (async () => {
      const byRef = new Map()
      for (const s of SETS.filter(s => !s.hidden)) {
        const cards = await fetchSet(s.code, lang)
        for (const c of cards) {
          if (c.cardType !== 'HERO' || c.rarity === 'U' || byRef.has(c.reference)) continue
          byRef.set(c.reference, { ref: c.reference, name: c.name, faction: c.faction, set: s.code })
        }
      }
      const rank = f => { const i = FACTIONS.indexOf(f); return i < 0 ? FACTIONS.length : i }
      return [...byRef.values()].sort((a, b) => rank(a.faction) - rank(b.faction) || a.name.localeCompare(b.name))
    })()
    p.catch(() => cache.delete(lang))
    cache.set(lang, p)
  }
  return cache.get(lang)
}
