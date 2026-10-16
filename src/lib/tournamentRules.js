// Pure rules for user-created tournaments (docs/tournaments/user-tournaments-spec.md §3.2, §9).
// Shared by the API handlers (server) and the form (browser) — no DB, no React here.
import { parseBgaTournamentUrl } from './bgaUrl.js'

export const NAME_MIN = 3
export const NAME_MAX = 80
export const DESCRIPTION_MAX = 2000
export const MAX_OPEN_TOURNAMENTS = 10
export const OPEN_STATUSES = ['upcoming', 'ongoing']

const pick = (row, snake, camel) => row?.[snake] ?? row?.[camel] ?? null

/**
 * Derived status (never stored): cancelled > ended (manual close, or ends_at reached)
 * > ongoing (starts_at reached) > upcoming. Accepts DB rows (snake_case) and API JSON.
 */
export function tournamentStatus(row, now = new Date()) {
  if (pick(row, 'cancelled_at', 'cancelledAt')) return 'cancelled'
  if (pick(row, 'ended_at', 'endedAt')) return 'ended'
  const endsAt = pick(row, 'ends_at', 'endsAt')
  if (endsAt && now >= new Date(endsAt)) return 'ended'
  const startsAt = pick(row, 'starts_at', 'startsAt')
  if (startsAt && now >= new Date(startsAt)) return 'ongoing'
  return 'upcoming'
}

function parseDate(value) {
  if (value == null || value === '') return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Validates the non-config fields of a tournament payload. On create every field is
 * required; on patch (`isCreate` false) only the keys present in `body` are validated,
 * against `current` (the stored row) for the cross-field date checks.
 * @returns {{ ok: boolean, errors: Record<string, string>, values: object }}
 */
export function validateTournamentFields(body, { now = new Date(), isCreate = false, current = null } = {}) {
  const errors = {}
  const values = {}
  const has = key => body != null && Object.prototype.hasOwnProperty.call(body, key)

  if (isCreate || has('name')) {
    const name = String(body?.name ?? '').trim()
    if (name.length < NAME_MIN || name.length > NAME_MAX) errors.name = 'invalid_length'
    else values.name = name
  }

  if (isCreate || has('description')) {
    const description = String(body?.description ?? '').trim()
    if (description.length > DESCRIPTION_MAX) errors.description = 'too_long'
    else values.description = description
  }

  if (isCreate || has('startsAt')) {
    const d = parseDate(body?.startsAt)
    if (!d) errors.startsAt = 'invalid_date'
    else if (isCreate && d <= now) errors.startsAt = 'must_be_future'
    else values.startsAt = d
  }

  if (isCreate || has('endsAt')) {
    if (body?.endsAt == null || body.endsAt === '') {
      values.endsAt = null
    } else {
      const d = parseDate(body.endsAt)
      const startsAt = values.startsAt ?? (current ? parseDate(current.starts_at ?? current.startsAt) : null)
      if (!d) errors.endsAt = 'invalid_date'
      else if (startsAt && d <= startsAt) errors.endsAt = 'must_be_after_start'
      else values.endsAt = d
    }
  }

  // Moving the start past a stored end (when the patch doesn't touch the end) would make
  // the tournament "ended" before it starts.
  if (values.startsAt && !has('endsAt') && current) {
    const storedEnd = parseDate(current.ends_at ?? current.endsAt)
    if (storedEnd && storedEnd <= values.startsAt) errors.startsAt = 'must_be_before_end'
  }

  if (isCreate || has('bgaUrl')) {
    const parsed = parseBgaTournamentUrl(body?.bgaUrl)
    if (!parsed) errors.bgaUrl = 'invalid_bga_url'
    else {
      values.bgaUrl = parsed.url
      values.bgaTournamentId = parsed.id
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, values }
}
