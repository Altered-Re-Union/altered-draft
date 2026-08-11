import { useLang } from '../lib/i18n/i18n.jsx'

const LANGS = ['EN', 'FR', 'ES', 'DE', 'IT']

// Step 3 of the lobby wizard: the final knobs, mode-aware. Pure/presentational — the host's
// chosen mode (draft vs sealed) and format drive which controls show. Heroes/timer/uniques
// normalization for invalid combinations lives in the Lobby (where the mode is owned).
export default function SettingsFields({
  mode = 'draft', draftFormat,
  lang, setLang,
  heroMode, setHeroMode,
  heroCount = 3, setHeroCount, maxHeroes = 1, heroPoolSize = 0,
  timerEnabled, setTimerEnabled, timerSeconds, setTimerSeconds,
  addUniques, setAddUniques, showUniques = false,
  excludeBanlist, setExcludeBanlist, showBanlist = false,
}) {
  const { t } = useLang()
  const isDraft = mode === 'draft'
  const isWinston = isDraft && draftFormat === 'winston'

  // Booster interleaves a hero pass between card rounds; the other formats draft heroes first.
  const draftOpt = {
    v: 'draft',
    label: t('settingsFields.draftLabel'),
    desc: draftFormat === 'booster'
      ? t('settingsFields.draftDescBooster')
      : t('settingsFields.draftDescOther'),
  }

  const heroOptions = isWinston
    ? [
        { v: 'packs', label: t('settingsFields.shuffleIntoPool'), desc: t('settingsFields.shuffleIntoPoolDesc') },
        { v: 'free', label: t('settingsFields.freePickFromAll'), desc: t('settingsFields.freePickFromAllDesc') },
        { v: 'split', label: t('settingsFields.randomSplit'), desc: t('settingsFields.randomSplitDesc') },
        draftOpt,
      ]
    : [
        { v: 'packs', label: t('settingsFields.inPacks'), desc: t('settingsFields.inPacksDesc') },
        { v: 'free', label: t('settingsFields.freeChoice'), desc: t('settingsFields.freeChoiceDesc') },
        ...(isDraft ? [draftOpt] : []),
      ]

  return (
    <div className="space-y-6">
      {/* Card language */}
      <div>
        <label className="block text-sm text-muted mb-2">{t('settingsFields.cardLanguage')}</label>
        <div className="flex gap-2 flex-wrap">
          {LANGS.map(l => (
            <button key={l} onClick={() => setLang(l)}
              className={`px-3 py-1 rounded text-sm font-mono transition-colors ${lang === l
                ? 'bg-accent text-on-accent font-bold'
                : 'bg-surface2 hover:bg-surface3 text-ink2'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Heroes */}
      <div>
        <label className="block text-sm text-ink2 mb-2">{t('settingsFields.heroesLabel')}</label>
        <div className="space-y-1.5">
          {heroOptions.map(o => {
            const active = heroMode === o.v
            return (
              <button key={o.v} type="button" onClick={() => setHeroMode(o.v)}
                className={`w-full flex items-start gap-2.5 text-left px-3 py-2 rounded-lg border transition-colors ${
                  active ? 'border-accent bg-accent/5' : 'border-line bg-surface2 hover:bg-surface3'}`}>
                <span className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${
                  active ? 'border-accent' : 'border-faint'}`}>
                  {active && <span className="w-2 h-2 rounded-full bg-accent" />}
                </span>
                <span>
                  <span className={`text-sm ${active ? 'text-ink' : 'text-ink2'}`}>{o.label}</span>
                  <span className="block text-xs text-faint">{o.desc}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* Heroes per player — only when snake-drafting them in-app */}
        {isDraft && heroMode === 'draft' && (
          <div className="mt-2 pl-3 space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-sm text-ink2">{t('settingsFields.heroesPerPlayer')}</span>
              {heroPoolSize > 0 ? (
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => setHeroCount(Math.max(1, heroCount - 1))} disabled={heroCount <= 1}
                    className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">−</button>
                  <span className="w-6 text-center text-sm font-bold text-ink tabular-nums">{Math.min(heroCount, maxHeroes)}</span>
                  <button type="button" onClick={() => setHeroCount(Math.min(maxHeroes, heroCount + 1))} disabled={heroCount >= maxHeroes}
                    className="w-7 h-7 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 font-bold flex items-center justify-center leading-none">+</button>
                </div>
              ) : (
                <span className="text-xs text-faint">{t('settingsFields.countingThePool')}</span>
              )}
            </div>
            {heroPoolSize > 0 && (
              <p className="text-xs text-faint">{t('settingsFields.allHeroesHint', { n: heroPoolSize, max: maxHeroes })}</p>
            )}
          </div>
        )}
      </div>

      {/* Random uniques — booster-based modes only (cubes manage their own uniques) */}
      {showUniques && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="add-uniques" checked={!!addUniques}
              onChange={e => setAddUniques(e.target.checked)}
              className="accent-accent w-4 h-4" />
            <label htmlFor="add-uniques" className="text-sm text-ink2 cursor-pointer">{t('settingsFields.addRandomUniques')}</label>
          </div>
          <p className="text-xs text-faint pl-7 leading-relaxed">
            {t('settingsFields.addRandomUniquesDesc')}
          </p>
          {addUniques && (
            <p className="text-xs text-accent2 pl-7 leading-relaxed">
              {t('settingsFields.addRandomUniquesWarning')}
            </p>
          )}
        </div>
      )}

      {/* Ban list — sealed only. Opt-in; off keeps the full pool (current behavior). */}
      {showBanlist && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="exclude-banlist" checked={!!excludeBanlist}
              onChange={e => setExcludeBanlist(e.target.checked)}
              className="accent-accent w-4 h-4" />
            <label htmlFor="exclude-banlist" className="text-sm text-ink2 cursor-pointer">{t('settingsFields.excludeBanlist')}</label>
          </div>
          <p className="text-xs text-faint pl-7 leading-relaxed">
            {t('settingsFields.excludeBanlistDesc')}
          </p>
        </div>
      )}

      {/* Pick timer — draft only (sealed has no pick passing) */}
      {isDraft && (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="timer-enabled" checked={timerEnabled}
              onChange={e => setTimerEnabled(e.target.checked)}
              className="accent-accent w-4 h-4" />
            <label htmlFor="timer-enabled" className="text-sm text-ink2 cursor-pointer">{t('settingsFields.pickTimer')}</label>
          </div>
          {timerEnabled && (
            <div className="flex items-center gap-3 pl-7">
              <span className="text-sm text-muted">{t('settingsFields.timePerPick')}</span>
              <div className="flex gap-2">
                {[30, 60, 90, 120].map(s => (
                  <button key={s} onClick={() => setTimerSeconds(s)}
                    className={`px-2.5 py-1 rounded text-sm transition-colors ${timerSeconds === s
                      ? 'bg-accent text-on-accent font-bold'
                      : 'bg-surface2 hover:bg-surface3 text-ink2'}`}>
                    {s}s
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
