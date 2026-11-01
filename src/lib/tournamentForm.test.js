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

  it('puts a crossed-dates error under the start when the start was edited last', () => {
    const crossed = { ...body, startsAt: '2026-11-12T19:00:00Z', endsAt: '2026-11-11T19:00:00Z' }
    expect(tournamentFormIssues({ body: crossed, config, now: NOW, isCreate: false, lastDateEdited: 'startsAt' }))
      .toEqual([{ field: 'startsAt', code: 'must_be_before_end' }])
    expect(tournamentFormIssues({ body: crossed, config, now: NOW, isCreate: false, lastDateEdited: 'endsAt' }))
      .toEqual([{ field: 'endsAt', code: 'must_be_after_start' }])
  })

  it('keeps a start error of its own over the crossed-dates one', () => {
    const crossed = { ...body, startsAt: '2026-10-30T19:00:00Z', endsAt: '2026-10-29T19:00:00Z' }
    expect(tournamentFormIssues({ body: crossed, config, now: NOW, isCreate: true, lastDateEdited: 'startsAt' }))
      .toEqual([{ field: 'startsAt', code: 'must_be_future' }])
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

  it('reports an unknown unique faction on the uniques field', () => {
    expect(tournamentFormIssues({ body, config: { ...config, uniques: { ...config.uniques, faction: 'XX' } }, now: NOW, isCreate: true }))
      .toEqual([{ field: 'uniques', code: 'uniques.faction' }])
  })
})

describe('tournamentFormIssues (faction source)', () => {
  const factionConfig = { source: { type: 'faction', faction: null, sets: {} }, heroes: 'packs', uniques: { inBoosters: 1, guaranteed: 1 } }
  it('reports a missing faction and empty weights under their own fields, in form order', () => {
    expect(tournamentFormIssues({ body, config: factionConfig, now: NOW, isCreate: true })).toEqual([
      { field: 'faction', code: 'required' }, { field: 'sets', code: 'required' },
    ])
  })
  it('reports unsupported uniques for a faction source under uniques', () => {
    const config = { ...factionConfig, source: { type: 'faction', faction: 'AX', sets: { FUGUE: 1 } } }
    expect(tournamentFormIssues({ body, config, now: NOW, isCreate: true })).toEqual([{ field: 'uniques', code: 'uniques.unsupportedSet' }])
  })
})

describe('tournamentFormIssues (BGA tournament already played with mixed legacy formats)', () => {
  it('blocks the link when its legacy pools have mixed formats', () => {
    const mixedBgaIds = new Set(['7'])
    expect(tournamentFormIssues({ body, config, now: NOW, isCreate: true, mixedBgaIds })).toEqual([{ field: 'bgaUrl', code: 'mixed_formats' }])
    expect(tournamentFormIssues({ body: { ...body, bgaUrl: 'https://boardgamearena.com/tournament?id=8' }, config, now: NOW, isCreate: true, mixedBgaIds })).toEqual([])
  })
})
