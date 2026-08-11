import { describe, it, expect } from 'vitest'
import { buildDecklist, groupPicksByFaction } from './exportFormat.js'

const cardMap = {
  HERO_AX: { reference: 'HERO_AX', name: 'Sierra', cardType: 'HERO', faction: 'AX' },
  AX_COMMON_B: { reference: 'AX_COMMON_B', name: 'Barbarian', cardType: 'CHARACTER', faction: 'AX' },
  AX_COMMON_A: { reference: 'AX_COMMON_A', name: 'Anchorite', cardType: 'CHARACTER', faction: 'AX' },
  BR_RARE: { reference: 'BR_RARE', name: 'Cutlass', cardType: 'SPELL', faction: 'BR' },
  UNKNOWN_FACTION: { reference: 'UNKNOWN_FACTION', name: 'Oddity', cardType: 'CHARACTER', faction: 'ZZ' },
}

describe('buildDecklist', () => {
  it('puts the hero first, then groups by faction (in FACTIONS order), sorted by name', () => {
    const picks = ['AX_COMMON_B', 'HERO_AX', 'BR_RARE', 'AX_COMMON_A']
    const lines = buildDecklist(picks, cardMap).split('\n')
    expect(lines).toEqual([
      '1 HERO_AX',
      '1 AX_COMMON_A', // Anchorite before Barbarian alphabetically
      '1 AX_COMMON_B',
      '1 BR_RARE',
    ])
  })

  it('aggregates quantities for duplicate refs', () => {
    const picks = ['AX_COMMON_B', 'AX_COMMON_B', 'AX_COMMON_B']
    expect(buildDecklist(picks, cardMap)).toBe('3 AX_COMMON_B')
  })

  it('silently skips refs missing from the card map', () => {
    const picks = ['AX_COMMON_B', 'NOT_IN_MAP']
    expect(buildDecklist(picks, cardMap)).toBe('1 AX_COMMON_B')
  })

  it('appends non-standard factions after the standard faction groups', () => {
    const picks = ['UNKNOWN_FACTION', 'AX_COMMON_B']
    const lines = buildDecklist(picks, cardMap).split('\n')
    expect(lines).toEqual(['1 AX_COMMON_B', '1 UNKNOWN_FACTION'])
  })

  it('returns an empty string for no picks', () => {
    expect(buildDecklist([], cardMap)).toBe('')
  })
})

describe('groupPicksByFaction', () => {
  it('groups heroes under a HERO key regardless of their faction', () => {
    const result = groupPicksByFaction(['HERO_AX', 'AX_COMMON_B'], cardMap)
    expect(result.HERO).toEqual({ HERO_AX: 1 })
    expect(result.AX).toEqual({ AX_COMMON_B: 1 })
  })

  it('counts duplicate refs within their faction group', () => {
    const result = groupPicksByFaction(['AX_COMMON_B', 'AX_COMMON_B', 'BR_RARE'], cardMap)
    expect(result.AX).toEqual({ AX_COMMON_B: 2 })
    expect(result.BR).toEqual({ BR_RARE: 1 })
  })

  it('skips refs missing from the card map', () => {
    const result = groupPicksByFaction(['NOT_IN_MAP'], cardMap)
    expect(result).toEqual({})
  })
})
