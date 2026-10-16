// One declared tournament: public detail (GET, bearer optional), organizer/moderator
// edits (PATCH) and hard delete when no pool exists (DELETE). Spec §3.2 / §7.
import { verifyUser, bearerToken } from '../_lib/auth.js'
import { jsonBody } from '../_lib/request.js'
import { validateTournamentFields } from '../../src/lib/tournamentRules.js'
import { validateTournamentConfig } from '../../src/lib/tournamentConfig.js'
import {
  getTournament, updateTournament, countPoolsForTournament, deleteTournamentIfNoPools, toTournamentJson,
} from '../../src/lib/tournamentStore.js'
import { getPoolForTournament, countPoolsByOrigin } from '../../src/lib/poolStore.js'

const ACTIONS = {
  cancel: { cancelledAt: () => new Date() },
  restore: { cancelledAt: () => null },
  close: { endedAt: () => new Date() },
  reopen: { endedAt: () => null },
}

function canManage(row, user) {
  return !!user && (row.organizer_sub === user.sub || user.isModerator)
}

async function detail(row, user) {
  const poolCount = await countPoolsForTournament(row.id)
  const extras = { poolCount, locked: poolCount > 0 }
  if (user) {
    const pool = await getPoolForTournament(user.sub, row.id)
    extras.viewer = {
      isOrganizer: row.organizer_sub === user.sub,
      isModerator: user.isModerator,
      hasPool: !!pool,
      poolId: pool?.id ?? null,
      deck: pool?.deck_id ? { id: pool.deck_id, name: pool.deck_name, cardQuantity: pool.deck_card_quantity } : null,
    }
    if (canManage(row, user)) extras.poolsByOrigin = await countPoolsByOrigin(row.id)
  }
  return toTournamentJson(row, extras)
}

export default async function handler(req, res) {
  const id = req.query?.id
  const row = await getTournament(id)
  if (!row) return res.status(404).json({ error: 'not_found' })

  if (req.method === 'GET') {
    const user = bearerToken(req) ? await verifyUser(req) : null
    return res.status(200).json(await detail(row, user))
  }

  const user = await verifyUser(req)
  if (!user) return res.status(401).json({ error: 'unauthorized' })
  if (!canManage(row, user)) return res.status(403).json({ error: 'forbidden' })

  if (req.method === 'PATCH') {
    const body = jsonBody(req)
    const fields = {}

    if (body.action !== undefined) {
      const action = ACTIONS[body.action]
      if (!action) return res.status(400).json({ error: 'invalid_request', fields: { action: 'unknown_action' } })
      for (const [key, value] of Object.entries(action)) fields[key] = value()
    }

    const validated = validateTournamentFields(body, { current: row })
    if (!validated.ok) return res.status(400).json({ error: 'invalid_request', fields: validated.errors })
    Object.assign(fields, validated.values)

    let configResult = null
    if (body.config !== undefined) {
      configResult = validateTournamentConfig(body.config)
      if (!configResult.ok) return res.status(400).json({ error: 'invalid_request', config: configResult.errors })
      fields.config = configResult.config
    }

    const touchesLocked = body.config !== undefined || body.bgaUrl !== undefined
    if (touchesLocked && (await countPoolsForTournament(row.id)) > 0) {
      return res.status(409).json({ error: 'tournament_locked' })
    }
    const updated = await updateTournament(row.id, fields, { requireUnlocked: touchesLocked })
    if (!updated) return res.status(409).json({ error: 'tournament_locked' })
    return res.status(200).json(await detail(updated, user))
  }

  if (req.method === 'DELETE') {
    const outcome = await deleteTournamentIfNoPools(row.id)
    if (outcome === 'has_pools') return res.status(409).json({ error: 'tournament_has_pools' })
    if (outcome === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(204).end()
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE')
  return res.status(405).json({ error: 'method_not_allowed' })
}
