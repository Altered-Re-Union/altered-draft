// The sealed configuration object of a tournament (docs/tournaments/user-tournaments-spec.md
// §5.1). One shape for declared tournaments, for the legacy `current_format` (converted on
// read) and, from lot 2 on, for the Lobby. Pure: shared by server validation and the form.
import { SETS, FACTIONS } from './cardData.js'
import { hasFactionRanges } from './uniqueFactionRanges.js'

export const CONFIG_VERSION = 1
export const SEALED_BOOSTERS = 7
export const MAX_UNIQUES = 7
export const HERO_MODES = ['packs', 'free']
export const SOURCE_TYPES = ['set', 'faction']
export const MAX_SET_WEIGHT = 3

/**
 * The set codes a config draws from, in `SETS` order (codes unknown to SETS after, in their
 * key order). Sorted here rather than trusted: a config read back from jsonb has its keys in
 * jsonb order (length, then bytes), not in the order validateTournamentConfig wrote them.
 */
export function configSetCodes(config) {
  const src = config.source
  if (src.type !== 'faction') return [src.setCode]
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
  let set = null
  let factionSets = {}
  if (isFaction) {
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
  } else if (src.type === 'set') {
    set = SETS.find(s => s.code === src.setCode && !s.hidden) ?? null
    if (!set) errors.push('source.setCode')
  }
  if (src.boosters !== undefined && src.boosters !== SEALED_BOOSTERS) errors.push('source.boosters')

  if (!HERO_MODES.includes(c.heroes)) errors.push('heroes')

  const u = c.uniques && typeof c.uniques === 'object' ? c.uniques : {}
  const inBoosters = toInt(u.inBoosters, 0)
  const guaranteed = toInt(u.guaranteed, 0)
  if (inBoosters === null || inBoosters < 0 || inBoosters > MAX_UNIQUES) errors.push('uniques.inBoosters')
  if (guaranteed === null || guaranteed < 0 || guaranteed > MAX_UNIQUES) errors.push('uniques.guaranteed')
  // A faction source forces both (spec §5): the client's values are ignored, never an error.
  if (!isFaction) {
    if (u.evenFactions !== undefined && typeof u.evenFactions !== 'boolean') errors.push('uniques.evenFactions')
    if (u.faction !== undefined && u.faction !== null && !FACTIONS.includes(u.faction)) errors.push('uniques.faction')
  }
  const wantsUniques = (inBoosters ?? 0) > 0 || (guaranteed ?? 0) > 0
  if (set && wantsUniques && !hasFactionRanges(set.code)) errors.push('uniques.unsupportedSet')
  if (isFaction && !errors.some(e => e.startsWith('source.')) && wantsUniques && !Object.keys(factionSets).some(hasFactionRanges)) errors.push('uniques.unsupportedSet')

  if (c.excludeBanlist !== undefined && typeof c.excludeBanlist !== 'boolean') errors.push('excludeBanlist')

  if (errors.length) return { ok: false, errors, config: null }
  const uniqueTotal = inBoosters + guaranteed
  const faction = isFaction ? (uniqueTotal > 0 ? src.faction : null) : uniqueTotal > 0 ? u.faction ?? null : null
  return {
    ok: true,
    errors: [],
    config: {
      v: CONFIG_VERSION,
      format: 'sealed',
      source: isFaction
        ? { type: 'faction', faction: src.faction, sets: factionSets, boosters: SEALED_BOOSTERS }
        : { type: 'set', setCode: set.code, boosters: SEALED_BOOSTERS },
      heroes: c.heroes,
      // Even factions only means something from 2 uniques on and without a single faction;
      // a stale "true" would still change the draw (evenFactionTargets consumes the rng) and
      // mislead the stored config. Same for a faction left over with no unique at all.
      uniques: { inBoosters, guaranteed, evenFactions: !!u.evenFactions && uniqueTotal >= 2 && !faction, faction },
      excludeBanlist: !!c.excludeBanlist,
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
