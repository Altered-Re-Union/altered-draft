// Deterministic PRNG for tournament-safe pool generation. Given the same numeric
// seed, mulberry32 always produces the same sequence — both the pool-generation and
// the deck-validation endpoint import this module and draw in the same fixed order,
// so they reproduce an identical pool from an identical seed.

/** 32-bit FNV-1a — turns an arbitrary string (sub + interval bounds) into a numeric seed. */
export function hashSeed(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32: tiny, fast, good-enough-for-a-card-game seeded PRNG. Returns a `() => float in [0,1)` generator. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Convenience: build a ready-to-use rng directly from a seed string. */
export function seededRng(str) {
  return mulberry32(hashSeed(str))
}
