import { describe, it, expect } from 'vitest'
import { parseBgaTournamentUrl } from './bgaUrl.js'

describe('parseBgaTournamentUrl', () => {
  it('accepts the canonical tournament link', () => {
    expect(parseBgaTournamentUrl('https://boardgamearena.com/tournament?id=597924'))
      .toEqual({ id: '597924', url: 'https://boardgamearena.com/tournament?id=597924' })
  })

  it('accepts locale subdomains, uppercase host, trailing slash and extra params, and canonicalizes', () => {
    expect(parseBgaTournamentUrl('HTTPS://FR.boardgamearena.com/tournament/?id=5&foo=bar'))
      .toEqual({ id: '5', url: 'https://boardgamearena.com/tournament?id=5' })
    expect(parseBgaTournamentUrl('  https://en.boardgamearena.com/tournament?id=42  '))
      .toEqual({ id: '42', url: 'https://boardgamearena.com/tournament?id=42' })
  })

  it('rejects http, other hosts, other paths, non-numeric ids and garbage', () => {
    expect(parseBgaTournamentUrl('http://boardgamearena.com/tournament?id=1')).toBeNull()
    expect(parseBgaTournamentUrl('https://boardgamearena.com.evil.io/tournament?id=1')).toBeNull()
    expect(parseBgaTournamentUrl('https://notboardgamearena.com/tournament?id=1')).toBeNull()
    expect(parseBgaTournamentUrl('https://boardgamearena.com/tournamentlist?id=1')).toBeNull()
    expect(parseBgaTournamentUrl('https://boardgamearena.com/tournament?id=abc')).toBeNull()
    expect(parseBgaTournamentUrl('https://boardgamearena.com/tournament')).toBeNull()
    expect(parseBgaTournamentUrl('not a url')).toBeNull()
    expect(parseBgaTournamentUrl(null)).toBeNull()
  })
})
