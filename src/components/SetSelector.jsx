import { SETS } from '../lib/cardData.js'
import { SET_ASSETS } from '../lib/assets.js'
import { useLang } from '../lib/i18n/i18n.jsx'

// Sealed "Advanced" picker. Same row styling as the Multi-Set draft picker (set icon +
// name + −/+ stepper) so the two feel consistent. Each player opens `total` boosters (the
// sum of the per-set counts). No fixed target — build any pool size; `recommended` (7) is
// the standard sealed amount and is highlighted when the total matches.
export default function SetSelector({ selectedSets, onChange, disabled, recommended = 7 }) {
  const { t } = useLang()
  const total = Object.values(selectedSets).reduce((a, b) => a + (b || 0), 0)

  function setCount(code, n) {
    const next = { ...selectedSets }
    const v = Math.max(0, Math.min(12, n))
    if (v <= 0) delete next[code]
    else next[code] = v
    onChange(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm text-muted">{t('setSelector.boostersPerPlayer')}</label>
        <span className={`text-sm font-mono font-bold ${total === recommended ? 'text-green-400' : total > 0 ? 'text-accent' : 'text-faint'}`}>
          {total}
        </span>
      </div>
      <p className="text-xs text-faint mb-3">
        {t('setSelector.chooseHint', { n: recommended })}
      </p>

      <div className="space-y-2">
        {SETS.filter(s => !s.hidden).map(set => {
          const count = selectedSets[set.code] ?? 0
          const selected = count > 0
          const icon = SET_ASSETS[set.code]?.icon
          return (
            <div key={set.code} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
              selected ? 'border-accent/40 bg-accent/5' : 'border-line bg-surface2'
            }`}>
              {icon
                ? <img src={icon} alt="" className="w-6 h-6 object-contain shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
                : <span className="w-6 h-6 shrink-0" />}
              <span className="flex-1 text-sm text-ink2">{set.name}</span>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => !disabled && setCount(set.code, count - 1)} disabled={disabled || count <= 0}
                  className="w-7 h-7 rounded bg-surface3 hover:bg-surface3 disabled:opacity-30 text-white font-bold flex items-center justify-center leading-none">
                  −
                </button>
                <input
                  type="number" min={0} max={12} value={count}
                  onChange={e => setCount(set.code, parseInt(e.target.value) || 0)}
                  disabled={disabled}
                  className="w-12 bg-surface3 border border-line rounded px-2 py-0.5 text-sm text-center focus:outline-none focus:border-accent"
                />
                <button type="button" onClick={() => !disabled && setCount(set.code, count + 1)} disabled={disabled}
                  className="w-7 h-7 rounded bg-surface3 hover:bg-surface3 disabled:opacity-30 text-white font-bold flex items-center justify-center leading-none">
                  +
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {total === 0 && <p className="text-xs text-faint mt-3">{t('setSelector.addAtLeastOne')}</p>}
    </div>
  )
}
