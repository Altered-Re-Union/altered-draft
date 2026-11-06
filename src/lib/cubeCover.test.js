import { describe, it, expect, afterEach } from 'vitest'
import { wrapTitle, cubeBoosterCover } from './cubeCover.js'

describe('wrapTitle', () => {
  it('wraps on words', () => {
    expect(wrapTitle('Winter Cup of the Northern Lights', 18)).toEqual(['Winter Cup of the', 'Northern Lights'])
  })
  it('ellipsizes a single long word', () => {
    const lines = wrapTitle('x'.repeat(60), 18)
    expect(lines).toHaveLength(1)
    expect(lines[0].endsWith('…')).toBe(true)
    expect(lines[0].length).toBeLessThanOrEqual(18)
  })
  it('ellipsizes the last line when the text does not fit', () => {
    const lines = wrapTitle('one two three four five six seven eight nine ten', 10, 2)
    expect(lines).toHaveLength(2)
    expect(lines[1].endsWith('…')).toBe(true)
  })
})

describe('cubeBoosterCover', () => {
  afterEach(() => { delete globalThis.document })
  it('resolves null without a document (node)', async () => {
    expect(await cubeBoosterCover({ title: 'A', subtitle: 'node-case' })).toBeNull()
  })
  it('resolves null when the canvas has no 2d context', async () => {
    globalThis.document = { createElement: () => ({ getContext: () => null }) }
    expect(await cubeBoosterCover({ title: 'A', subtitle: 'no-ctx' })).toBeNull()
  })
})
