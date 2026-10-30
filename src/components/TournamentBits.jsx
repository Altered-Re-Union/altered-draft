import { SETS, SET_ABBREV, FACTION_NAMES } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'

const PILL = {
  upcoming: 'text-accent-ink border-accent/50 bg-accent/15',
  ongoing: 'text-ok border-ok/40 bg-ok-soft',
  ended: 'text-muted border-line bg-surface2',
  cancelled: 'text-danger border-danger/40 bg-danger-soft',
  detached: 'text-danger border-danger/40 bg-danger-soft',
}

export function StatusPill({ status, t }) {
  const key = { upcoming: 'statusUpcoming', ongoing: 'statusOngoing', ended: 'statusEnded', cancelled: 'statusCancelled', detached: 'statusDetached' }[status] ?? 'statusUpcoming'
  return <span data-testid="tournament-status" className={`text-xs px-2 py-0.5 rounded-full border ${PILL[status] ?? PILL.upcoming}`}>{t(`tournaments.${key}`)}</span>
}

/** Viewer-local date + time (the API sends UTC ISO strings). */
export function formatDateTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  } catch {
    return String(iso)
  }
}

// The pieces of the one-line summary, in order; `icon` = a faction icon shown before the text.
export function configSummaryParts(config, t, tc) {
  const u = config.uniques ?? {}
  const isFaction = config.source?.type === 'faction'
  let parts
  if (isFaction) {
    const f = config.source.faction
    const weights = config.source.sets ?? {}
    const visible = SETS.filter(s => !s.hidden)
    const allSets = visible.every(s => weights[s.code] === 1)
    const setsText = SETS.filter(s => weights[s.code] > 0)
      .map(s => `${SET_ABBREV[s.code] ?? s.code}${weights[s.code] > 1 ? ` ×${weights[s.code]}` : ''}`).join(', ')
    parts = [
      { text: t('tournaments.summaryBoostersFaction', { n: config.source.boosters ?? 7, faction: FACTION_NAMES[f] ?? f }), icon: FACTION_ICONS[f] },
      { text: allSets ? t('tournaments.summaryAllSets') : setsText },
    ]
  } else {
    const setName = SETS.find(s => s.code === config.source?.setCode)?.name ?? config.source?.setCode ?? ''
    parts = [{ text: t('tournaments.summaryBoosters', { n: config.source?.boosters ?? 7, set: setName }) }]
  }
  if (u.inBoosters > 0) parts.push({ text: tc('tournaments.summaryUniquesIn', u.inBoosters) })
  if (u.guaranteed > 0) parts.push({ text: tc('tournaments.summaryUniquesOut', u.guaranteed) })
  if (!isFaction && u.faction && (u.inBoosters + u.guaranteed) > 0) {
    parts.push({ text: t('tournaments.summaryFaction', { faction: FACTION_NAMES[u.faction] ?? u.faction }), icon: FACTION_ICONS[u.faction] })
  }
  if (u.evenFactions && (u.inBoosters + u.guaranteed) >= 2) parts.push({ text: t('tournaments.summaryEven') })
  if (config.heroes === 'free') parts.push({ text: t('tournaments.summaryHeroesFree') })
  if (config.excludeBanlist) parts.push({ text: t('tournaments.summaryBanlist') })
  return parts
}

/** One line: "7 boosters · Skybound Odyssey · 1 unique in boosters · 1 guaranteed unique · [icon] Axiom uniques · free hero choice". */
export function ConfigSummary({ config, t, tc, className = '' }) {
  if (!config) return null
  return (
    <p data-testid="tournament-summary" className={className}>
      {configSummaryParts(config, t, tc).map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {p.icon && <img src={p.icon} alt="" className="inline-block w-3.5 h-3.5 object-contain mr-1 -mt-0.5" />}
          {p.text}
        </span>
      ))}
    </p>
  )
}
