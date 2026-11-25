import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./cardData.js', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, fetchSet: vi.fn() }
})

import { fetchSet, FACTIONS } from './cardData.js'
import { loadAllHeroes, _resetHeroCatalog } from './heroCatalog.js'

const hero = (set, f, n, extra = {}) => ({
  reference: `ALT_${set}_B_${f}_${n}_C`, name: `Hero ${f}${n}`, faction: f, cardType: 'HERO', rarity: 'C', ...extra,
})

describe('loadAllHeroes', () => {
  beforeEach(() => { _resetHeroCatalog(); fetchSet.mockReset() })

  it('returns one entry per hero, deduplicated, no unique, sorted by faction then name', async () => {
    fetchSet.mockImplementation(async code => {
      if (code === 'CORE') return [
        ...[...FACTIONS].reverse().map(f => hero('CORE', f, '02')),
        hero('CORE', 'AX', '02'), // duplicate reference
        hero('CORE', 'AX', '09', { rarity: 'U' }),
        { reference: 'ALT_CORE_B_AX_05_C', name: 'A spell', faction: 'AX', cardType: 'SPELL', rarity: 'C' },
      ]
      if (code === 'ALIZE') return FACTIONS.map(f => hero('ALIZE', f, '01'))
      return []
    })
    const heroes = await loadAllHeroes()
    expect(heroes).toHaveLength(12)
    expect(new Set(heroes.map(h => h.ref)).size).toBe(12)
    expect(heroes.map(h => h.faction)).toEqual(FACTIONS.flatMap(f => [f, f]))
    expect(heroes[0]).toEqual({ ref: 'ALT_ALIZE_B_AX_01_C', name: 'Hero AX01', faction: 'AX', set: 'ALIZE' })
    expect(heroes[1].ref).toBe('ALT_CORE_B_AX_02_C')
  })

  it('memoizes per language', async () => {
    fetchSet.mockResolvedValue([hero('CORE', 'AX', '02')])
    await loadAllHeroes()
    const calls = fetchSet.mock.calls.length
    await loadAllHeroes()
    expect(fetchSet.mock.calls.length).toBe(calls)
    await loadAllHeroes('FR')
    expect(fetchSet.mock.calls.length).toBeGreaterThan(calls)
  })
})
