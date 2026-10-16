// User-created tournaments: public list (GET, bearer optional) and creation (POST).
// See docs/tournaments/user-tournaments-spec.md §7.
import { verifyUser, bearerToken } from '../_lib/auth.js'
import { jsonBody, queryParam } from '../_lib/request.js'
import { validateTournamentFields, MAX_OPEN_TOURNAMENTS } from '../../src/lib/tournamentRules.js'
import { validateTournamentConfig } from '../../src/lib/tournamentConfig.js'
import { listTournaments, createTournament, countOpenTournaments, getTournamentByBgaId, toTournamentJson } from '../../src/lib/tournamentStore.js'
import { countPoolsByTournament, poolSummariesForTournaments } from '../../src/lib/poolStore.js'

const STATUSES = ['open', 'upcoming', 'ongoing', 'all']

// Public GET: a bad/expired bearer just means "anonymous view", never a 401.
async function optionalUser(req) {
  return bearerToken(req) ? verifyUser(req) : null
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // ?bgaId=<numeric BGA id>: the live declaration of that BGA tournament, whatever its
    // status (0 or 1 item). The form's duplicate-link check asks for just that, instead of
    // loading every tournament; the unique index + 409 on POST/PATCH stay the real guard.
    const bgaId = queryParam(req, 'bgaId')
    if (bgaId && !/^\d+$/.test(bgaId)) return res.status(400).json({ error: 'invalid_request', fields: { bgaId: 'invalid_bga_id' } })
    const status = queryParam(req, 'status') || 'open'
    if (!bgaId && !STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_request', fields: { status: 'unknown_status' } })
    const rows = bgaId ? [await getTournamentByBgaId(bgaId)].filter(Boolean) : await listTournaments(status)
    const ids = rows.map(r => r.id)
    const user = await optionalUser(req)
    const [counts, mine] = await Promise.all([
      countPoolsByTournament(ids),
      user ? poolSummariesForTournaments(user.sub, ids) : {},
    ])
    const tournaments = rows.map(row => toTournamentJson(row, {
      poolCount: counts[row.id] ?? 0,
      ...(user ? {
        viewer: {
          isOrganizer: row.organizer_sub === user.sub,
          hasPool: !!mine[row.id],
          poolId: mine[row.id]?.id ?? null,
          deck: mine[row.id]?.deckName ? { name: mine[row.id].deckName, cardQuantity: mine[row.id].deckCardQuantity } : null,
        },
      } : {}),
    }))
    return res.status(200).json({ tournaments })
  }

  if (req.method === 'POST') {
    const user = await verifyUser(req)
    if (!user) return res.status(401).json({ error: 'unauthorized' })

    const body = jsonBody(req)
    const fields = validateTournamentFields(body, { isCreate: true })
    const config = validateTournamentConfig(body.config)
    if (!fields.ok || !config.ok) {
      return res.status(400).json({ error: 'invalid_request', fields: fields.errors, config: config.errors })
    }
    if (!user.isModerator && (await countOpenTournaments(user.sub)) >= MAX_OPEN_TOURNAMENTS) {
      return res.status(429).json({ error: 'too_many_open_tournaments' })
    }

    let row
    try {
      row = await createTournament({
        name: fields.values.name,
        description: fields.values.description,
        bgaUrl: fields.values.bgaUrl,
        bgaTournamentId: fields.values.bgaTournamentId,
        startsAt: fields.values.startsAt,
        endsAt: fields.values.endsAt,
        organizerSub: user.sub,
        organizerName: user.name,
        config: config.config,
      })
    } catch (e) {
      if (e.code === 'bga_tournament_taken') return res.status(409).json({ error: 'bga_tournament_taken' })
      throw e
    }
    return res.status(201).json(toTournamentJson(row, {
      poolCount: 0,
      locked: false,
      viewer: { isOrganizer: true, isModerator: user.isModerator, hasPool: false, poolId: null, deck: null },
    }))
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'method_not_allowed' })
}
