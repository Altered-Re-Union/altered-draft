import { describe, it, expect } from 'vitest'
import { qrSvgPath, QR_QUIET_ZONE } from './qr.js'

const URL1 = 'https://altered-draft.altered.re/tournament/t/00000000-0000-4000-8000-000000000000'

describe('qrSvgPath', () => {
  it('is deterministic, starts with the top-left finder pattern, and grows with the text', () => {
    const a = qrSvgPath(URL1)
    expect(a).toEqual(qrSvgPath(URL1))
    expect(a.d).toContain('M4 4h1v1h-1z')
    expect(qrSvgPath('x').size).toBe(21 + 2 * QR_QUIET_ZONE)
    expect(a.size).toBeGreaterThan(qrSvgPath('x').size)
  })
  it('keeps every module on the grid, inside the quiet zone', () => {
    const { size, d } = qrSvgPath('hello')
    const cells = [...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map(m => [Number(m[1]), Number(m[2])])
    expect(cells.length).toBeGreaterThan(0)
    expect(d.replace(/M\d+ \d+h1v1h-1z/g, '')).toBe('')
    for (const [x, y] of cells) {
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE); expect(x).toBeLessThan(size - QR_QUIET_ZONE)
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE); expect(y).toBeLessThan(size - QR_QUIET_ZONE)
    }
  })
  it('refuses an empty text', () => {
    expect(() => qrSvgPath('')).toThrow()
  })
})
