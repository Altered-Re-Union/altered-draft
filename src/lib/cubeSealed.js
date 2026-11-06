// Pure rules of the cube sealed source (docs/tournaments/user-tournaments-spec.md §15): limits,
// ref shape, capacity of a cube and the player-cap checks. Shared by the API and the form.
import { FACTIONS } from './cardData.js'

export const CUBE_LIMITS = {
  boosters: [3, 8],
  cardsPerBooster: [10, 16],
  perFaction: [0, 2],
  perFaction2MinCards: 12,
  minPoolCards: 60,
  maxCards: 1500,
  maxHeroes: 200,
  maxPlayers: 256,
  nameMax: 80,
}
export const CUBE_ORIGINS = ['community', 'reunion', 'paste']

// A stored ref: any printing letter; the set (`split('_')[1]`) is checked against SETS by the
// config validator. Whether a non-B ref has a B twin is the resolver's business.
export const CARD_REF_RE = /^ALT_[A-Z]+_[ABP]_[A-Z]{2}_\d+_(C|R1|R2|E|U_\d+)$/

export const isHeroRefShape = ref => typeof ref === 'string' && CARD_REF_RE.test(ref) && !ref.includes('_U_')

/**
 * How many players a cube can serve. Per player: `boosters × cardsPerBooster` cards, and
 * `boosters × perFaction` cards of each faction when perFaction > 0.
 * @param {{ cards: { ref: string, qty: number, faction: string | null }[], boosters: number, cardsPerBooster: number, perFaction: number }} p
 * @returns {{ players: number, total: number, byFaction: Record<string, number>, limit: { by: string, have: number, needed: number } }}
 */
export function cubeCapacity({ cards, boosters, cardsPerBooster, perFaction }) {
  const byFaction = Object.fromEntries(FACTIONS.map(f => [f, 0]))
  let total = 0
  for (const { qty, faction } of cards) {
    total += qty
    if (faction in byFaction) byFaction[faction] += qty
  }
  const terms = [{ by: 'total', have: total, needed: boosters * cardsPerBooster }]
  if (perFaction > 0) for (const f of FACTIONS) terms.push({ by: f, have: byFaction[f], needed: boosters * perFaction })
  let best = terms[0]
  for (const t of terms) if (Math.floor(t.have / t.needed) < Math.floor(best.have / best.needed)) best = t
  const players = Math.min(Math.floor(best.have / best.needed), CUBE_LIMITS.maxPlayers)
  return { players, total, byFaction, limit: { by: best.by, have: best.have, needed: best.needed } }
}

/** One entry per copy, in input order. */
export function expandCube(cards) {
  const out = []
  for (const { ref, qty, faction } of cards) for (let i = 0; i < qty; i++) out.push({ ref, faction })
  return out
}

/**
 * The player-cap checks (spec §15.2 "Player cap").
 * @returns {{ fields: { maxPlayers?: string }, config: string[] }}
 */
export function checkPlayerCap({ source, maxPlayers, capacity = null, poolCount = 0 }) {
  const out = { fields: {}, config: [] }
  if (source?.type === 'cube') {
    if (maxPlayers == null) out.fields.maxPlayers = 'required_for_cube'
    if (capacity && capacity.players < 2) out.config.push('source.capacity')
    else if (capacity && maxPlayers != null && maxPlayers > capacity.players) out.fields.maxPlayers = 'above_capacity'
  } else if (maxPlayers != null && maxPlayers < poolCount) out.fields.maxPlayers = 'below_pool_count'
  return out
}
