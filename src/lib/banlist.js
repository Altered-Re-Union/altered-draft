// Equinox competitive ban list ("cartes suspendues"). Opt-in for SEALED formats only
// (never tournament mode) — in sealed you don't pick which cards you open, so the abuse
// risk is low; the host toggles it on if they want a tournament-legal pool.
//
// Bans are keyed by card FAMILY, not by exact reference, so a single entry catches every
// printing of a card: its rarity variants (C / R1 / R2) AND the Kickstarter reprint
// (COREKS ≡ CORE). A family key = ALT_<SETBASE>_B_<FACTION>_<NUM>, with any trailing
// "KS" stripped from the set and the rarity + serial dropped. For uniques the same family
// key also matches every serial (…_U_<serial>) and its transfuge (dual-faction) prints.

// Suspended printed cards — banned at EVERY printing (common, rare, out-of-faction rare).
const BANNED_FAMILIES = new Set([
  'ALT_CORE_B_BR_06',
  'ALT_BISE_B_AX_53',
  'ALT_ALIZE_B_BR_34',
  'ALT_CORE_B_YZ_11',
  'ALT_CORE_B_AX_17',
  'ALT_BISE_B_AX_58',
  'ALT_CORE_B_OR_27',
  'ALT_CYCLONE_B_AX_81',
])

// Cards whose UNIQUES ONLY are suspended — the base printing stays legal. Moonlight
// Jellyfish (méduse lunaire): base Yzmir, its uniques are also playable in Axiom
// (transfuge), so ALL of its unique serials are banned regardless of the played faction.
const BANNED_UNIQUE_FAMILIES = new Set([
  'ALT_CORE_B_YZ_05',
])

/** ALT_COREKS_B_BR_06_R1 → { key:'ALT_CORE_B_BR_06', rarity:'R1' }. */
function familyKey(reference) {
  const p = String(reference).split('_') // [ALT, SET, PRINT, FACTION, NUM, RARITY, serial?]
  if (p.length < 5) return { key: reference, rarity: null }
  const setBase = p[1].replace(/KS$/, '')
  return { key: `ALT_${setBase}_B_${p[3]}_${p[4]}`, rarity: p[5] || null }
}

/** Whether a card reference is on the ban list. */
export function isBanned(reference) {
  const { key, rarity } = familyKey(reference)
  if (BANNED_FAMILIES.has(key)) return true
  if (rarity === 'U' && BANNED_UNIQUE_FAMILIES.has(key)) return true
  return false
}

/** Filter a list of normalized card objects, dropping banned references. */
export function filterBanned(cards) {
  return cards.filter(c => c && !isBanned(c.reference))
}
