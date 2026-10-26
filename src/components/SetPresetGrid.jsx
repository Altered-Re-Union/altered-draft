import { SETS } from '../lib/cardData.js'
import { SET_ASSETS } from '../lib/assets.js'

// The "pick one set" grid (logo on the set's colour), shared by the Lobby's presets tab
// and the tournament form. Visible sets only (COREKS is hidden).
export default function SetPresetGrid({ selected, onSelect, disabled = false }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {SETS.filter(s => !s.hidden).map(set => {
        const isSelected = selected === set.code
        const assets = SET_ASSETS[set.code]
        const logoUrl = assets?.logo
        const iconUrl = assets?.icon
        return (
          <button
            key={set.code}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? null : set.code)}
            className={`relative flex flex-col items-center justify-center rounded-xl border-2 p-3 h-32 transition-all overflow-hidden gap-1 disabled:opacity-60 ${
              isSelected ? 'border-accent shadow-lg shadow-accent/20' : 'border-line hover:border-line'}`}
            style={{ backgroundColor: set.color + 'cc' }}
          >
            {logoUrl ? (
              <img src={logoUrl} alt={set.name} className="h-14 w-full object-contain"
                onError={e => { e.currentTarget.style.display = 'none' }} />
            ) : iconUrl ? (
              <img src={iconUrl} alt={set.name} className="h-10 object-contain"
                onError={e => { e.currentTarget.style.display = 'none' }} />
            ) : null}
            <span className="text-xs text-white text-center leading-tight font-medium px-1 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">{set.name}</span>
            {isSelected && (
              <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center text-xs text-on-accent font-bold">✓</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
