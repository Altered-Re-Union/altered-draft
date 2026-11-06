// Server-side verification of a cube source (spec §15.2 "Verification server-side").
import { resolveCubeSource } from '../../src/lib/cubeSource.js'
import { cubeCapacity, checkPlayerCap } from '../../src/lib/cubeSealed.js'

/**
 * @returns {Promise<{ refused: { status: 400, body: object } } | { config: object }>}
 */
export async function checkCubeConfig(config, { maxPlayers } = {}) {
  const source = config?.source
  if (source?.type !== 'cube') return { config }

  const resolved = await resolveCubeSource(source)
  const refuse = body => ({ refused: { status: 400, body: { error: 'invalid_request', ...body } } })

  if (resolved.unresolved.length) {
    const heroSet = new Set(source.heroPool)
    const cardSet = new Set(Object.keys(source.cards))
    const keys = []
    if (resolved.unresolved.some(r => cardSet.has(r))) keys.push('source.cards.unresolved')
    if (resolved.unresolved.some(r => heroSet.has(r))) keys.push('source.heroPool.unresolved')
    return refuse({ config: keys, unresolved: resolved.unresolved })
  }
  if (resolved.heroesInCards.length) return refuse({ config: ['source.cards'] })
  if (resolved.nonHeroesInPool.length) return refuse({ config: ['source.heroPool'] })

  const capacity = cubeCapacity({ cards: resolved.cards, boosters: source.boosters, cardsPerBooster: source.cardsPerBooster, perFaction: source.perFaction })
  const cap = checkPlayerCap({ source, maxPlayers, capacity })
  if (Object.keys(cap.fields).length || cap.config.length) return refuse({ fields: cap.fields, config: cap.config, capacity })

  return { config: { ...config, source: { ...source, ...resolved.stored } } }
}
