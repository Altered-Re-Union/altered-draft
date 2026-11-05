import { SETS, SET_ABBREV, FACTION_NAMES } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'
import { banlistVersionOf, LEGACY_BANLIST } from '../lib/banlist.js'

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

export function PrivateBadge({ t }) {
  return (
    <span data-testid="tournament-private" title={t('tournaments.privateBadgeTitle')} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border text-muted border-line bg-surface2">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
        <path d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 6H6V4.5a2 2 0 1 1 4 0V7Z" />
      </svg>
      {t('tournaments.privateBadge')}
    </span>
  )
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
  const isMulti = config.source?.type === 'multiset'
  let parts
  if (isMulti) {
    const counts = config.source.sets ?? {}
    const setsText = SETS.filter(s => counts[s.code] > 0)
      .map(s => `${SET_ABBREV[s.code] ?? s.code}${counts[s.code] > 1 ? ` ×${counts[s.code]}` : ''}`).join(', ')
    parts = [
      { text: t('tournaments.summaryBoostersCount', { n: config.source.boosters ?? 7 }) },
      { text: setsText },
    ]
  } else if (isFaction) {
    const f = config.source.faction
    const weights = config.source.sets ?? {}
    const visible = SETS.filter(s => !s.hidden)
    const allSets = visible.every(s => weights[s.code] === 1)
    const setsText = SETS.filter(s => weights[s.code] > 0)
      .map(s => `${SET_ABBREV[s.code] ?? s.code}${weights[s.code] > 1 ? ` ×${weights[s.code]}` : ''}`).join(', ')
    parts = [
      { text: t('tournaments.summaryBoostersCount', { n: config.source.boosters ?? 7 }) },
      { text: t('tournaments.summaryFactionMix', { faction: FACTION_NAMES[f] ?? f }), icon: FACTION_ICONS[f] },
      { text: allSets ? t('tournaments.summaryAllSets') : setsText },
    ]
  } else {
    const setName = SETS.find(s => s.code === config.source?.setCode)?.name ?? config.source?.setCode ?? ''
    parts = [{ text: t('tournaments.summaryBoosters', { n: config.source?.boosters ?? 7, set: setName }) }]
  }
  if (u.randomOneIn) {
    parts.push({ text: u.randomOneIn === 1 ? t('tournaments.summaryUniquesEvery') : t('tournaments.summaryUniquesRandom', { n: u.randomOneIn }) })
  } else if (u.inBoosters > 0) parts.push({ text: tc('tournaments.summaryUniquesIn', u.inBoosters) })
  if (u.guaranteed > 0) parts.push({ text: tc('tournaments.summaryUniquesOut', u.guaranteed) })
  if (!isFaction && u.faction && (u.randomOneIn || (u.inBoosters + u.guaranteed) > 0)) {
    parts.push({ text: t('tournaments.summaryFaction', { faction: FACTION_NAMES[u.faction] ?? u.faction }), icon: FACTION_ICONS[u.faction] })
  }
  if (!u.randomOneIn && u.evenFactions && (u.inBoosters + u.guaranteed) >= 2) parts.push({ text: t('tournaments.summaryEven') })
  if (config.heroes === 'free') parts.push({ text: t('tournaments.summaryHeroesFree') })
  // A tournament created before the ban list was versioned keeps the old, whole-card list.
  if (config.excludeBanlist) parts.push({ text: t(banlistVersionOf(config) === LEGACY_BANLIST ? 'tournaments.summaryBanlistLegacy' : 'tournaments.summaryBanlist') })
  return parts
}

/** One line: "7 boosters · [icon] Axiom mono-faction · all sets" for a faction source, else "7 boosters · Skybound Odyssey · 1 unique in boosters · 1 guaranteed unique · [icon] Axiom uniques · free hero choice". */
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
