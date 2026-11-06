// Live validation of the tournament form (TournamentForm.jsx): the same pure checks the
// API runs (tournamentRules / tournamentConfig), plus the duplicate-link check against the
// tournaments already declared, flattened into one ordered list the page can show next to
// the submit button. Pure: no React, no fetch.
import { validateTournamentFields } from './tournamentRules.js'
import { validateTournamentConfig } from './tournamentConfig.js'
import { parseBgaTournamentUrl } from './bgaUrl.js'
import { checkPlayerCap } from './cubeSealed.js'

// Display order = order of the fields on the page.
const FIELD_ORDER = ['name', 'description', 'visibility', 'bgaUrl', 'startsAt', 'endsAt', 'setCode', 'faction', 'sets', 'uniques', 'cube', 'cubeSettings', 'heroPool', 'maxPlayers']

/**
 * @param {object} p
 * @param {object} p.body - { name, description, bgaUrl, startsAt, endsAt } as the API receives it
 * @param {object} p.config - the config object the form would send
 * @param {{ players: number } | null} [p.capacity] - the cube's capacity (cubeCapacity), when known
 * @param {number} [p.poolCount] - pools already created (a non-cube cap may not go below)
 * @param {Date} [p.now]
 * @param {boolean} p.isCreate - create mode (start must be in the future, every field required)
 * @param {boolean} [p.locked] - pools exist: the link and the config are not sent, so not checked
 * @param {Map<string, string>} [p.takenBgaIds] - BGA id -> id of the live tournament declaring it
 * @param {string|null} [p.ownId] - the tournament being edited (its own link is not "taken")
 * @param {Set<string>} [p.mixedBgaIds] - BGA ids already played with legacy pools of different formats (refused)
 * @param {'startsAt'|'endsAt'|null} [p.lastDateEdited] - the date field the user changed last: crossed
 *   dates are reported under it (a start moved past the end is the start's problem)
 * @returns {{ field: string, code: string }[]}
 */
export function tournamentFormIssues({ body, config, now = new Date(), isCreate, locked = false, takenBgaIds = null, ownId = null, mixedBgaIds = null, lastDateEdited = null, capacity = null, poolCount = 0 }) {
  const issues = []
  const checked = { ...body }
  if (locked) delete checked.bgaUrl
  const fields = validateTournamentFields(checked, { now, isCreate, current: null })
  if (lastDateEdited === 'startsAt' && fields.errors.endsAt === 'must_be_after_start') {
    delete fields.errors.endsAt
    fields.errors.startsAt = 'must_be_before_end'
  }
  for (const [field, code] of Object.entries(fields.errors)) issues.push({ field, code })

  if (!locked && !fields.errors.bgaUrl && takenBgaIds) {
    const parsed = parseBgaTournamentUrl(body.bgaUrl)
    const holder = parsed && takenBgaIds.get(parsed.id)
    if (holder && holder !== ownId) issues.push({ field: 'bgaUrl', code: 'taken' })
  }
  if (!locked && !fields.errors.bgaUrl && mixedBgaIds?.size) {
    const parsed = parseBgaTournamentUrl(body.bgaUrl)
    if (parsed && mixedBgaIds.has(parsed.id)) issues.push({ field: 'bgaUrl', code: 'mixed_formats' })
  }

  let cfgOk = true
  if (!locked) {
    const cfg = validateTournamentConfig(config)
    cfgOk = cfg.ok
    if (cfg.errors.includes('source.setCode')) issues.push({ field: 'setCode', code: 'required' })
    if (cfg.errors.includes('source.faction')) issues.push({ field: 'faction', code: 'required' })
    if (cfg.errors.includes('source.sets')) issues.push({ field: 'sets', code: 'required' })
    const isCube = config?.source?.type === 'cube'
    const cubeSettings = ['source.poolSize', 'source.perFaction', 'source.boosters', 'source.cardsPerBooster']
    if (isCube) {
      if (cfg.errors.includes('source.cards') || cfg.errors.includes('source.name')) issues.push({ field: 'cube', code: 'required' })
      for (const code of cubeSettings) if (cfg.errors.includes(code)) issues.push({ field: 'cubeSettings', code })
      if (cfg.errors.includes('source.heroPool')) issues.push({ field: 'heroPool', code: 'required' })
    }
    const handled = ['source.setCode', 'source.faction', 'source.sets', ...(isCube ? ['source.cards', 'source.name', 'source.heroPool', ...cubeSettings] : [])]
    const other = cfg.errors.filter(e => !handled.includes(e))
    if (other.length) issues.push({ field: 'uniques', code: other[0] })
  }

  // The player cap is a tournament field, not config: checked even on a locked form (a non-cube
  // cap stays editable); a cube's cap is locked with its config, so it is not checked then.
  const cubeCap = config?.source?.type === 'cube'
  if (!fields.errors.maxPlayers && !(cubeCap && (locked || !cfgOk))) {
    const cap = checkPlayerCap({ source: config?.source, maxPlayers: fields.values.maxPlayers ?? body?.maxPlayers ?? null, capacity: locked ? null : capacity, poolCount })
    if (cap.fields.maxPlayers) issues.push({ field: 'maxPlayers', code: cap.fields.maxPlayers })
    for (const code of cap.config) issues.push({ field: 'cube', code })
  }

  return issues.sort((a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field))
}
