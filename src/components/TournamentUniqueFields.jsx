import { useLang } from '../lib/i18n/i18n.jsx'
import { FACTION_NAMES } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'
import { DEFAULT_RANDOM_ONE_IN, MAX_RANDOM_ONE_IN, MAX_UNIQUES } from '../lib/tournamentConfig.js'
import Stepper from './Stepper.jsx'
import FactionPills from './FactionPills.jsx'

// The tournament-only unique knobs (spec §5.1 `uniques`, §13.4): uniques inside boosters,
// either an exact count or random (`randomOneIn`: each booster rolls 1 in N), guaranteed
// uniques outside, one faction for all of them, even factions (exact mode, one set only).
// `uniqueSupport` is false for sets without faction-range data (FUGUE): both counts are
// forced to 0, the controls disabled, and the form sends exact mode. `partialSupport`: a
// split mixing such a set with sets that have data (its boosters never hold a unique).
// `maxInBoosters` caps the exact stepper (3 per eligible booster); a value already past it
// after the sets changed is left for the live issue to report, never clamped silently.
// `lastOneIn` / `onLastOneIn` keep the slider's value while the exact mode is on.
// `factionSource` (a mono-faction source): every unique is of the source's faction
// (`fixedFaction`, null until picked), so the faction choice and "even factions" give way
// to one line naming it. Nothing is written into `uniques` for it: the form applies the
// source faction when it builds the config, so the "Sets" source keeps its own choice.
export default function TournamentUniqueFields({
  uniques, onChange, uniqueSupport = true, partialSupport = false, disabled = false,
  factionSource = false, fixedFaction = null, multiSet = false, maxInBoosters = Infinity,
  lastOneIn = DEFAULT_RANDOM_ONE_IN, onLastOneIn = () => {},
}) {
  const { t, lang } = useLang()
  const off = disabled || !uniqueSupport
  const random = uniqueSupport && uniques.randomOneIn != null
  const total = (uniques.inBoosters ?? 0) + (uniques.guaranteed ?? 0)
  const set = patch => {
    const next = { ...uniques, ...patch }
    const nextRandom = next.randomOneIn != null
    const nextTotal = (next.inBoosters ?? 0) + (next.guaranteed ?? 0)
    // Even factions only means something in exact mode, from 2 uniques on and without a
    // single faction; a faction only with at least one unique (the server drops them too).
    if (nextRandom || nextTotal < 2 || next.faction) next.evenFactions = false
    if (nextTotal === 0 && !nextRandom) next.faction = null
    onChange(next)
  }
  const chooseMode = toRandom => {
    if (toRandom === random) return
    if (toRandom) set({ randomOneIn: lastOneIn, evenFactions: false })
    else { onLastOneIn(uniques.randomOneIn); set({ randomOneIn: null }) }
  }
  const faction = uniqueSupport && (total > 0 || random) ? uniques.faction ?? null : null
  const factionOff = off || (total === 0 && !random)
  const oneIn = uniques.randomOneIn ?? lastOneIn
  const oneInText = oneIn === 1
    ? t('tournaments.randomOneInEvery')
    : t('tournaments.randomOneInText', { n: oneIn, pct: (Math.round(1000 / oneIn) / 10).toLocaleString(lang) })
  const tab = active => `flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-60 ${
    active ? 'bg-accent text-on-accent' : 'text-ink2 hover:bg-surface3'}`

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink2">{t('tournaments.tournamentUniquesTitle')}</p>
      {!uniqueSupport && <p className="text-xs text-accent-ink">{t(factionSource ? 'tournaments.uniquesUnsupportedSets' : 'tournaments.uniquesUnsupported')}</p>}
      {uniqueSupport && partialSupport && <p className="text-xs text-accent-ink">{t('tournaments.uniquesPartialSupport')}</p>}
      <div className="flex gap-1 p-1 rounded-lg bg-surface2 border border-line" role="radiogroup" aria-label={t('tournaments.uniquesModeLabel')}>
        {[[false, 'uniquesModeExact', 'uniques-mode-exact'], [true, 'uniquesModeRandom', 'uniques-mode-random']].map(([isRandom, key, testId]) => (
          <button key={key} type="button" role="radio" aria-checked={random === isRandom} disabled={off}
            data-testid={testId} onClick={() => chooseMode(isRandom)} className={tab(random === isRandom)}>
            {t(`tournaments.${key}`)}
          </button>
        ))}
      </div>
      {random ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="random-one-in" className="text-sm text-ink2">{t('tournaments.randomOneInLabel')}</label>
            <span data-testid="random-one-in-text" className="text-sm font-semibold text-ink tabular-nums">{oneInText}</span>
          </div>
          {/* The position is reversed from N so the fill grows left to right as uniques get more
              frequent: position 1 = "1 in 10", position 10 = every booster. */}
          <input id="random-one-in" type="range" min={1} max={MAX_RANDOM_ONE_IN} step={1} value={MAX_RANDOM_ONE_IN + 1 - oneIn}
            onChange={e => set({ randomOneIn: MAX_RANDOM_ONE_IN + 1 - Number(e.target.value) })} disabled={off}
            data-testid="random-one-in" className="accent-accent w-full" aria-valuetext={oneInText} />
          <div className="flex justify-between text-xs text-faint">
            <span>{t('tournaments.randomOneInMin')}</span>
            <span>{t('tournaments.randomOneInMax')}</span>
          </div>
          <p className="text-xs text-muted">{t('tournaments.randomOneInHint')}</p>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink2">{t('tournaments.uniquesInBoosters')}</span>
          <Stepper value={uniqueSupport ? uniques.inBoosters : 0} onChange={v => set({ inBoosters: v })} disabled={off}
            max={Math.min(MAX_UNIQUES, maxInBoosters)} testId="uniques-in-boosters" />
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-ink2">{t('tournaments.uniquesGuaranteed')}</span>
        <Stepper value={uniqueSupport ? uniques.guaranteed : 0} onChange={v => set({ guaranteed: v })} disabled={off} testId="uniques-guaranteed" />
      </div>
      {factionSource ? (
        <p data-testid="uniques-fixed-faction" className="flex flex-wrap items-center gap-1.5 text-sm text-ink2">
          {t('tournaments.uniquesFixedFaction')}
          {fixedFaction ? (
            <span className="inline-flex items-center gap-1 text-ink">
              {FACTION_ICONS[fixedFaction] && <img src={FACTION_ICONS[fixedFaction]} alt="" className="w-3.5 h-3.5 object-contain" />}
              {FACTION_NAMES[fixedFaction]}
            </span>
          ) : <span className="text-faint">{t('tournaments.uniquesFactionPending')}</span>}
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <span className={`text-sm ${factionOff ? 'text-faint' : 'text-ink2'}`}>{t('tournaments.uniquesFaction')}</span>
            <FactionPills value={faction} onChange={f => set({ faction: f })} allowAll disabled={factionOff} label={t('tournaments.uniquesFaction')} />
            <p className="text-xs text-muted">{t('tournaments.uniquesFactionHint')}</p>
          </div>
          {!random && !multiSet && (
            <div className="flex items-center gap-3">
              <input type="checkbox" id="even-factions" checked={!!uniques.evenFactions && total >= 2 && !faction}
                disabled={off || total < 2 || !!faction}
                onChange={e => set({ evenFactions: e.target.checked })}
                className="accent-accent w-4 h-4" />
              <label htmlFor="even-factions" className={`text-sm cursor-pointer ${total < 2 || faction ? 'text-faint' : 'text-ink2'}`}>
                {t('tournaments.evenFactions')}
              </label>
            </div>
          )}
        </>
      )}
    </div>
  )
}
