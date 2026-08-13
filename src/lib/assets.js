const CDN = 'https://cdn.alteredcore.org/marketing'

export const FACTION_ICONS = {
  AX: `${CDN}/game_assets/faction_icons/AXIOM-faction-icon.png`,
  BR: `${CDN}/game_assets/faction_icons/BRAVOS-faction-icon.png`,
  LY: `${CDN}/game_assets/faction_icons/LYRA-faction-icon.png`,
  MU: `${CDN}/game_assets/faction_icons/MUNA-faction-icon.png`,
  OR: `${CDN}/game_assets/faction_icons/ORDIS-faction-icon.png`,
  YZ: `${CDN}/game_assets/faction_icons/YZMIR-faction-icon.png`,
}

export const RARITY_GEMS = {
  C:  `${CDN}/game_assets/rarity_gems/RARITY_GEM_COMMON.png`,
  R1: `${CDN}/game_assets/rarity_gems/RARITY_GEM_RARE.png`,
  R2: `${CDN}/game_assets/rarity_gems/RARITY_GEM_RARE.png`,
  EX: `${CDN}/game_assets/rarity_gems/RARITY_GEM_RARE.png`,  // Exalted — same gem as rare for now
  U:  `${CDN}/game_assets/rarity_gems/RARITY_GEM_UNIQUE.png`,
}

// Small set icons for use in decklists and stats
export const SET_ICONS = {
  CORE:    `${CDN}/sets_logo/BTG-set-icon.png`,
  COREKS:  `${CDN}/sets_logo/BTG-set-icon.png`,  // Kickstarter cards use the Beyond the Gates logo
  ALIZE:   `${CDN}/sets_logo/ALT_TBF_ICON.png`,
  BISE:    `${CDN}/sets_logo/ALT_WFM_ICON.png`,
  CYCLONE: `${CDN}/sets_logo/ALT_SKY_ICON.png`,
  DUSTER:  `${CDN}/sets_logo/ALT_SDU_ICON_SIMPLIFIED.svg`,
  EOLE:    `${CDN}/sets_logo/ALT_EOLE_ICON.png`,
  FUGUE:   null,
}

// Extract set code from a card reference e.g. ALT_CORE_B_AX_01_C → CORE
export function setCodeFromRef(reference) {
  return reference?.split('_')[1] ?? null
}

// Real booster-pack photography, per set AND per language (the pack print itself says
// "ENGLISH"/"FRANÇAIS" etc.), for the "unwrap a pack" cover screen in CardZoom (see
// PackReveal.jsx). Bundled locally (public/boosters/<SET>_<LANG>.png) rather than fetched
// from a CDN — unlike card art there's no per-set-agnostic community source for this. Sets
// with no photo yet simply skip the cover screen; a language with no photo for a set that
// DOES have one falls back to EN rather than skipping (boosterCoverFor returns null only
// when the set has nothing at all).
export const BOOSTER_COVERS = {
  EOLE: { EN: '/boosters/EOLE_EN.webp', FR: '/boosters/EOLE_FR.webp' },
}

export function boosterCoverFor(setCode, lang = 'EN') {
  const bySet = BOOSTER_COVERS[setCode]
  if (!bySet) return null
  return bySet[lang?.toUpperCase()] ?? bySet.EN ?? null
}

// Set logos and icons from CDN
export const SET_ASSETS = {
  CORE:    { icon: null,                                    logo: `${CDN}/sets_logo/LOGO%20BTG-EN.png` },
  ALIZE:   { icon: `${CDN}/sets_logo/ALT_TBF_ICON.png`,   logo: `${CDN}/sets_logo/ALT_TBF_LOGO_en_EN.png` },
  BISE:    { icon: `${CDN}/sets_logo/ALT_WFM_ICON.png`,   logo: `${CDN}/sets_logo/ALT_WFM_LOGO_en_EN.png` },
  CYCLONE: { icon: `${CDN}/sets_logo/ALT_SKY_ICON.png`,   logo: `${CDN}/sets_logo/ALT_SKY_LOGO_en_EN.png` },
  DUSTER:  { icon: `${CDN}/sets_logo/ALT_SDU_ICON.png`,   logo: `${CDN}/sets_logo/ALT_SDU_LOGO_EN.png` },
  EOLE:    { icon: `${CDN}/sets_logo/ALT_EOLE_ICON.png`,  logo: `${CDN}/sets_logo/ALT_ROC_LOGO_en_EN.png` },
  FUGUE:   { icon: null,                                    logo: null },
}
