import { useLang } from '../lib/i18n/i18n.jsx'
import SetPresetGrid from './SetPresetGrid.jsx'
import FactionPills from './FactionPills.jsx'
import SetWeightsList from './SetWeightsList.jsx'

// The Cards section of the tournament form (spec §8.1): "One set" (a preset set) or
// "Mono-faction mix" (one faction, several weighted sets). Both sources' values live in
// the form, so flipping back and forth loses nothing; only the active one is sent.
export default function TournamentCardsSource({ sourceType, onSourceType, setCode, onSetCode, faction, onFaction, weights, onWeights, disabled = false }) {
  const { t } = useLang()
  const tab = active => `flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-60 ${
    active ? 'bg-accent text-on-accent' : 'text-ink2 hover:bg-surface3'}`
  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 rounded-lg bg-surface2 border border-line" role="radiogroup" aria-label={t('tournaments.sourceLabel')}>
        {[['set', 'sourceOneSet'], ['faction', 'sourceFactionMix']].map(([type, key]) => (
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
          <SetPresetGrid selected={setCode} onSelect={onSetCode} disabled={disabled} />
        </>
      )}
    </div>
  )
}
