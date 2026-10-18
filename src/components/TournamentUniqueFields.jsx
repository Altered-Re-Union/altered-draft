import { useLang } from '../lib/i18n/i18n.jsx'
import { MAX_UNIQUES } from '../lib/tournamentConfig.js'

function Stepper({ value, onChange, min = 0, max = MAX_UNIQUES, disabled }) {
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min}
        className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">−</button>
      <span className="w-6 text-center text-sm font-bold text-ink tabular-nums">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max}
        className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">+</button>
    </div>
  )
}

// The tournament-only unique knobs (spec §5.1 `uniques`): exact uniques inside boosters,
// guaranteed uniques outside, even factions. `uniqueSupport` is false for sets without
// faction-range data (FUGUE): both counts are forced to 0 and the controls disabled.
export default function TournamentUniqueFields({ uniques, onChange, uniqueSupport = true, disabled = false }) {
  const { t } = useLang()
  const off = disabled || !uniqueSupport
  const total = (uniques.inBoosters ?? 0) + (uniques.guaranteed ?? 0)
  const set = patch => {
    const next = { ...uniques, ...patch }
    // Even factions only means something from 2 uniques on (the server drops it too).
    if ((next.inBoosters ?? 0) + (next.guaranteed ?? 0) < 2) next.evenFactions = false
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink2">{t('tournaments.tournamentUniquesTitle')}</p>
      {!uniqueSupport && <p className="text-xs text-accent-ink">{t('tournaments.uniquesUnsupported')}</p>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">{t('tournaments.uniquesInBoosters')}</span>
        <Stepper value={uniqueSupport ? uniques.inBoosters : 0} onChange={v => set({ inBoosters: v })} disabled={off} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">{t('tournaments.uniquesGuaranteed')}</span>
        <Stepper value={uniqueSupport ? uniques.guaranteed : 0} onChange={v => set({ guaranteed: v })} disabled={off} />
      </div>
      <div className="flex items-center gap-3">
        <input type="checkbox" id="even-factions" checked={!!uniques.evenFactions && total >= 2}
          disabled={off || total < 2}
          onChange={e => set({ evenFactions: e.target.checked })}
          className="accent-accent w-4 h-4" />
        <label htmlFor="even-factions" className={`text-sm cursor-pointer ${total < 2 ? 'text-faint' : 'text-ink2'}`}>
          {t('tournaments.evenFactions')}
        </label>
      </div>
    </div>
  )
}
