// Equinox competitive ban list ("cartes suspendues"). Opt-in for SEALED formats only
// (never tournament mode) — in sealed you don't pick which cards you open, so the abuse
// risk is low; the host toggles it on if they want a tournament-legal pool.
//
// Source: https://altered.re/pages/current-suspensions-errata-bans (checked 2026-11-03).
// Equinox suspends PRINTINGS, not whole cards: a card number comes as a common (_C), a
// rare of the same faction (_R1) and an out-of-faction rare (_R2, its own faction), and
// each one is suspended or not on its own (Baba Yaga: only the Ordis R2). So the list
// holds exact printings. A reference is matched on ALT_<SET>_B_<FACTION>_<NUM>_<RARITY>:
// the Kickstarter reprint (COREKS ≡ CORE) and the alt-art / promo prints (A / P) of a
// suspended printing are suspended with it. Uniques of a suspended card are NOT
// suspended (none is listed); only BANNED_UNIQUE_FAMILIES below bans uniques.
// Factions in the comments are the card's real faction (an R2 ref keeps its home letters).

// Suspended printings (Standard and derived formats).
const SUSPENDED_PRINTINGS = new Set([
  'ALT_CORE_B_AX_17_R1',     // Dr. Frankenstein — Rare, Axiom
  'ALT_BISE_B_AX_53_C',      // The Grems — Common, Axiom
  'ALT_CYCLONE_B_AX_81_C',   // Restocking Station — Common, Axiom
  'ALT_CYCLONE_B_AX_81_R2',  // Restocking Station — Rare OOF, Bravos
  'ALT_BISE_B_AX_58_C',      // Bugfix — Common, Axiom
  'ALT_BISE_B_AX_58_R1',     // Bugfix — Rare, Axiom
  'ALT_ALIZE_B_BR_34_C',     // Haven Seiringar — Common, Bravos
  'ALT_ALIZE_B_BR_34_R1',    // Haven Seiringar — Rare, Bravos
  'ALT_CORE_B_BR_06_C',      // Tiny Jinn — Common, Bravos
  'ALT_CORE_B_BR_06_R1',     // Tiny Jinn — Rare, Bravos
  'ALT_CORE_B_YZ_11_R2',     // Baba Yaga — Rare OOF, Ordis
  'ALT_CORE_B_OR_27_R1',     // Celebration Day — Rare, Ordis
  'ALT_CORE_B_OR_27_R2',     // Celebration Day — Rare OOF, Yzmir
  'ALT_CORE_B_LY_29_C',      // Lyra Festival — Common, Lyra
  'ALT_CORE_B_LY_29_R1',     // Lyra Festival — Rare, Lyra
  'ALT_CORE_B_LY_29_R2',     // Lyra Festival — Rare OOF, Muna
])

// Cards whose UNIQUES ONLY are banned — the base printings stay legal. Moonlight
// Jellyfish (méduse lunaire): base Yzmir, its uniques are also playable in Axiom
// (transfuge), so ALL of its unique serials are banned regardless of the played faction.
const BANNED_UNIQUE_FAMILIES = new Set([
  'ALT_CORE_B_YZ_05',
])

/** ALT_COREKS_A_BR_06_R1 → { family:'ALT_CORE_B_BR_06', rarity:'R1' }. */
function parse(reference) {
  const p = String(reference).split('_') // [ALT, SET, PRINT, FACTION, NUM, RARITY, serial?]
  if (p.length < 5) return { family: reference, rarity: null }
  const setBase = p[1].replace(/KS$/, '')
  return { family: `ALT_${setBase}_B_${p[3]}_${p[4]}`, rarity: p[5] || null }
}

/** Whether a card reference is on the ban list. */
export function isBanned(reference) {
  const { family, rarity } = parse(reference)
  if (rarity === 'U') return BANNED_UNIQUE_FAMILIES.has(family)
  return rarity != null && SUSPENDED_PRINTINGS.has(`${family}_${rarity}`)
}

/** Filter a list of normalized card objects, dropping banned references. */
export function filterBanned(cards) {
  return cards.filter(c => c && !isBanned(c.reference))
}
