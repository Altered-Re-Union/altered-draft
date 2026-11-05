import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { configSummaryParts, PrivateBadge } from './TournamentBits.jsx'
import { SETS } from '../lib/cardData.js'
const t = (key, vars = {}) => `${key}${Object.keys(vars).length ? ' ' + JSON.stringify(vars) : ''}`
const tc = (key, n) => `${key} ${n}`
const faction = sets => ({ v: 1, format: 'sealed', source: { type: 'faction', faction: 'AX', sets, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 1, guaranteed: 0, evenFactions: false, faction: 'AX' }, excludeBanlist: false })
describe('configSummaryParts', () => {
  it('names the faction and "all sets" when every visible set is at ×1, without the redundant uniques-faction part', () => {
    const parts = configSummaryParts(faction(Object.fromEntries(SETS.filter(s => !s.hidden).map(s => [s.code, 1]))), t, tc)
    expect(parts[0]).toEqual({ text: 'tournaments.summaryBoostersCount {"n":7}' })
    expect(parts[1]).toMatchObject({ text: 'tournaments.summaryFactionMix {"faction":"Axiom"}' })
    expect(parts[1].icon).toBeTruthy()
    expect(parts[2]).toEqual({ text: 'tournaments.summaryAllSets' })
    expect(parts.some(p => p.text.includes('tournaments.summaryFaction '))).toBe(false)
    expect(parts.map(p => p.text)).toContain('tournaments.summaryUniquesIn 1')
  })
  it('lists the included sets by abbreviation with ×n for weights above 1', () => {
    expect(configSummaryParts(faction({ CORE: 1, BISE: 2, EOLE: 1 }), t, tc)[2]).toEqual({ text: 'BTG, WTM ×2, ROC' })
  })
  it('tells the legacy (whole-card) ban list apart from the current one', () => {
    const set = over => ({ source: { type: 'set', setCode: 'CYCLONE', boosters: 7 }, uniques: {}, heroes: 'packs', ...over })
    const texts = over => configSummaryParts(set(over), t, tc).map(p => p.text)
    expect(texts({ excludeBanlist: true })).toContain('tournaments.summaryBanlistLegacy')
    expect(texts({ excludeBanlist: true, banlist: 'v2' })).toContain('tournaments.summaryBanlist')
    expect(texts({ excludeBanlist: true, banlist: 'v2' })).not.toContain('tournaments.summaryBanlistLegacy')
    expect(texts({ excludeBanlist: false }).some(x => x.startsWith('tournaments.summaryBanlist'))).toBe(false)
  })
  it('keeps the single-set summary unchanged', () => {
    const parts = configSummaryParts({ source: { type: 'set', setCode: 'CYCLONE', boosters: 7 }, uniques: {}, heroes: 'packs' }, t, tc)
    expect(parts[0].text).toBe('tournaments.summaryBoosters {"n":7,"set":"Skybound Odyssey"}')
  })
  const multi = (sets, uniques = {}) => ({ v: 1, format: 'sealed', source: { type: 'multiset', sets, boosters: 7 }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null, ...uniques }, excludeBanlist: false })
  it('lists a multi-set split by abbreviation with ×n above 1', () => {
    const parts = configSummaryParts(multi({ EOLE: 3, CYCLONE: 3, FUGUE: 1 }), t, tc)
    expect(parts[0]).toEqual({ text: 'tournaments.summaryBoostersCount {"n":7}' })
    expect(parts[1]).toEqual({ text: 'SKY ×3, ROC ×3, NEJ' })
  })
  it('says one unique in N boosters in random mode, every booster at 1, and drops the even part', () => {
    expect(configSummaryParts(multi({ CYCLONE: 7 }, { randomOneIn: 8, guaranteed: 1, evenFactions: true }), t, tc).map(p => p.text))
      .toEqual(['tournaments.summaryBoostersCount {"n":7}', 'SKY ×7', 'tournaments.summaryUniquesRandom {"n":8}', 'tournaments.summaryUniquesOut 1'])
    expect(configSummaryParts({ source: { type: 'set', setCode: 'CYCLONE', boosters: 7 }, uniques: { randomOneIn: 1 }, heroes: 'packs' }, t, tc).map(p => p.text))
      .toEqual(['tournaments.summaryBoosters {"n":7,"set":"Skybound Odyssey"}', 'tournaments.summaryUniquesEvery'])
  })
  it('keeps the uniques faction part in random mode even with no guaranteed unique', () => {
    const texts = configSummaryParts(multi({ CYCLONE: 7 }, { randomOneIn: 8, faction: 'AX' }), t, tc).map(p => p.text)
    expect(texts).toContain('tournaments.summaryFaction {"faction":"Axiom"}')
  })
})

describe('PrivateBadge', () => {
  it('a labelled, titled pill with an aria-hidden icon', () => {
    const html = renderToStaticMarkup(createElement(PrivateBadge, { t }))
    expect(html).toContain('data-testid="tournament-private"')
    expect(html).toContain('title="tournaments.privateBadgeTitle"')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('tournaments.privateBadge<')
  })
})
