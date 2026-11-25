import { useLang } from '../lib/i18n/i18n.jsx'
import { CUBE_LIMITS } from '../lib/cubeSealed.js'
import Stepper from './Stepper.jsx'
import HeroPicker from './HeroPicker.jsx'

// One radio-like option card, the look of SettingsFields' hero options.
function OptionCard({ active, onClick, label, hint, disabled = false, testId }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} disabled={disabled} data-testid={testId}
      className={`w-full flex items-start gap-2.5 text-left px-3 py-2 rounded-lg border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active ? 'border-accent bg-accent/5' : 'border-line bg-surface2 hover:enabled:bg-surface3'}`}>
      <span className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${active ? 'border-accent' : 'border-faint'}`}>
        {active && <span className="w-2 h-2 rounded-full bg-accent" />}
      </span>
      <span>
        <span className={`text-sm ${active ? 'text-ink' : 'text-ink2'}`}>{label}</span>
        <span className="block text-xs text-faint">{hint}</span>
      </span>
    </button>
  )
}

// The Settings section of a cube tournament (spec §15.2 "Settings section for a cube"), in place
// of SettingsFields + TournamentUniqueFields: the boosters (count, size, faction guarantee) and
// the heroes (mode + the hero pool). The Players block (MaxPlayersField) is rendered by the form
// after it, shared with the other sources.
export default function TournamentCubeSettings({ settings, onSettings, heroes, onHeroes, heroPool, onHeroPool, cubeHeroes = [], disabled = false, lang }) {
  const { t } = useLang()
  const { boosters, cardsPerBooster, perFaction } = settings
  const set = patch => onSettings({ ...settings, ...patch })
  const twoTooBig = cardsPerBooster < CUBE_LIMITS.perFaction2MinCards
  const perFactionOptions = [0, 1, 2].map(n => ({
    n,
    label: t(`tournaments.cubePerFaction${n}`),
    hint: n === 2 && twoTooBig ? t('tournaments.errCubePerFaction') : t(`tournaments.cubePerFaction${n}Hint`),
    disabled: n === 2 && twoTooBig,
  }))
  return (
    <div className="space-y-6">
      {/* Boosters */}
      <div id="tn-cube-boosters" tabIndex={-1} className="space-y-3 focus:outline-none">
        <h3 className="text-sm font-semibold text-ink">{t('tournaments.cubeBoostersTitle')}</h3>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink2">{t('tournaments.cubeBoostersPerPlayer')}</span>
          <Stepper value={boosters} onChange={v => set({ boosters: v })} min={CUBE_LIMITS.boosters[0]} max={CUBE_LIMITS.boosters[1]}
            disabled={disabled} testId="cube-boosters" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-sm text-ink2">{t('tournaments.cubeCardsPerBooster')}</span>
            <span className="block text-xs text-faint">{t('tournaments.cubeCardsPerBoosterHint')}</span>
          </span>
          <Stepper value={cardsPerBooster} onChange={v => set({ cardsPerBooster: v })} min={CUBE_LIMITS.cardsPerBooster[0]} max={CUBE_LIMITS.cardsPerBooster[1]}
            disabled={disabled} testId="cube-cards-per-booster" />
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm text-ink2">{t('tournaments.cubePerFactionLabel')}</span>
          {perFactionOptions.map(o => (
            <OptionCard key={o.n} active={perFaction === o.n} onClick={() => set({ perFaction: o.n })} label={o.label} hint={o.hint}
              disabled={disabled || o.disabled} testId={`cube-per-faction-${o.n}`} />
          ))}
        </div>
        <p data-testid="cube-pool-line" className="text-sm text-ink">
          {t('tournaments.cubePoolLine', { cards: boosters * cardsPerBooster, boosters, perBooster: cardsPerBooster })}
          {heroes === 'packs' ? t('tournaments.cubePoolLineHero') : ''}
        </p>
        <p className="text-xs text-faint">{t('tournaments.cubeRarityNote')}</p>
      </div>

      {/* Heroes */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">{t('tournaments.cubeHeroesTitle')}</h3>
        <div className="space-y-1.5">
          <OptionCard active={heroes === 'packs'} onClick={() => onHeroes('packs')} disabled={disabled} testId="hero-mode-packs"
            label={t('tournaments.cubeHeroesPacks')} hint={t('tournaments.cubeHeroesPacksHint')} />
          <OptionCard active={heroes === 'free'} onClick={() => onHeroes('free')} disabled={disabled} testId="hero-mode-free"
            label={t('tournaments.cubeHeroesFree')} hint={t('tournaments.cubeHeroesFreeHint')} />
        </div>
        <div id="tn-hero-pool" tabIndex={-1} className="space-y-1.5 focus:outline-none">
          <span className="block text-sm text-ink2">{t('tournaments.heroPoolLabel')}</span>
          <HeroPicker value={heroPool} onChange={onHeroPool} preselected={cubeHeroes} disabled={disabled} lang={lang} />
        </div>
      </div>
    </div>
  )
}
