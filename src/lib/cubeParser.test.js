import { describe, it, expect } from 'vitest'
import { parseDecklist } from './cubeParser.js'

describe('parseDecklist', () => {
  it('parses the app export format ("<qty> <REF>" per line)', () => {
    const text = '1 ALT_CORE_B_YZ_03_C\n3 ALT_CORE_B_MU_06_R2\n'
    const { entries, refs, badTokens } = parseDecklist(text)
    expect(entries).toEqual([
      { ref: 'ALT_CORE_B_YZ_03_C', qty: 1 },
      { ref: 'ALT_CORE_B_MU_06_R2', qty: 3 },
    ])
    expect(refs).toEqual([
      'ALT_CORE_B_YZ_03_C',
      'ALT_CORE_B_MU_06_R2', 'ALT_CORE_B_MU_06_R2', 'ALT_CORE_B_MU_06_R2',
    ])
    expect(badTokens).toEqual([])
  })

  it('is tolerant of space-separated runs on one line', () => {
    const { refs } = parseDecklist('1 ALT_CORE_B_YZ_03_C 3 ALT_CORE_B_MU_06_R2')
    expect(refs).toHaveLength(4)
  })

  it('accepts a trailing "x" on quantities', () => {
    const { entries } = parseDecklist('3x ALT_CORE_B_YZ_03_C')
    expect(entries).toEqual([{ ref: 'ALT_CORE_B_YZ_03_C', qty: 3 }])
  })

  it('defaults to quantity 1 when no number precedes a ref', () => {
    const { entries } = parseDecklist('ALT_CORE_B_YZ_03_C')
    expect(entries).toEqual([{ ref: 'ALT_CORE_B_YZ_03_C', qty: 1 }])
  })

  it('uppercases refs', () => {
    const { entries } = parseDecklist('alt_core_b_yz_03_c')
    expect(entries).toEqual([{ ref: 'ALT_CORE_B_YZ_03_C', qty: 1 }])
  })

  it('merges duplicate refs by accumulating quantity', () => {
    const { entries, refs } = parseDecklist('1 ALT_CORE_B_YZ_03_C\n2 ALT_CORE_B_YZ_03_C')
    expect(entries).toEqual([{ ref: 'ALT_CORE_B_YZ_03_C', qty: 3 }])
    expect(refs).toHaveLength(3)
  })

  it('collects non-numeric, non-ALT_ tokens as badTokens', () => {
    const { entries, badTokens } = parseDecklist('1 ALT_CORE_B_YZ_03_C garbage 2 ANOTHER_BAD_TOKEN')
    expect(badTokens).toEqual(['garbage', 'ANOTHER_BAD_TOKEN'])
    expect(entries).toEqual([{ ref: 'ALT_CORE_B_YZ_03_C', qty: 1 }])
  })

  it('a bare number with no following ref is simply dropped (not a bad token)', () => {
    const { entries, refs, badTokens } = parseDecklist('3')
    expect(entries).toEqual([])
    expect(refs).toEqual([])
    expect(badTokens).toEqual([])
  })

  it('handles empty input', () => {
    expect(parseDecklist('')).toEqual({ entries: [], refs: [], badTokens: [] })
    expect(parseDecklist(undefined)).toEqual({ entries: [], refs: [], badTokens: [] })
  })

  it('clamps a zero/invalid-looking quantity up to 1', () => {
    // "0x" matches the qty regex (parseInt('0')=0), which Math.max(1, 0) clamps to 1.
    const { entries } = parseDecklist('0x ALT_CORE_B_YZ_03_C')
    expect(entries).toEqual([{ ref: 'ALT_CORE_B_YZ_03_C', qty: 1 }])
  })
})
