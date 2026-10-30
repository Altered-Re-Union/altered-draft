import { useLang } from '../lib/i18n/i18n.jsx'
import { MAX_UNIQUES } from '../lib/tournamentConfig.js'
import { FACTIONS, FACTION_NAMES } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'

function Stepper({ value, onChange, min = 0, max = MAX_UNIQUES, disabled, testId }) {
  return (
    <div data-testid={testId} className="flex items-center gap-1.5">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min}
        className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">−</button>
      <span className="w-6 text-center text-sm font-bold text-ink tabular-nums">{value}</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max}
        className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">+</button>
    </div>
  )
}

// The tournament-only unique knobs (spec §5.1 `uniques`): exact uniques inside boosters,
// guaranteed uniques outside, one faction for all of them, even factions. `uniqueSupport` is false for sets without
// faction-range data (FUGUE): both counts are forced to 0 and the controls disabled.
export default function TournamentUniqueFields({ uniques, onChange, uniqueSupport = true, disabled = false }) {
  const { t } = useLang()
  const off = disabled || !uniqueSupport
  const total = (uniques.inBoosters ?? 0) + (uniques.guaranteed ?? 0)
  const set = patch => {
    const next = { ...uniques, ...patch }
    const nextTotal = (next.inBoosters ?? 0) + (next.guaranteed ?? 0)
    // Even factions only means something from 2 uniques on and without a single faction,
    // a faction only with at least one unique (the server drops them too).
    if (nextTotal < 2 || next.faction) next.evenFactions = false
    if (nextTotal === 0) next.faction = null
    onChange(next)
  }
  const faction = uniqueSupport && total > 0 ? uniques.faction ?? null : null
  const factionOff = off || total === 0
  const chip = active => `flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs disabled:opacity-40 ${
    active ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-surface2 text-ink2 hover:bg-surface3'}`

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink2">{t('tournaments.tournamentUniquesTitle')}</p>
      {!uniqueSupport && <p className="text-xs text-accent-ink">{t('tournaments.uniquesUnsupported')}</p>}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">{t('tournaments.uniquesInBoosters')}</span>
        <Stepper value={uniqueSupport ? uniques.inBoosters : 0} onChange={v => set({ inBoosters: v })} disabled={off} testId="uniques-in-boosters" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">{t('tournaments.uniquesGuaranteed')}</span>
        <Stepper value={uniqueSupport ? uniques.guaranteed : 0} onChange={v => set({ guaranteed: v })} disabled={off} testId="uniques-guaranteed" />
      </div>
      <div className="space-y-1.5">
        <span className={`text-sm ${factionOff ? 'text-faint' : 'text-ink2'}`}>{t('tournaments.uniquesFaction')}</span>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('tournaments.uniquesFaction')}>
          <button type="button" role="radio" aria-checked={!faction} disabled={factionOff}
            onClick={() => set({ faction: null })} className={chip(!faction)}>
            {t('tournaments.uniquesFactionAll')}
          </button>
          {FACTIONS.map(f => (
            <button key={f} type="button" role="radio" aria-checked={faction === f} disabled={factionOff}
              onClick={() => set({ faction: f })} className={chip(faction === f)}>
              {FACTION_ICONS[f] && <img src={FACTION_ICONS[f]} alt="" className="w-3.5 h-3.5 object-contain" />}
              {FACTION_NAMES[f]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{t('tournaments.uniquesFactionHint')}</p>
      </div>
      <div className="flex items-center gap-3">
        <input type="checkbox" id="even-factions" checked={!!uniques.evenFactions && total >= 2 && !faction}
          disabled={off || total < 2 || !!faction}
          onChange={e => set({ evenFactions: e.target.checked })}
          className="accent-accent w-4 h-4" />
        <label htmlFor="even-factions" className={`text-sm cursor-pointer ${total < 2 || faction ? 'text-faint' : 'text-ink2'}`}>
          {t('tournaments.evenFactions')}
        </label>
      </div>
    </div>
  )
}
