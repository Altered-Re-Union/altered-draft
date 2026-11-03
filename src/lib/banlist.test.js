import { describe, it, expect } from 'vitest'
import { isBanned, filterBanned } from './banlist.js'

describe('isBanned', () => {
  it('bans only the suspended printings of a card, not its other printings', () => {
    // Baba Yaga: only the Ordis out-of-faction rare is suspended.
    expect(isBanned('ALT_CORE_B_YZ_11_R2')).toBe(true)
    expect(isBanned('ALT_CORE_B_YZ_11_C')).toBe(false)
    expect(isBanned('ALT_CORE_B_YZ_11_R1')).toBe(false)
    // Tiny Jinn: common and rare, not the Muna R2.
    expect(isBanned('ALT_CORE_B_BR_06_C')).toBe(true)
    expect(isBanned('ALT_CORE_B_BR_06_R1')).toBe(true)
    expect(isBanned('ALT_CORE_B_BR_06_R2')).toBe(false)
    // Dr. Frankenstein: only the rare.
    expect(isBanned('ALT_CORE_B_AX_17_R1')).toBe(true)
    expect(isBanned('ALT_CORE_B_AX_17_C')).toBe(false)
    expect(isBanned('ALT_CORE_B_AX_17_R2')).toBe(false)
    // Restocking Station: common and the Bravos R2, not the rare.
    expect(isBanned('ALT_CYCLONE_B_AX_81_C')).toBe(true)
    expect(isBanned('ALT_CYCLONE_B_AX_81_R2')).toBe(true)
    expect(isBanned('ALT_CYCLONE_B_AX_81_R1')).toBe(false)
  })

  it('bans Lyra Festival at every printing, its Muna R2 included', () => {
    expect(isBanned('ALT_CORE_B_LY_29_C')).toBe(true)
    expect(isBanned('ALT_CORE_B_LY_29_R1')).toBe(true)
    expect(isBanned('ALT_CORE_B_LY_29_R2')).toBe(true)
  })

  it('maps the Kickstarter reprint (COREKS) and the alt-art / promo prints onto the suspended printing', () => {
    expect(isBanned('ALT_COREKS_B_BR_06_R1')).toBe(true)
    expect(isBanned('ALT_CORE_A_LY_29_C')).toBe(true)
    expect(isBanned('ALT_CORE_P_YZ_11_R2')).toBe(true)
    expect(isBanned('ALT_COREKS_B_YZ_11_C')).toBe(false)
  })

  it('does not ban an unrelated card', () => {
    expect(isBanned('ALT_CORE_B_BR_07_C')).toBe(false)
  })

  it('does not ban the uniques of a suspended card', () => {
    expect(isBanned('ALT_CORE_B_BR_06_U_1234')).toBe(false)
    expect(isBanned('ALT_CORE_B_LY_29_U_42')).toBe(false)
  })

  it('only bans the UNIQUE printing of a unique-only-banned family, not its base card', () => {
    expect(isBanned('ALT_CORE_B_YZ_05_C')).toBe(false)
    expect(isBanned('ALT_CORE_B_YZ_05_R1')).toBe(false)
    expect(isBanned('ALT_CORE_B_YZ_05_U_1234')).toBe(true)
  })

  it('bans a unique-only-banned family across its transfuge (dual-faction) prints too', () => {
    // Same family key ALT_CORE_B_YZ_05 regardless of which faction the unique serial resolves to.
    expect(isBanned('ALT_CORE_B_YZ_05_U_9999')).toBe(true)
  })

  it('handles malformed/short references gracefully', () => {
    expect(isBanned('garbage')).toBe(false)
    expect(isBanned('')).toBe(false)
  })
})

describe('filterBanned', () => {
  it('drops banned cards and keeps the rest', () => {
    const cards = [
      { reference: 'ALT_CORE_B_BR_06_C' },
      { reference: 'ALT_CORE_B_BR_07_C' },
      null,
    ]
    expect(filterBanned(cards)).toEqual([{ reference: 'ALT_CORE_B_BR_07_C' }])
  })
})
