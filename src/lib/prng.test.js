import { describe, it, expect } from 'vitest'
import { hashSeed, mulberry32, seededRng } from './prng.js'

describe('hashSeed', () => {
  it('is deterministic for the same string', () => {
    expect(hashSeed('altered-draft')).toBe(hashSeed('altered-draft'))
  })

  it('returns an unsigned 32-bit integer', () => {
    const h = hashSeed('any string here')
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(2 ** 32)
    expect(Number.isInteger(h)).toBe(true)
  })

  it('differs for different strings (no trivial collisions)', () => {
    const seeds = ['room1', 'room2', 'player-alice', 'player-bob', '2026-06-01']
    const hashes = new Set(seeds.map(hashSeed))
    expect(hashes.size).toBe(seeds.length)
  })

  it('is sensitive to string order (not just character multiset)', () => {
    expect(hashSeed('ab')).not.toBe(hashSeed('ba'))
  })
})

describe('mulberry32', () => {
  it('produces the same sequence for the same seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('always returns floats in [0, 1)', () => {
    const rng = mulberry32(12345)
    for (let i = 0; i < 500; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('seededRng', () => {
  it('is equivalent to mulberry32(hashSeed(str))', () => {
    const a = seededRng('room-code-XYZ')
    const b = mulberry32(hashSeed('room-code-XYZ'))
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('reproduces an identical sequence across independent calls with the same seed string', () => {
    const rngA = seededRng('sub123|2026-06-01')
    const rngB = seededRng('sub123|2026-06-01')
    for (let i = 0; i < 20; i++) {
      expect(rngA()).toBe(rngB())
    }
  })
})
