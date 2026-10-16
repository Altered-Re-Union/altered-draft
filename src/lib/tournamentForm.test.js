import { describe, it, expect } from 'vitest'
import { tournamentFormIssues } from './tournamentForm.js'

const NOW = new Date('2026-11-01T12:00:00Z')
const config = { source: { type: 'set', setCode: 'CYCLONE' }, heroes: 'packs', uniques: { inBoosters: 1, guaranteed: 1 } }
const body = { name: 'Winter Cup', description: '', bgaUrl: 'https://boardgamearena.com/tournament?id=7', startsAt: '2026-11-02T19:00:00Z', endsAt: null }

describe('tournamentFormIssues', () => {
  it('returns nothing for a valid create form', () => {
    expect(tournamentFormIssues({ body, config, now: NOW, isCreate: true })).toEqual([])
  })

  it('lists every problem in form order, each with its field and code', () => {
    const issues = tournamentFormIssues({
      body: { ...body, name: 'ab', bgaUrl: 'nope', startsAt: '2026-10-30T19:00:00Z' },
      config: { ...config, source: { type: 'set', setCode: null } },
      now: NOW, isCreate: true,
    })
    expect(issues).toEqual([
      { field: 'name', code: 'invalid_length' },
      { field: 'bgaUrl', code: 'invalid_bga_url' },
      { field: 'startsAt', code: 'must_be_future' },
      { field: 'setCode', code: 'required' },
    ])
  })

  it('flags an end before the start', () => {
    expect(tournamentFormIssues({ body: { ...body, endsAt: '2026-11-02T18:00:00Z' }, config, now: NOW, isCreate: true }))
      .toEqual([{ field: 'endsAt', code: 'must_be_after_start' }])
  })

  it('flags a BGA link already declared by another tournament, but not by the tournament being edited', () => {
    const taken = new Map([['7', 'other-id']])
    expect(tournamentFormIssues({ body, config, now: NOW, isCreate: true, takenBgaIds: taken }))
      .toEqual([{ field: 'bgaUrl', code: 'taken' }])
    expect(tournamentFormIssues({ body, config, now: NOW, isCreate: false, takenBgaIds: taken, ownId: 'other-id' })).toEqual([])
  })

  it('ignores the config and the link when the tournament is locked (they are not sent)', () => {
    const issues = tournamentFormIssues({
      body: { ...body, bgaUrl: 'nope' }, config: { ...config, source: { type: 'set', setCode: null } },
      now: NOW, isCreate: false, locked: true,
    })
    expect(issues).toEqual([])
  })

  it('allows a past start when editing', () => {
    expect(tournamentFormIssues({ body: { ...body, startsAt: '2026-10-30T19:00:00Z' }, config, now: NOW, isCreate: false })).toEqual([])
  })

  it('reports a config problem other than the set as a generic config issue', () => {
    expect(tournamentFormIssues({ body, config: { ...config, source: { type: 'set', setCode: 'FUGUE' } }, now: NOW, isCreate: true }))
      .toEqual([{ field: 'uniques', code: 'uniques.unsupportedSet' }])
  })
})
