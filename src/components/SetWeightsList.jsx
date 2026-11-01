import { useLang } from '../lib/i18n/i18n.jsx'
import { SETS } from '../lib/cardData.js'
import { SET_ASSETS } from '../lib/assets.js'
import { MAX_SET_WEIGHT } from '../lib/tournamentConfig.js'
import Stepper from './Stepper.jsx'

// The mono-faction source's sets (spec §8.1): one row per visible set with its weight
// (0 = excluded … MAX_SET_WEIGHT) and its share of the cards, weight / Σ weights.
export default function SetWeightsList({ weights, onChange, disabled = false }) {
  const { t } = useLang()
  const visible = SETS.filter(s => !s.hidden)
  const total = visible.reduce((sum, s) => sum + (weights[s.code] ?? 0), 0)
  return (
    <ul className="divide-y divide-line">
      {visible.map(set => {
        const w = weights[set.code] ?? 0
        const icon = SET_ASSETS[set.code]?.icon
        return (
          <li key={set.code} className="flex items-center gap-3 py-1.5">
            <span className={`flex-1 min-w-0 flex items-center gap-2 text-sm ${w ? 'text-ink2' : 'text-faint'}`}>
              {icon && <img src={icon} alt="" className="w-4 h-4 object-contain shrink-0" />}
              <span className="truncate">{set.name}</span>
            </span>
            <Stepper value={w} onChange={v => onChange({ ...weights, [set.code]: v })} max={MAX_SET_WEIGHT}
              disabled={disabled} testId={`set-weight-${set.code}`} format={v => `×${v}`} />
            <span className={`w-16 text-right text-xs tabular-nums ${w ? 'text-ink2' : 'text-faint'}`}>
              {w && total ? `${Math.round((100 * w) / total)} %` : t('tournaments.weightExcluded')}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
