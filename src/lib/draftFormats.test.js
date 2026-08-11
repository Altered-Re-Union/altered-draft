import { describe, it, expect } from 'vitest'
import { DRAFT_FORMATS, DEFAULT_FORMAT, formatById } from './draftFormats.js'

describe('DRAFT_FORMATS', () => {
  it('lists booster, rochester, rotisserie and winston, all available', () => {
    const ids = DRAFT_FORMATS.map(f => f.id)
    expect(ids).toEqual(['booster', 'rochester', 'rotisserie', 'winston'])
    expect(DRAFT_FORMATS.every(f => f.available)).toBe(true)
  })

  it('marks winston as 2-player only', () => {
    expect(formatById('winston').players).toBe('2')
  })
})

describe('DEFAULT_FORMAT', () => {
  it('is booster', () => {
    expect(DEFAULT_FORMAT).toBe('booster')
  })
})

describe('formatById', () => {
  it('finds a format by id', () => {
    expect(formatById('rochester').name).toBe('Rochester')
  })

  it('falls back to the first (booster) format for an unknown id', () => {
    expect(formatById('does-not-exist')).toBe(DRAFT_FORMATS[0])
    expect(formatById(undefined)).toBe(DRAFT_FORMATS[0])
  })
})
