import { FACTION_ICONS, RARITY_GEMS } from '../lib/assets.js'
import { FACTION_NAMES } from '../lib/cardData.js'
import { useZoomOrigin } from './PoolGrid.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'

// One draftable card: art grows in place on hover (deckbuilder-style, anchored to stay
// on-screen), info bar stays put below it. Clicking the art drafts the card.
function DraftCard({ ref_, card, onPick, disabled }) {
  const { ref, origin, onMouseEnter } = useZoomOrigin()
  const faction = card?.faction ?? 'XX'
  const rarity = card?.rarity ?? 'C'
  const factionIcon = FACTION_ICONS[faction]
  const rarityGem = RARITY_GEMS[rarity]

  return (
    <div className="relative flex flex-col rounded-lg border border-line bg-surface">
      <button
        ref={ref} onMouseEnter={onMouseEnter} onClick={() => !disabled && onPick(ref_)} disabled={disabled}
        style={{ transformOrigin: origin }} title={card?.name ?? ref_}
        className={`aspect-[2/3] bg-surface2 overflow-hidden rounded-t-lg relative transition-transform duration-150 ease-out
          ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:scale-[1.6] hover:z-30 hover:shadow-xl hover:shadow-black/70'}`}>
        {card?.imagePath ? (
          <img src={card.imagePath} alt={card.name} className="w-full h-full object-cover" loading="lazy"
            onError={e => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-faint text-xs px-2 text-center break-all">{card?.name ?? ref_}</div>
        )}
      </button>
      <div className="p-1.5 space-y-1">
        <p className="text-xs font-medium leading-tight line-clamp-1 text-ink">{card?.name ?? ref_}</p>
        <div className="flex items-center gap-1">
          {factionIcon ? (
            <img src={factionIcon} alt={FACTION_NAMES[faction] ?? faction}
              className="w-4 h-4 object-contain shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
          ) : (
            <span className="text-xs text-faint font-mono">{faction}</span>
          )}
          {rarityGem && card?.cardType !== 'HERO' ? (
            <img src={rarityGem} alt={rarity} className="w-4 h-4 object-contain ml-auto shrink-0"
              onError={e => { e.currentTarget.style.display = 'none' }} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function CardGrid({ packRefs, cardMap, onPick, disabled }) {
  const { t } = useLang()
  if (!packRefs?.length) {
    return <div className="text-faint text-sm">{t('cardGrid.noCards')}</div>
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
      {packRefs.map(ref => (
        <DraftCard key={ref} ref_={ref} card={cardMap[ref]} onPick={onPick} disabled={disabled} />
      ))}
    </div>
  )
}
