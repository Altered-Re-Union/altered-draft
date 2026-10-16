import { SETS } from '../lib/cardData.js'

const PILL = {
  upcoming: 'text-accent border-accent/50 bg-accent/10',
  ongoing: 'text-green-400 border-green-700 bg-green-900/25',
  ended: 'text-muted border-line bg-surface2',
  cancelled: 'text-red-400 border-red-800 bg-red-950/25',
}

export function StatusPill({ status, t }) {
  const key = { upcoming: 'statusUpcoming', ongoing: 'statusOngoing', ended: 'statusEnded', cancelled: 'statusCancelled' }[status] ?? 'statusUpcoming'
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${PILL[status] ?? PILL.upcoming}`}>{t(`tournaments.${key}`)}</span>
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

/** One line: "7 boosters · Skybound Odyssey · 1 unique in boosters · 1 guaranteed unique · free hero choice". */
export function summarizeConfig(config, t, tc) {
  if (!config) return ''
  const setName = SETS.find(s => s.code === config.source?.setCode)?.name ?? config.source?.setCode ?? ''
  const parts = [t('tournaments.summaryBoosters', { n: config.source?.boosters ?? 7, set: setName })]
  const u = config.uniques ?? {}
  if (u.inBoosters > 0) parts.push(tc('tournaments.summaryUniquesIn', u.inBoosters))
  if (u.guaranteed > 0) parts.push(tc('tournaments.summaryUniquesOut', u.guaranteed))
  if (u.evenFactions && (u.inBoosters + u.guaranteed) >= 2) parts.push(t('tournaments.summaryEven'))
  if (config.heroes === 'free') parts.push(t('tournaments.summaryHeroesFree'))
  if (config.excludeBanlist) parts.push(t('tournaments.summaryBanlist'))
  return parts.join(' · ')
}
