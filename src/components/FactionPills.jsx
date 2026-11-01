import { useLang } from '../lib/i18n/i18n.jsx'
import { FACTIONS, FACTION_NAMES } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'

// One chip per faction (icon + name) as a radiogroup; `allowAll` adds a leading
// "All factions" chip whose value is null.
export default function FactionPills({ value, onChange, allowAll = false, disabled = false, label }) {
  const { t } = useLang()
  const chip = active => `flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs disabled:opacity-40 ${
    active ? 'border-accent bg-accent/15 text-ink' : 'border-line bg-surface2 text-ink2 hover:bg-surface3'}`
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {allowAll && (
        <button type="button" role="radio" aria-checked={!value} disabled={disabled}
          onClick={() => onChange(null)} className={chip(!value)}>
          {t('tournaments.uniquesFactionAll')}
        </button>
      )}
      {FACTIONS.map(f => (
        <button key={f} type="button" role="radio" aria-checked={value === f} disabled={disabled}
          onClick={() => onChange(f)} className={chip(value === f)}>
          {FACTION_ICONS[f] && <img src={FACTION_ICONS[f]} alt="" className="w-3.5 h-3.5 object-contain" />}
          {FACTION_NAMES[f]}
        </button>
      ))}
    </div>
  )
}
