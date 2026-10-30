import { describe, it, expect } from 'vitest'
import { configSummaryParts } from './TournamentBits.jsx'
const t = (key, vars = {}) => `${key}${Object.keys(vars).length ? ' ' + JSON.stringify(vars) : ''}`
const tc = (key, n) => `${key} ${n}`
const faction = sets => ({ v: 1, format: 'sealed', source: { type: 'faction', faction: 'AX', sets, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 1, guaranteed: 0, evenFactions: false, faction: 'AX' }, excludeBanlist: false })
describe('configSummaryParts', () => {
  it('names the faction and "all sets" when every visible set is at ×1, without the redundant uniques-faction part', () => {
    const parts = configSummaryParts(faction({ CORE: 1, ALIZE: 1, BISE: 1, CYCLONE: 1, DUSTER: 1, EOLE: 1, FUGUE: 1 }), t, tc)
    expect(parts[0]).toMatchObject({ text: 'tournaments.summaryBoostersFaction {"n":7,"faction":"Axiom"}' })
    expect(parts[0].icon).toBeTruthy()
    expect(parts[1]).toEqual({ text: 'tournaments.summaryAllSets' })
    expect(parts.some(p => p.text.includes('summaryFaction'))).toBe(false)
    expect(parts.map(p => p.text)).toContain('tournaments.summaryUniquesIn 1')
  })
  it('lists the included sets by abbreviation with ×n for weights above 1', () => {
    expect(configSummaryParts(faction({ CORE: 1, BISE: 2, EOLE: 1 }), t, tc)[1]).toEqual({ text: 'BTG, WTM ×2, ROC' })
  })
  it('keeps the single-set summary unchanged', () => {
    const parts = configSummaryParts({ source: { type: 'set', setCode: 'CYCLONE', boosters: 7 }, uniques: {}, heroes: 'packs' }, t, tc)
    expect(parts[0].text).toBe('tournaments.summaryBoosters {"n":7,"set":"Skybound Odyssey"}')
  })
})
