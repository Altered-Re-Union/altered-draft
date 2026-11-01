import { useLang } from '../lib/i18n/i18n.jsx'
import { SEALED_BOOSTERS } from '../lib/tournamentConfig.js'
import SetPresetGrid from './SetPresetGrid.jsx'
import FactionPills from './FactionPills.jsx'
import SetWeightsList from './SetWeightsList.jsx'

// The Cards section of the tournament form (spec §8.1, §13.4): "Sets" (the 7 boosters split
// over one or more sets) or "Mono-faction mix" (one faction, several weighted sets). Both
// sources' values live in the form, so flipping back and forth loses nothing; only the
// active one is sent. The Sets tab has one model, `setCounts` ({ CODE: n }, n > 0 only), and
// two views: the grid (one click = all 7 boosters of that set) and the "Mix several sets"
// disclosure, one stepper per set.
export default function TournamentCardsSource({
  sourceType, onSourceType, setCounts, onSetCounts, faction, onFaction, weights, onWeights,
  mixOpen, onMixOpen, disabled = false,
}) {
  const { t } = useLang()
  const tab = active => `flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-60 ${
    active ? 'bg-accent text-on-accent' : 'text-ink2 hover:bg-surface3'}`
  const codes = Object.keys(setCounts)
  const total = codes.reduce((sum, code) => sum + setCounts[code], 0)
  const single = codes.length === 1 && setCounts[codes[0]] === SEALED_BOOSTERS ? codes[0] : null
  // The steppers write every visible set, zeros included: keep only the sets in the split.
  const changeCounts = next => onSetCounts(Object.fromEntries(Object.entries(next).filter(([, n]) => n > 0)))
  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 rounded-lg bg-surface2 border border-line" role="radiogroup" aria-label={t('tournaments.sourceLabel')}>
        {[['set', 'sourceSets'], ['faction', 'sourceFactionMix']].map(([type, key]) => (
          <button key={type} type="button" role="radio" aria-checked={sourceType === type} disabled={disabled}
            onClick={() => onSourceType(type)} className={tab(sourceType === type)}>
            {t(`tournaments.${key}`)}
          </button>
        ))}
      </div>
      {sourceType === 'faction' ? (
        <>
          <div className="space-y-1.5">
            <span className="text-sm text-ink2">{t('tournaments.factionLabel')}</span>
            <FactionPills value={faction} onChange={onFaction} disabled={disabled} label={t('tournaments.factionLabel')} />
          </div>
          <div className="space-y-1.5">
            <span className="text-sm text-ink2">{t('tournaments.setsWeightsLabel')}</span>
            <SetWeightsList weights={weights} onChange={onWeights} disabled={disabled} />
          </div>
          <p className="text-sm text-muted">{t('tournaments.factionMixHint')}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted">{t('tournaments.cardsHint')}</p>
          <SetPresetGrid selected={single} counts={setCounts} disabled={disabled}
            onSelect={code => onSetCounts(code ? { [code]: SEALED_BOOSTERS } : {})} />
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <button type="button" aria-expanded={mixOpen} aria-controls="tn-set-mix" data-testid="set-mix-toggle"
                disabled={disabled} onClick={() => onMixOpen(!mixOpen)}
                className="flex items-center gap-2 text-sm text-ink2 hover:text-ink disabled:opacity-60">
                <span aria-hidden="true" className={`inline-block transition-transform ${mixOpen ? 'rotate-90' : ''}`}>▸</span>
                {t('tournaments.mixSetsToggle')}
              </button>
              {(mixOpen || codes.length > 1) && (
                <span data-testid="set-count-total"
                  className={`text-sm font-semibold tabular-nums ${total === SEALED_BOOSTERS ? 'text-ok' : 'text-accent-ink'}`}>
                  {t('tournaments.mixSetsCounter', { n: total })}
                </span>
              )}
            </div>
            {mixOpen && (
              <div id="tn-set-mix" className="space-y-1.5">
                <p className="text-xs text-muted">{t('tournaments.mixSetsHint')}</p>
                <SetWeightsList weights={setCounts} onChange={changeCounts} disabled={disabled}
                  max={SEALED_BOOSTERS} maxTotal={SEALED_BOOSTERS} format={v => String(v)} trailing={null} testIdPrefix="set-count" />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
