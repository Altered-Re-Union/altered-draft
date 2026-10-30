import { useLang } from '../lib/i18n/i18n.jsx'
import { FACTION_NAMES } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'
import Stepper from './Stepper.jsx'
import FactionPills from './FactionPills.jsx'

// The tournament-only unique knobs (spec §5.1 `uniques`): exact uniques inside boosters,
// guaranteed uniques outside, one faction for all of them, even factions. `uniqueSupport` is false for sets without
// faction-range data (FUGUE): both counts are forced to 0 and the controls disabled.
// `fixedFaction` (a mono-faction source): every unique is of that faction, so the faction
// choice and "even factions" give way to one line naming it.
export default function TournamentUniqueFields({ uniques, onChange, uniqueSupport = true, disabled = false, fixedFaction = null }) {
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
    else if (fixedFaction) { next.faction = fixedFaction; next.evenFactions = false }
    onChange(next)
  }
  const faction = uniqueSupport && total > 0 ? uniques.faction ?? null : null
  const factionOff = off || total === 0

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
      {fixedFaction ? (
        <p data-testid="uniques-fixed-faction" className="flex flex-wrap items-center gap-1.5 text-sm text-ink2">
          {t('tournaments.uniquesFixedFaction')}
          <span className="inline-flex items-center gap-1 text-ink">
            {FACTION_ICONS[fixedFaction] && <img src={FACTION_ICONS[fixedFaction]} alt="" className="w-3.5 h-3.5 object-contain" />}
            {FACTION_NAMES[fixedFaction]}
          </span>
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <span className={`text-sm ${factionOff ? 'text-faint' : 'text-ink2'}`}>{t('tournaments.uniquesFaction')}</span>
            <FactionPills value={faction} onChange={f => set({ faction: f })} allowAll disabled={factionOff} label={t('tournaments.uniquesFaction')} />
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
        </>
      )}
    </div>
  )
}
