// The sealed configuration object of a tournament (docs/tournaments/user-tournaments-spec.md
// §5.1). One shape for declared tournaments, for the legacy `current_format` (converted on
// read) and, from lot 2 on, for the Lobby. Pure: shared by server validation and the form.
import { SETS } from './cardData.js'
import { hasFactionRanges } from './uniqueFactionRanges.js'

export const CONFIG_VERSION = 1
export const SEALED_BOOSTERS = 7
export const MAX_UNIQUES = 7
export const HERO_MODES = ['packs', 'free']

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
  if (src.type !== 'set') errors.push('source.type')
  const set = SETS.find(s => s.code === src.setCode && !s.hidden) ?? null
  if (!set) errors.push('source.setCode')
  if (src.boosters !== undefined && src.boosters !== SEALED_BOOSTERS) errors.push('source.boosters')

  if (!HERO_MODES.includes(c.heroes)) errors.push('heroes')

  const u = c.uniques && typeof c.uniques === 'object' ? c.uniques : {}
  const inBoosters = toInt(u.inBoosters, 0)
  const guaranteed = toInt(u.guaranteed, 0)
  if (inBoosters === null || inBoosters < 0 || inBoosters > MAX_UNIQUES) errors.push('uniques.inBoosters')
  if (guaranteed === null || guaranteed < 0 || guaranteed > MAX_UNIQUES) errors.push('uniques.guaranteed')
  if (u.evenFactions !== undefined && typeof u.evenFactions !== 'boolean') errors.push('uniques.evenFactions')
  if (set && ((inBoosters ?? 0) > 0 || (guaranteed ?? 0) > 0) && !hasFactionRanges(set.code)) errors.push('uniques.unsupportedSet')

  if (c.excludeBanlist !== undefined && typeof c.excludeBanlist !== 'boolean') errors.push('excludeBanlist')

  if (errors.length) return { ok: false, errors, config: null }
  return {
    ok: true,
    errors: [],
    config: {
      v: CONFIG_VERSION,
      format: 'sealed',
      source: { type: 'set', setCode: set.code, boosters: SEALED_BOOSTERS },
      heroes: c.heroes,
      uniques: { inBoosters, guaranteed, evenFactions: !!u.evenFactions },
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
    set_code: config.source.setCode,
    unique_count: config.uniques.inBoosters,
    even_factions: config.uniques.evenFactions,
    heroes_in_pool: config.heroes === 'packs',
    guaranteed_uniques: config.uniques.guaranteed,
  }
}
