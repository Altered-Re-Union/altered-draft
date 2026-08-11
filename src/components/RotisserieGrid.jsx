import { useState } from 'react'
import { FACTIONS, FACTION_NAMES, FACTION_COLORS } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'
import { cardSorter, useZoomOrigin } from './PoolGrid.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'

// One pool card: art grows in place on hover (deckbuilder-style); clicking drafts one copy.
function RotisserieCard({ ref_, card, count, onPick, disabled }) {
  // The pool is a dense grid of small cards, so zoom bigger (2x, like the Winston cards).
  const { ref, origin, onMouseEnter } = useZoomOrigin(2)
  return (
    <div className="relative flex flex-col rounded-lg border border-line bg-surface">
      <button
        ref={ref} onMouseEnter={onMouseEnter} onClick={() => !disabled && onPick(ref_)} disabled={disabled}
        style={{ transformOrigin: origin }} title={card?.name ?? ref_}
        className={`aspect-[2/3] bg-surface2 overflow-hidden rounded-t-lg relative transition-transform duration-150 ease-out
          ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:scale-[2] hover:z-30 hover:shadow-xl hover:shadow-black/70'}`}>
        {card?.imagePath ? (
          <img src={card.imagePath} alt={card.name} className="w-full h-full object-cover" loading="lazy"
            onError={e => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-faint text-xs px-2 text-center break-all">{card?.name ?? ref_}</div>
        )}
        {count > 1 && (
          <div className="absolute top-1 left-1 bg-surface/90 text-ink2 font-bold text-xs px-1.5 py-0.5 rounded border border-line">×{count}</div>
        )}
      </button>
      {/* Minimal footer — name only; faction/rarity read off the art (and the hover zoom). */}
      <p className="px-1 py-0.5 text-[10px] text-ink2 leading-tight line-clamp-1">{card?.name ?? ref_}</p>
    </div>
  )
}

// The shared Rotisserie pool: every draftable card face-up. Deduped with an ×N count (a cube
// can hold several copies), faction-filtered, and sorted like the deckbuilder. Clicking a card
// drafts ONE copy — only enabled on your turn. Distinct from CardGrid (which keys by ref and so
// can't show a pool with duplicates) and PoolGrid (deckbuild +/- controls).
export default function RotisserieGrid({ refs, cardMap, onPick, disabled }) {
  const [filterFactions, setFilterFactions] = useState([])
  const { t } = useLang()

  if (!refs?.length) return <div className="text-faint text-sm">{t('rotisserieGrid.poolEmpty')}</div>

  function toggleFaction(f) {
    setFilterFactions(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  const counts = new Map()
  for (const r of refs) counts.set(r, (counts.get(r) ?? 0) + 1)
  let unique = [...counts.keys()]
  if (filterFactions.length > 0) unique = unique.filter(r => filterFactions.includes(cardMap[r]?.faction))
  unique.sort(cardSorter(cardMap))

  return (
    <div>
      {/* Faction filter */}
      <div className="flex gap-1.5 flex-wrap mb-3">
        <button onClick={() => setFilterFactions([])}
          className={`px-2.5 py-1 rounded text-xs transition-colors ${filterFactions.length === 0 ? 'bg-surface3 text-ink' : 'text-faint hover:text-ink2'}`}>
          {t('common.all')}
        </button>
        {FACTIONS.map(f => (
          <button key={f} onClick={() => toggleFaction(f)}
            className={`px-2 py-1 rounded text-xs transition-colors flex items-center gap-1 border ${
              filterFactions.includes(f) ? FACTION_COLORS[f] : 'border-transparent text-faint hover:text-ink2'}`}>
            {FACTION_ICONS[f] && <img src={FACTION_ICONS[f]} alt={f} className="w-3 h-3 object-contain" />}
            <span className="hidden sm:inline">{FACTION_NAMES[f]}</span>
            <span className="sm:hidden">{f}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
        {unique.map(ref => (
          <RotisserieCard key={ref} ref_={ref} card={cardMap[ref]} count={counts.get(ref)}
            onPick={onPick} disabled={disabled} />
        ))}
      </div>
    </div>
  )
}
