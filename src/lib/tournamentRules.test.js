import { describe, it, expect } from 'vitest'
import { tournamentStatus, validateTournamentFields } from './tournamentRules.js'

const NOW = new Date('2026-11-01T12:00:00Z')
const later = '2026-11-02T19:00:00Z'
const earlier = '2026-10-30T19:00:00Z'

describe('tournamentStatus', () => {
  it('derives upcoming / ongoing / ended / cancelled, cancelled winning over everything', () => {
    expect(tournamentStatus({ starts_at: later }, NOW)).toBe('upcoming')
    expect(tournamentStatus({ starts_at: earlier }, NOW)).toBe('ongoing')
    expect(tournamentStatus({ starts_at: earlier, ends_at: '2026-10-31T00:00:00Z' }, NOW)).toBe('ended')
    expect(tournamentStatus({ starts_at: earlier, ends_at: later }, NOW)).toBe('ongoing')
    expect(tournamentStatus({ starts_at: later, ended_at: earlier }, NOW)).toBe('ended')
    expect(tournamentStatus({ starts_at: earlier, ended_at: earlier, cancelled_at: earlier }, NOW)).toBe('cancelled')
  })

  it('accepts camelCase JSON rows too', () => {
    expect(tournamentStatus({ startsAt: later, cancelledAt: null }, NOW)).toBe('upcoming')
    expect(tournamentStatus({ startsAt: later, cancelledAt: earlier }, NOW)).toBe('cancelled')
  })
})

describe('validateTournamentFields (create)', () => {
  const good = { name: '  Winter Cup ', description: 'd', startsAt: later, endsAt: null, bgaUrl: 'https://boardgamearena.com/tournament?id=7' }

  it('normalizes a valid payload', () => {
    const r = validateTournamentFields(good, { now: NOW, isCreate: true })
    expect(r.ok).toBe(true)
    expect(r.values).toEqual({
      name: 'Winter Cup', description: 'd', startsAt: new Date(later), endsAt: null,
      bgaUrl: 'https://boardgamearena.com/tournament?id=7', bgaTournamentId: '7',
    })
  })

  it('requires every field on create and reports each error by field', () => {
    const r = validateTournamentFields({}, { now: NOW, isCreate: true })
    expect(r.ok).toBe(false)
    expect(r.errors).toEqual({ name: 'invalid_length', startsAt: 'invalid_date', bgaUrl: 'invalid_bga_url' })
  })

  it('rejects a start in the past on create, a too-long name/description, an end before the start', () => {
    expect(validateTournamentFields({ ...good, startsAt: earlier }, { now: NOW, isCreate: true }).errors.startsAt).toBe('must_be_future')
    expect(validateTournamentFields({ ...good, name: 'ab' }, { now: NOW, isCreate: true }).errors.name).toBe('invalid_length')
    expect(validateTournamentFields({ ...good, name: 'x'.repeat(81) }, { now: NOW, isCreate: true }).errors.name).toBe('invalid_length')
    expect(validateTournamentFields({ ...good, description: 'x'.repeat(2001) }, { now: NOW, isCreate: true }).errors.description).toBe('too_long')
    expect(validateTournamentFields({ ...good, endsAt: '2026-11-02T18:00:00Z' }, { now: NOW, isCreate: true }).errors.endsAt).toBe('must_be_after_start')
  })
})

describe('validateTournamentFields (patch)', () => {
  const current = { starts_at: later, ends_at: '2026-11-10T00:00:00Z' }

  it('validates only the keys present, and allows a past start on edit', () => {
    const r = validateTournamentFields({ name: 'Renamed' }, { now: NOW, current })
    expect(r).toEqual({ ok: true, errors: {}, values: { name: 'Renamed' } })
    expect(validateTournamentFields({ startsAt: earlier }, { now: NOW, current }).ok).toBe(true)
  })

  it('rejects endsAt before the stored startsAt, and startsAt after the stored endsAt', () => {
    expect(validateTournamentFields({ endsAt: '2026-11-02T18:00:00Z' }, { now: NOW, current }).errors.endsAt).toBe('must_be_after_start')
    expect(validateTournamentFields({ startsAt: '2026-11-11T00:00:00Z' }, { now: NOW, current }).errors.startsAt).toBe('must_be_before_end')
  })

  it('treats an empty endsAt as clearing it', () => {
    expect(validateTournamentFields({ endsAt: '' }, { now: NOW, current }).values).toEqual({ endsAt: null })
  })
})

describe('tournamentStatus (detached)', () => {
  it('reports detached above every other state, for rows and JSON', () => {
    expect(tournamentStatus({ starts_at: later, cancelled_at: earlier, detached_at: earlier }, NOW)).toBe('detached')
    expect(tournamentStatus({ startsAt: earlier, detachedAt: earlier }, NOW)).toBe('detached')
  })
})
