// The sealed configuration object of a tournament (docs/tournaments/user-tournaments-spec.md
// §5.1). One shape for declared tournaments, for the legacy `current_format` (converted on
// read) and, from lot 2 on, for the Lobby. Pure: shared by server validation and the form.
import { SETS, FACTIONS, canonicalCardRef, needsCardApi } from './cardData.js'
import { hasFactionRanges } from './uniqueFactionRanges.js'
import { CURRENT_BANLIST } from './banlist.js'
import { CUBE_LIMITS, CUBE_ORIGINS, CARD_REF_RE, isHeroRefShape } from './cubeSealed.js'

export const CONFIG_VERSION = 1
export const SEALED_BOOSTERS = 7
export const MAX_UNIQUES = 7
export const HERO_MODES = ['packs', 'free']
export const SOURCE_TYPES = ['set', 'faction', 'multiset', 'cube']
export const MAX_SET_WEIGHT = 3
export const MAX_RANDOM_ONE_IN = 10
export const DEFAULT_RANDOM_ONE_IN = 8

/**
 * The set codes a config draws from, in `SETS` order (codes unknown to SETS after, in their
 * key order). Sorted here rather than trusted: a config read back from jsonb has its keys in
 * jsonb order (length, then bytes), not in the order validateTournamentConfig wrote them.
 */
export function configSetCodes(config) {
  const src = config.source
  if (src.type === 'set') return [src.setCode]
  if (src.type === 'cube') {
    // The BASE set of each ref (a promo / OP code like DUSTERTOP counts as DUSTER), known codes only.
    const codes = new Set([...Object.keys(src.cards ?? {}), ...(src.heroPool ?? [])].map(baseSetCode))
    return SETS.map(s => s.code).filter(code => codes.has(code))
  }
  const rank = code => {
    const i = SETS.findIndex(s => s.code === code)
    return i === -1 ? SETS.length : i
  }
  return Object.keys(src.sets).sort((a, b) => rank(a) - rank(b))
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(String(value))
  return Number.isInteger(n) ? n : null
}

/** The set a ref's gameplay card belongs to: promo / OP codes (DUSTERTOP) map to their base set. */
const baseSetCode = ref => canonicalCardRef(ref).split('_')[1]
const knownSet = ref => SETS.some(s => s.code === baseSetCode(ref))
const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** Shape and range checks of a cube source (spec §15.2); existence of the refs is a server check. */
function validateCubeSource(src, errors) {
  const L = CUBE_LIMITS
  const name = typeof src.name === 'string' ? src.name.trim() : ''
  if (!name || name.length > L.nameMax) errors.push('source.name')
  const originOk = CUBE_ORIGINS.includes(src.origin)
  if (!originOk) errors.push('source.origin')
  const cubeId = originOk && src.origin === 'community' ? (typeof src.cubeId === 'string' && src.cubeId.trim() ? src.cubeId.trim() : undefined) : null
  if (cubeId === undefined) errors.push('source.cubeId')

  const cards = {}
  let cardsOk = isPlainObject(src.cards) && Object.keys(src.cards).length > 0
  if (cardsOk) {
    let sum = 0
    for (const ref of Object.keys(src.cards).sort()) {
      const qty = typeof src.cards[ref] === 'boolean' ? null : toInt(src.cards[ref], null)
      if (!CARD_REF_RE.test(ref) || !knownSet(ref) || qty === null || qty < 1 || qty > 99) { cardsOk = false; break }
      cards[ref] = qty
      sum += qty
    }
    if (sum > L.maxCards) cardsOk = false
  }
  if (!cardsOk) errors.push('source.cards')

  let heroPool = []
  let heroOk = Array.isArray(src.heroPool)
  if (heroOk) {
    heroPool = [...new Set(src.heroPool)].sort()
    if (!heroPool.length || heroPool.length > L.maxHeroes || !heroPool.every(r => isHeroRefShape(r) && knownSet(r))) heroOk = false
  }
  if (!heroOk) errors.push('source.heroPool')
  // Bounds the server-side fan-out on the cards API (one request per ref).
  if (cardsOk && heroOk && new Set([...Object.keys(cards), ...heroPool].filter(needsCardApi)).size > L.maxCardApiRefs) errors.push('source.cards')

  const num = (v, [min, max]) => {
    const n = typeof v === 'boolean' ? null : toInt(v, null)
    return n !== null && n >= min && n <= max ? n : null
  }
  const boosters = num(src.boosters, L.boosters)
  const cardsPerBooster = num(src.cardsPerBooster, L.cardsPerBooster)
  let perFaction = num(src.perFaction, L.perFaction)
  if (boosters === null) errors.push('source.boosters')
  if (cardsPerBooster === null) errors.push('source.cardsPerBooster')
  if (perFaction === null || (perFaction === 2 && cardsPerBooster !== null && cardsPerBooster < L.perFaction2MinCards)) {
    errors.push('source.perFaction')
    perFaction = null
  }
  if (boosters !== null && cardsPerBooster !== null && boosters * cardsPerBooster < L.minPoolCards) errors.push('source.poolSize')
  return { type: 'cube', name, origin: src.origin, cubeId, cards, heroPool, boosters, cardsPerBooster, perFaction }
}

/**
 * Validates and normalizes a config. `errors` lists dotted paths of the offending fields.
 * @returns {{ ok: boolean, errors: string[], config: object | null }}
 */
export function validateTournamentConfig(input) {
  const errors = []
  const c = input && typeof input === 'object' ? input : {}

  if (c.format !== undefined && c.format !== 'sealed') errors.push('format')

  const src = c.source && typeof c.source === 'object' ? c.source : {}
  if (!SOURCE_TYPES.includes(src.type)) errors.push('source.type')
  const isFaction = src.type === 'faction'
  const isCube = src.type === 'cube'
  let cubeSource = null
  let set = null
  let factionSets = {}
  let multiSets = null
  if (isCube) {
    cubeSource = validateCubeSource(src, errors)
  } else if (isFaction) {
    if (!FACTIONS.includes(src.faction)) errors.push('source.faction')
    const raw = src.sets && typeof src.sets === 'object' && !Array.isArray(src.sets) ? src.sets : null
    let setsOk = !!raw
    if (raw) {
      const visible = SETS.filter(s => !s.hidden)
      if (Object.keys(raw).some(code => !visible.some(s => s.code === code))) setsOk = false
      for (const { code } of visible) {
        const w = toInt(raw[code], 0)
        if (w === null || w < 0 || w > MAX_SET_WEIGHT) setsOk = false
        else if (w > 0) factionSets[code] = w
      }
    }
    if (!setsOk || !Object.keys(factionSets).length) errors.push('source.sets')
  } else if (src.type === 'multiset') {
    const raw = src.sets && typeof src.sets === 'object' && !Array.isArray(src.sets) ? src.sets : null
    let setsOk = !!raw
    const counts = {}
    if (raw) {
      const visible = SETS.filter(s => !s.hidden)
      if (Object.keys(raw).some(code => !visible.some(s => s.code === code))) setsOk = false
      for (const { code } of visible) {
        const n = toInt(raw[code], 0)
        if (n === null || n < 0 || n > SEALED_BOOSTERS) setsOk = false
        else if (n > 0) counts[code] = n
      }
    }
    const codes = Object.keys(counts)
    if (!setsOk || !codes.length || codes.reduce((t, k) => t + counts[k], 0) !== SEALED_BOOSTERS) errors.push('source.sets')
    else if (codes.length === 1) set = SETS.find(s => s.code === codes[0]) // one set left: stored as `set`
    else multiSets = counts
  } else if (src.type === 'set') {
    set = SETS.find(s => s.code === src.setCode && !s.hidden) ?? null
    if (!set) errors.push('source.setCode')
  }
  if (!isCube && src.boosters !== undefined && src.boosters !== SEALED_BOOSTERS) errors.push('source.boosters')

  if (!HERO_MODES.includes(c.heroes)) errors.push('heroes')

  const u = !isCube && c.uniques && typeof c.uniques === 'object' ? c.uniques : {}
  // Random mode (spec §5.1, §13.2): each booster rolls its own unique. It replaces the exact
  // in-booster count, whose client value is not even range-checked.
  const randomOneIn = u.randomOneIn === undefined || u.randomOneIn === null ? null : toInt(u.randomOneIn, null)
  const randomBad = u.randomOneIn !== undefined && u.randomOneIn !== null
    && (typeof u.randomOneIn === 'boolean' || randomOneIn === null || randomOneIn < 1 || randomOneIn > MAX_RANDOM_ONE_IN)
  if (randomBad) errors.push('uniques.randomOneIn')
  const random = !randomBad && randomOneIn !== null
  const rawInBoosters = toInt(u.inBoosters, 0)
  const inBoosters = random ? 0 : rawInBoosters
  const guaranteed = toInt(u.guaranteed, 0)
  if (!random && (inBoosters === null || inBoosters < 0 || inBoosters > MAX_UNIQUES)) errors.push('uniques.inBoosters')
  if (guaranteed === null || guaranteed < 0 || guaranteed > MAX_UNIQUES) errors.push('uniques.guaranteed')
  // A faction source forces both (spec §5): the client's values are ignored, never an error.
  if (!isFaction) {
    if (u.evenFactions !== undefined && typeof u.evenFactions !== 'boolean') errors.push('uniques.evenFactions')
    if (u.faction !== undefined && u.faction !== null && !FACTIONS.includes(u.faction)) errors.push('uniques.faction')
  }
  const wantsUniques = (inBoosters ?? 0) > 0 || (guaranteed ?? 0) > 0 || random
  if (set && wantsUniques && !hasFactionRanges(set.code)) errors.push('uniques.unsupportedSet')
  if (isFaction && !errors.some(e => e.startsWith('source.')) && wantsUniques && !Object.keys(factionSets).some(hasFactionRanges)) errors.push('uniques.unsupportedSet')
  if (multiSets && wantsUniques) {
    const eligible = Object.keys(multiSets).filter(hasFactionRanges)
    if (!eligible.length) errors.push('uniques.unsupportedSet')
    else if (!random && inBoosters !== null && inBoosters > 3 * eligible.reduce((t, k) => t + multiSets[k], 0)) errors.push('uniques.inBoosters')
  }

  if (!isCube && c.excludeBanlist !== undefined && typeof c.excludeBanlist !== 'boolean') errors.push('excludeBanlist')

  if (errors.length) return { ok: false, errors, config: null }
  const uniqueTotal = inBoosters + guaranteed
  const hasUniques = uniqueTotal > 0 || random
  const faction = isFaction ? (hasUniques ? src.faction : null) : hasUniques ? u.faction ?? null : null
  return {
    ok: true,
    errors: [],
    config: {
      v: CONFIG_VERSION,
      format: 'sealed',
      source: isCube
        ? cubeSource
        : isFaction
        ? { type: 'faction', faction: src.faction, sets: factionSets, boosters: SEALED_BOOSTERS }
        : multiSets
          ? { type: 'multiset', sets: multiSets, boosters: SEALED_BOOSTERS }
          : { type: 'set', setCode: set.code, boosters: SEALED_BOOSTERS },
      heroes: c.heroes,
      // Even factions only means something from 2 uniques on and without a single faction;
      // a stale "true" would still change the draw (evenFactionTargets consumes the rng) and
      // mislead the stored config. Same for a faction left over with no unique at all.
      uniques: { inBoosters, guaranteed, evenFactions: !!u.evenFactions && !random && !multiSets && uniqueTotal >= 2 && !faction, faction, randomOneIn: random ? randomOneIn : null },
      excludeBanlist: !isCube && !!c.excludeBanlist,
      // The ban-list version this config draws under (banlist.js): always the current one,
      // whatever the client sent. Only reached on creation and on a config edit, which is
      // only allowed while the tournament has no pool, so no pool ever changes list. Absent
      // when the ban list is off (and on configs stored before versioning: legacy list).
      ...(!isCube && c.excludeBanlist ? { banlist: CURRENT_BANLIST } : {}),
    },
  }
}

/** A `current_format` (or legacy `sealed_pools`) row expressed as a config. */
export function configFromLegacyFormat(row) {
  return {
    v: CONFIG_VERSION,
    format: 'sealed',
    source: { type: 'set', setCode: row.set_code, boosters: SEALED_BOOSTERS },
    heroes: row.heroes_in_pool ? 'packs' : 'free',
    uniques: {
      inBoosters: row.unique_count ?? 0,
      guaranteed: row.guaranteed_uniques ?? 0,
      evenFactions: !!row.even_factions,
      randomOneIn: null,
    },
    excludeBanlist: false,
  }
}

/** The legacy snapshot columns of `sealed_pools` for a config (they stay NOT NULL in lot 1). */
export function legacyColumnsFromConfig(config) {
  return {
    set_code: config.source.type === 'set' ? config.source.setCode : null,
    unique_count: config.uniques.inBoosters,
    even_factions: config.uniques.evenFactions,
    heroes_in_pool: config.heroes === 'packs',
    guaranteed_uniques: config.uniques.guaranteed,
  }
}

/**
 * The format a declaration of a BGA tournament must take when pools are already bound to
 * that BGA id without a declared tournament (players already playing it with the generic
 * format, spec §6): those pools can't be swapped, so the declaration takes their format.
 * @param {{ set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, count }[]} groups
 *   the legacy pools of that BGA id grouped by their snapshot columns (poolStore.legacyFormatsForBgaId)
 * @returns {null | { pools: number, mixed: boolean, config: object | null }} null = none;
 *   mixed = they don't share one format, and the declaration is refused
 */
export function legacyFormatForBgaTournament(groups) {
  if (!groups?.length) return null
  const pools = groups.reduce((n, g) => n + Number(g.count), 0)
  const key = g => JSON.stringify(legacyColumnsFromConfig(configFromLegacyFormat(g)))
  const mixed = new Set(groups.map(key)).size > 1
  return { pools, mixed, config: mixed ? null : configFromLegacyFormat(groups[0]) }
}
