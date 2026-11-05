// Equinox competitive ban list ("cartes suspendues"). Opt-in for SEALED formats only
// (never tournament mode) — in sealed you don't pick which cards you open, so the abuse
// risk is low; the host toggles it on if they want a tournament-legal pool.
//
// VERSIONED: a declared tournament keeps the ban list it was created with, so every pool
// of a tournament is drawn under the same rules even when the list changes mid-tournament
// (its first pools are stored and never regenerated). validateTournamentConfig stamps
// CURRENT_BANLIST as `config.banlist` on a config that ticks `excludeBanlist`; a stored
// config without that field predates versioning and uses LEGACY_BANLIST
// (banlistVersionOf). A tournament's config can only change while it has no pool, so a
// config edit re-stamps the current list without breaking any equity. The Lobby (one-off
// rooms) always uses the current list. Change the list = add a version, never edit one
// that tournaments may already use.
//
// A reference is matched on ALT_<SET>_B_<FACTION>_<NUM>_<RARITY>: the Kickstarter reprint
// (COREKS ≡ CORE) and the alt-art / promo prints (A / P) follow their B printing.
// Factions in the comments are the card's real faction (an R2 ref keeps its home letters).

/** ALT_COREKS_A_BR_06_R1 → { family:'ALT_CORE_B_BR_06', rarity:'R1' }. */
function parse(reference) {
  const p = String(reference).split('_') // [ALT, SET, PRINT, FACTION, NUM, RARITY, serial?]
  if (p.length < 5) return { family: reference, rarity: null }
  const setBase = p[1].replace(/KS$/, '')
  return { family: `ALT_${setBase}_B_${p[3]}_${p[4]}`, rarity: p[5] || null }
}

// Moonlight Jellyfish (méduse lunaire): base Yzmir, its uniques are also playable in Axiom
// (transfuge), so ALL of its unique serials are banned regardless of the played faction.
// Its base printings stay legal. Same in every version so far.
const MOONLIGHT_JELLYFISH = 'ALT_CORE_B_YZ_05'

// v1 — whole cards (until 2026-11-04). Every printing of a listed card is banned (C, R1,
// R2) AND its uniques. Over-strict compared with Equinox, kept for the tournaments
// created under it. Lyra Festival was added on 2026-11-03 (PR #29).
const V1_BANNED_CARDS = new Set([
  'ALT_CORE_B_BR_06',     // Tiny Jinn
  'ALT_BISE_B_AX_53',     // The Grems
  'ALT_ALIZE_B_BR_34',    // Haven Seiringar
  'ALT_CORE_B_YZ_11',     // Baba Yaga
  'ALT_CORE_B_AX_17',     // Dr. Frankenstein
  'ALT_BISE_B_AX_58',     // Bugfix
  'ALT_CORE_B_OR_27',     // Celebration Day
  'ALT_CYCLONE_B_AX_81',  // Restocking Station
  'ALT_CORE_B_LY_29',     // Lyra Festival
])

// v2 — exact printings (from 2026-11-04). Source:
// https://altered.re/pages/current-suspensions-errata-bans (checked 2026-11-03). Equinox
// suspends PRINTINGS, not whole cards: a card number comes as a common (_C), a rare of the
// same faction (_R1) and an out-of-faction rare (_R2, its own faction), each suspended or
// not on its own (Baba Yaga: only the Ordis R2). Uniques of a suspended card stay legal.
const V2_SUSPENDED_PRINTINGS = new Set([
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

const BANLISTS = {
  v1: ({ family, rarity }) => family === MOONLIGHT_JELLYFISH ? rarity === 'U' : V1_BANNED_CARDS.has(family),
  v2: ({ family, rarity }) => rarity === 'U'
    ? family === MOONLIGHT_JELLYFISH
    : rarity != null && V2_SUSPENDED_PRINTINGS.has(`${family}_${rarity}`),
}

export const BANLIST_VERSIONS = Object.keys(BANLISTS)
/** Stamped on every new config that ticks the ban list. */
export const CURRENT_BANLIST = 'v2'
/** The list of a config stored before versioning (no `banlist` field). */
export const LEGACY_BANLIST = 'v1'

/** The ban-list version a (validated or stored) config draws under. */
export function banlistVersionOf(config) {
  return BANLISTS[config?.banlist] ? config.banlist : LEGACY_BANLIST
}

/** Whether a card reference is on the ban list `version` (the current one by default). */
export function isBanned(reference, version = CURRENT_BANLIST) {
  const check = BANLISTS[version]
  if (!check) throw new Error(`unknown ban list version ${version}`)
  return check(parse(reference))
}

/** Filter a list of normalized card objects, dropping the references banned by `version`. */
export function filterBanned(cards, version = CURRENT_BANLIST) {
  return cards.filter(c => c && !isBanned(c.reference, version))
}
