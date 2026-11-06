import { describe, it, expect, vi } from 'vitest'
import { resolveRefs, resolveCubeSource } from './cubeSource.js'

const card = (reference, faction) => ({ reference, faction, cardType: 'CHARACTER' })
const hero = reference => ({ reference, faction: 'AX', cardType: 'HERO' })
const unique = (reference, faction) => ({ reference, faction, cardType: 'CHARACTER', rarity: 'U' })

const fetchSet = vi.fn(async code => code === 'CORE'
  ? [hero('ALT_CORE_B_AX_01_C'), card('ALT_CORE_B_AX_02_C', 'AX'), card('ALT_CORE_B_YZ_45_R2', 'AX')]
  : code === 'BISE' ? [card('ALT_BISE_B_BR_01_C', 'BR')] : [])
const fetchUniques = vi.fn(async refs => refs.map(r => r === 'ALT_CORE_B_AX_04_U_1437' ? unique(r, 'AX')
  : r === 'ALT_BISE_P_BR_64_C' ? card(r, 'BR')
  : { reference: r, faction: 'XX', cardType: '', synthetic: true }))

describe('cubeSource', () => {
  it('resolveRefs: canonical B when it exists, by reference otherwise, unresolved as given', async () => {
    fetchSet.mockClear(); fetchUniques.mockClear()
    const r = await resolveRefs(['ALT_CORE_A_AX_02_C', 'ALT_CORE_B_AX_02_C', 'ALT_BISE_P_BR_64_C', 'ALT_CORE_B_AX_04_U_1437', 'ALT_CORE_B_AX_99_C', 'ALT_NOPE_B_AX_01_C', 'ALT_CORE_B_AX_04_U_999999999'], { fetchSet, fetchUniques })
    expect(r.byRef.get('ALT_CORE_A_AX_02_C').ref).toBe('ALT_CORE_B_AX_02_C')
    expect(r.byRef.get('ALT_BISE_P_BR_64_C').ref).toBe('ALT_BISE_P_BR_64_C')
    expect(r.byRef.get('ALT_CORE_B_AX_04_U_1437').card.faction).toBe('AX')
    expect(r.unresolved).toEqual(['ALT_CORE_B_AX_99_C', 'ALT_NOPE_B_AX_01_C', 'ALT_CORE_B_AX_04_U_999999999'])
    expect(fetchSet).toHaveBeenCalledTimes(2)
    expect(fetchUniques).toHaveBeenCalledTimes(1)
    expect(fetchUniques.mock.calls[0][0]).toEqual(['ALT_BISE_P_BR_64_C', 'ALT_CORE_B_AX_04_U_1437', 'ALT_CORE_B_AX_04_U_999999999'])
  })
  it('resolveCubeSource: real factions, merged quantities, the stored source, the unresolved list', async () => {
    const r = await resolveCubeSource({ cards: { ALT_CORE_B_AX_02_C: 2, ALT_CORE_A_AX_02_C: 1, ALT_CORE_B_YZ_45_R2: 1, ALT_BISE_P_BR_64_C: 1, ALT_CORE_B_AX_04_U_1437: 1, ALT_CORE_B_AX_99_C: 1 }, heroPool: ['ALT_CORE_B_AX_01_C'] }, { fetchSet, fetchUniques })
    expect(r.cards.map(c => [c.ref, c.qty, c.faction])).toEqual([['ALT_CORE_B_AX_02_C', 3, 'AX'], ['ALT_CORE_B_YZ_45_R2', 1, 'AX'], ['ALT_BISE_P_BR_64_C', 1, 'BR'], ['ALT_CORE_B_AX_04_U_1437', 1, 'AX']])
    expect(r.stored).toEqual({ cards: { ALT_CORE_B_AX_02_C: 3, ALT_CORE_B_YZ_45_R2: 1, ALT_BISE_P_BR_64_C: 1, ALT_CORE_B_AX_04_U_1437: 1 }, heroPool: ['ALT_CORE_B_AX_01_C'] })
    expect(r.heroes).toEqual([{ ref: 'ALT_CORE_B_AX_01_C', faction: 'AX', cardType: 'HERO' }])
    expect(r.unresolved).toEqual(['ALT_CORE_B_AX_99_C'])
  })
  it('flags a hero among the cards and a non-hero in the hero pool', async () => {
    const r = await resolveCubeSource({ cards: { ALT_CORE_B_AX_01_C: 1 }, heroPool: ['ALT_CORE_B_AX_02_C'] }, { fetchSet, fetchUniques })
    expect(r.heroesInCards).toEqual(['ALT_CORE_B_AX_01_C']); expect(r.nonHeroesInPool).toEqual(['ALT_CORE_B_AX_02_C'])
  })
  it('an unavailable cards API throws cards_unavailable; an unknown ref stays unresolved', async () => {
    const down = vi.fn(async refs => refs.map(r => ({ reference: r, faction: 'XX', cardType: '', synthetic: true, unavailable: true })))
    await expect(resolveRefs(['ALT_CORE_B_AX_04_U_1', 'ALT_CORE_B_AX_02_C'], { fetchSet, fetchUniques: down })).rejects.toMatchObject({ code: 'cards_unavailable' })
    expect(down.mock.calls[0][2]).toEqual({ stopOnUnavailable: true })
    const unknown = vi.fn(async refs => refs.map(r => ({ reference: r, faction: 'XX', cardType: '', synthetic: true })))
    expect((await resolveRefs(['ALT_CORE_B_AX_04_U_1'], { fetchSet, fetchUniques: unknown })).unresolved).toEqual(['ALT_CORE_B_AX_04_U_1'])
  })
  it('a failing set fetch throws cards_unavailable (M2)', async () => {
    const failing = vi.fn(async () => { throw new Error('Failed to fetch set CORE (EN): 503') })
    await expect(resolveRefs(['ALT_CORE_B_AX_02_C'], { fetchSet: failing, fetchUniques })).rejects.toMatchObject({ code: 'cards_unavailable' })
  })
})
