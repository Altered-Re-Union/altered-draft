import { SETS } from '../lib/cardData.js'
import { SET_ASSETS } from '../lib/assets.js'

// The "pick one set" grid (logo on the set's colour), shared by the Lobby's presets tab
// and the tournament form. Visible sets only (COREKS is hidden). `counts` (tournament form
// only, spec §13.4): a set holding 1 to 6 of the 7 boosters shows a `×n` badge where the ✓
// sits; the ✓ and `aria-pressed` stay driven by `selected` (the set holding all 7).
export default function SetPresetGrid({ selected, onSelect, disabled = false, counts = null }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {SETS.filter(s => !s.hidden).map(set => {
        const isSelected = selected === set.code
        const count = counts?.[set.code] ?? 0
        const partial = !isSelected && count >= 1 && count <= 6
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
              isSelected ? 'border-accent shadow-lg shadow-accent/20' : partial ? 'border-accent/60' : 'border-line hover:border-line'}`}
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
            {partial && (
              <span data-testid={`set-badge-${set.code}`}
                className="absolute top-2 right-2 h-5 min-w-5 px-1.5 rounded-full bg-surface border border-accent flex items-center justify-center text-xs text-ink font-bold tabular-nums">×{count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
