import { describe, it, expect } from 'vitest'
import { generateRoomCode } from './roomCode.js'

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

describe('generateRoomCode', () => {
  it('defaults to length 4', () => {
    expect(generateRoomCode()).toHaveLength(4)
  })

  it('honors a custom length', () => {
    expect(generateRoomCode(6)).toHaveLength(6)
    expect(generateRoomCode(1)).toHaveLength(1)
  })

  it('only uses the unambiguous character set (no I, O, 0, 1)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode(8)
      for (const ch of code) {
        expect(CHARS).toContain(ch)
      }
      expect(code).not.toMatch(/[IO01]/)
    }
  })

  it('generates varying codes (not a constant)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode(4)))
    expect(codes.size).toBeGreaterThan(1)
  })
})
