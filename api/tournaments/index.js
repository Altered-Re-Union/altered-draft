// User-created tournaments: public list (GET, bearer optional) and creation (POST).
// See docs/tournaments/user-tournaments-spec.md §7.
import { verifyUser, bearerToken } from '../_lib/auth.js'
import { jsonBody, queryParam } from '../_lib/request.js'
import { validateTournamentFields, MAX_OPEN_TOURNAMENTS } from '../../src/lib/tournamentRules.js'
import { validateTournamentConfig, legacyFormatForBgaTournament } from '../../src/lib/tournamentConfig.js'
import { listTournaments, listTournamentsByOrganizer, createTournament, countOpenTournaments, getTournamentByBgaId, toTournamentJson } from '../../src/lib/tournamentStore.js'
import { countPoolsByTournament, poolSummariesForTournaments, legacyFormatsForBgaId } from '../../src/lib/poolStore.js'

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
    if (!bgaId && queryParam(req, 'mine') !== '1' && !STATUSES.includes(status)) return res.status(400).json({ error: 'invalid_request', fields: { status: 'unknown_status' } })
    // ?mine=1: the tournaments the caller organizes, every status ("My created tournaments").
    const onlyMine = queryParam(req, 'mine') === '1'
    const user = await optionalUser(req)
    if (onlyMine && !user) return res.status(401).json({ error: 'unauthorized' })
    const rows = onlyMine ? await listTournamentsByOrganizer(user.sub)
      : bgaId ? [await getTournamentByBgaId(bgaId)].filter(Boolean)
      : await listTournaments(status)
    const ids = rows.map(r => r.id)
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
    // The form also needs to know whether that BGA tournament is already being played with
    // legacy pools: their format will be imposed (or the declaration refused if mixed).
    if (bgaId) return res.status(200).json({ tournaments, legacy: legacyFormatForBgaTournament(await legacyFormatsForBgaId(bgaId)) })
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
    // A BGA tournament already played with legacy pools: its declaration takes their format
    // (they can't be swapped mid-tournament) and adopts them; mixed formats are refused.
    const legacy = legacyFormatForBgaTournament(await legacyFormatsForBgaId(fields.values.bgaTournamentId))
    if (legacy?.mixed) return res.status(409).json({ error: 'bga_tournament_mixed_formats' })
    const finalConfig = legacy ? validateTournamentConfig(legacy.config).config ?? legacy.config : config.config

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
        config: finalConfig,
      })
    } catch (e) {
      if (e.code === 'bga_tournament_taken') return res.status(409).json({ error: 'bga_tournament_taken' })
      throw e
    }
    const { adopted_pools: adopted = 0, ...created } = row
    return res.status(201).json(toTournamentJson(created, {
      poolCount: adopted,
      locked: adopted > 0,
      viewer: { isOrganizer: true, isModerator: user.isModerator, hasPool: false, poolId: null, deck: null },
    }))
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'method_not_allowed' })
}
