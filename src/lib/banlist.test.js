import { describe, it, expect } from 'vitest'
import { isBanned, filterBanned } from './banlist.js'

describe('isBanned', () => {
  it('bans every printing (common, rare, out-of-faction rare) of a banned family', () => {
    expect(isBanned('ALT_CORE_B_BR_06_C')).toBe(true)
    expect(isBanned('ALT_CORE_B_BR_06_R1')).toBe(true)
    expect(isBanned('ALT_CORE_B_BR_06_R2')).toBe(true)
  })

  it('maps the Kickstarter reprint (COREKS) onto the same ban as CORE', () => {
    expect(isBanned('ALT_COREKS_B_BR_06_R1')).toBe(true)
  })

  it('does not ban an unrelated card', () => {
    expect(isBanned('ALT_CORE_B_BR_07_C')).toBe(false)
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
