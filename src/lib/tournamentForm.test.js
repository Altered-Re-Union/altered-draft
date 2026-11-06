import { describe, it, expect } from 'vitest'
import { tournamentFormIssues, followCapacity } from './tournamentForm.js'

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

  it('reports an invalid visibility under its own field, between the description and the link', () => {
    const issues = tournamentFormIssues({ body: { ...body, description: 'x'.repeat(2001), visibility: 'hidden', bgaUrl: 'nope' }, config, now: NOW, isCreate: true })
    expect(issues).toEqual([
      { field: 'description', code: 'too_long' },
      { field: 'visibility', code: 'invalid_visibility' },
      { field: 'bgaUrl', code: 'invalid_bga_url' },
    ])
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

describe('tournamentFormIssues (multiset source)', () => {
  it('reports a multiset split that does not reach 7 under the sets field', () => {
    const issues = tournamentFormIssues({ body, config: { ...config, source: { type: 'multiset', sets: { CYCLONE: 4 } } }, now: NOW, isCreate: true })
    expect(issues).toEqual([{ field: 'sets', code: 'required' }])
  })
  it('reports the in-booster cap under the uniques field', () => {
    const issues = tournamentFormIssues({ body, config: { source: { type: 'multiset', sets: { CYCLONE: 1, FUGUE: 6 } }, heroes: 'packs', uniques: { inBoosters: 4, guaranteed: 0 } }, now: NOW, isCreate: true })
    expect(issues).toEqual([{ field: 'uniques', code: 'uniques.inBoosters' }])
  })
  it('accepts a valid multiset split and random mode', () => {
    expect(tournamentFormIssues({ body, config: { source: { type: 'multiset', sets: { CYCLONE: 4, EOLE: 3 } }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 1, randomOneIn: 8 } }, now: NOW, isCreate: true })).toEqual([])
  })
})

describe('tournamentFormIssues (BGA tournament already played with mixed legacy formats)', () => {
  it('blocks the link when its legacy pools have mixed formats', () => {
    const mixedBgaIds = new Set(['7'])
    expect(tournamentFormIssues({ body, config, now: NOW, isCreate: true, mixedBgaIds })).toEqual([{ field: 'bgaUrl', code: 'mixed_formats' }])
    expect(tournamentFormIssues({ body: { ...body, bgaUrl: 'https://boardgamearena.com/tournament?id=8' }, config, now: NOW, isCreate: true, mixedBgaIds })).toEqual([])
  })

  describe('cube and player cap', () => {
    const cube = over => ({
      format: 'sealed', heroes: 'packs', uniques: {}, excludeBanlist: false,
      source: { type: 'cube', name: 'My cube', origin: 'paste', cubeId: null, cards: { ALT_CORE_B_AX_01_C: 1 }, heroPool: ['ALT_CORE_B_BR_01_C'], boosters: 7, cardsPerBooster: 12, perFaction: 1, ...over },
    })
    const run = (cfg, extra = {}) => tournamentFormIssues({ body: { ...body, maxPlayers: 4 }, config: cfg, now: NOW, isCreate: true, ...extra })

    it('asks for the cube cards', () => {
      expect(run(cube({ cards: {} }))).toEqual([{ field: 'cube', code: 'required' }])
    })
    it('flags a too small pool under the cube settings', () => {
      expect(run(cube({ boosters: 3, cardsPerBooster: 10 }))).toEqual([{ field: 'cubeSettings', code: 'source.poolSize' }])
    })
    it('asks for a hero pool', () => {
      expect(run(cube({ heroPool: [] }))).toEqual([{ field: 'heroPool', code: 'required' }])
    })
    it('requires a cap for a valid cube', () => {
      expect(run(cube(), { body: { ...body, maxPlayers: null } })).toEqual([{ field: 'maxPlayers', code: 'required_for_cube' }])
    })
    it('reports a capacity below 2 under the cube, before the cap', () => {
      expect(run(cube(), { capacity: { players: 1 } })).toEqual([{ field: 'cube', code: 'source.capacity' }])
      expect(run(cube(), { capacity: { players: 1 }, body: { ...body, maxPlayers: null } })).toEqual([
        { field: 'cube', code: 'source.capacity' }, { field: 'maxPlayers', code: 'required_for_cube' },
      ])
    })
    it('flags a cap above the capacity', () => {
      expect(run(cube(), { capacity: { players: 3 } })).toEqual([{ field: 'maxPlayers', code: 'above_capacity' }])
    })
    it('flags a cap below the pool count on another source', () => {
      expect(tournamentFormIssues({ body: { ...body, maxPlayers: 2 }, config, now: NOW, isCreate: true, poolCount: 3 }))
        .toEqual([{ field: 'maxPlayers', code: 'below_pool_count' }])
    })
  })
})

describe('followCapacity', () => {
  const cap = n => ({ players: n })
  it('an untouched field takes the capacity, up and down', () => {
    expect(followCapacity('', cap(2), false)).toBe(2)
    expect(followCapacity(2, cap(3), false)).toBe(3)
    expect(followCapacity(3, cap(2), false)).toBe(2)
  })
  it('a field the organizer changed is only lowered to the capacity, never raised or refilled', () => {
    expect(followCapacity(2, cap(3), true)).toBe(2)
    expect(followCapacity('2', cap(3), true)).toBe('2')
    expect(followCapacity(4, cap(3), true)).toBe(3)
    expect(followCapacity('', cap(3), true)).toBe('')
  })
  it('no capacity, or one below 2: the field is left as is', () => {
    expect(followCapacity(2, null, false)).toBe(2)
    expect(followCapacity(2, cap(1), false)).toBe(2)
    expect(followCapacity(5, cap(0), true)).toBe(5)
  })
})
