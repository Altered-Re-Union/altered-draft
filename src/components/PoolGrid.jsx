import { useState, useRef } from 'react'
import {
  FACTIONS, FACTION_NAMES, FACTION_COLORS,
  SET_ABBREV, SET_ABBREV_ICON_CODE,
} from '../lib/cardData.js'
import { FACTION_ICONS, RARITY_GEMS, SET_ICONS, setCodeFromRef } from '../lib/assets.js'
import { useCardZoom } from './CardZoom.jsx'

const TYPE_LABEL = {
  HERO: 'Hero', CHARACTER: 'Character', SPELL: 'Spell',
  PERMANENT: 'Permanent', LANDMARK_PERMANENT: 'Permanent', EXPEDITION_PERMANENT: 'Permanent',
}
const TYPE_ORDER = ['Hero', 'Character', 'Spell', 'Permanent']

// Default card ordering: heroes first, then Character > Spell > Permanent,
// then hand cost asc, then reserve (recall) cost asc, then name.
const TYPE_RANK = { CHARACTER: 0, SPELL: 1, PERMANENT: 2, LANDMARK_PERMANENT: 2, EXPEDITION_PERMANENT: 2 }
export function cardSorter(cardMap) {
  return (ra, rb) => {
    const a = cardMap[ra], b = cardMap[rb]
    const ah = a?.cardType === 'HERO' ? 0 : 1
    const bh = b?.cardType === 'HERO' ? 0 : 1
    if (ah !== bh) return ah - bh
    const at = TYPE_RANK[a?.cardType] ?? 3, bt = TYPE_RANK[b?.cardType] ?? 3
    if (at !== bt) return at - bt
    const ac = a?.mainCost ?? 99, bc = b?.mainCost ?? 99
    if (ac !== bc) return ac - bc
    const ar = a?.recallCost ?? 99, br = b?.recallCost ?? 99
    if (ar !== br) return ar - br
    return (a?.name ?? '').localeCompare(b?.name ?? '')
  }
}

// Hover-zoom origin: anchor the scale to whichever viewport edge the card is
// near so the enlarged card never spills off-screen. Works at any breakpoint /
// column count because it measures the card's real position on mouseenter.
export const HOVER_SCALE = 1.6
export function useZoomOrigin(scale = HOVER_SCALE) {
  const ref = useRef(null)
  const [origin, setOrigin] = useState('top')
  function onMouseEnter() {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const growX = (r.width * (scale - 1)) / 2   // overflow each side when centered
    const growY = r.height * (scale - 1)         // overflow below when top-anchored
    const vw = window.innerWidth, vh = window.innerHeight
    let x = ''
    if (r.left - growX < 8) x = 'left'
    else if (r.right + growX > vw - 8) x = 'right'
    let y = 'top'
    if (r.bottom + growY > vh - 8 && r.top - growY > 8) y = 'bottom'
    setOrigin(`${y}${x ? ' ' + x : ''}`)
  }
  return { ref, origin, onMouseEnter }
}

/**
 * Shared pool browser with faction filter, sort/group, +/- deck controls,
 * and a large hover preview. Heroes are grouped inside their own faction.
 */
export default function PoolGrid({ refs, cardMap, deck, poolCounts, onAdd, onRemove, loading }) {
  const [filterFaction, setFilterFaction] = useState('ALL')
  const [sortBy, setSortBy] = useState('faction')
  const [viewMode, setViewMode] = useState('cards') // 'cards' (art grid) | 'list' (compact columns)

  const visibleRefs = filterFaction === 'ALL'
    ? refs
    : refs.filter(r => cardMap[r]?.faction === filterFaction)

  const cards = visibleRefs.map(r => ({ ref: r, card: cardMap[r] }))

  function buildGroups() {
    if (sortBy === 'faction') {
      const buckets = {}
      for (const f of FACTIONS) buckets[f] = []
      buckets['??'] = []
      for (const { ref, card } of cards) {
        const key = card?.faction ?? '??'
        ;(buckets[key] = buckets[key] ?? []).push(ref)
      }
      return Object.entries(buckets).filter(([, v]) => v.length).map(([key, refs]) => ({
        key, label: FACTION_NAMES[key] ?? key,
        icon: FACTION_ICONS[key] ?? null,
        colorCls: FACTION_COLORS[key] ?? 'text-muted bg-surface2 border-line',
        refs,
      }))
    }
    if (sortBy === 'type') {
      const buckets = {}
      for (const { ref, card } of cards) {
        const label = TYPE_LABEL[card?.cardType] ?? (card?.cardType ?? '?')
        ;(buckets[label] = buckets[label] ?? []).push(ref)
      }
      return TYPE_ORDER.filter(t => buckets[t]).map(label => ({
        key: label, label, icon: null, colorCls: 'text-ink2 bg-surface2 border-line', refs: buckets[label],
      }))
    }
    if (sortBy === 'cost') {
      const heroes = [], buckets = {}
      for (const { ref, card } of cards) {
        if (card?.cardType === 'HERO') { heroes.push(ref); continue }
        const cost = card?.mainCost != null ? String(card.mainCost) : '—'
        ;(buckets[cost] = buckets[cost] ?? []).push(ref)
      }
      const groups = Object.entries(buckets)
        .sort(([a], [b]) => a === '—' ? 1 : b === '—' ? -1 : Number(a) - Number(b))
        .map(([cost, refs]) => ({
          key: cost, label: cost === '—' ? 'No cost' : `Cost ${cost}`, icon: null,
          colorCls: 'text-ink2 bg-surface2 border-line', refs,
        }))
      if (heroes.length) groups.unshift({ key: 'HERO', label: 'Hero', icon: null, colorCls: 'text-accent bg-accent/10 border-accent/30', refs: heroes })
      return groups
    }
    if (sortBy === 'set') {
      const buckets = {}
      for (const { ref } of cards) {
        const rawSet = ref.split('_')[1] ?? '?'
        const abbrev = SET_ABBREV[rawSet] ?? rawSet
        ;(buckets[abbrev] = buckets[abbrev] ?? []).push(ref)
      }
      const setOrder = ['BTG', 'TBF', 'WTM', 'SKY', 'SDU', 'ROC', 'NEJ']
      return Object.entries(buckets)
        .sort(([a], [b]) => (setOrder.indexOf(a) + 1 || 99) - (setOrder.indexOf(b) + 1 || 99))
        .map(([abbrev, refs]) => {
          const iconCode = SET_ABBREV_ICON_CODE[abbrev]
          return { key: abbrev, label: abbrev, icon: iconCode ? SET_ICONS[iconCode] : null, colorCls: 'text-ink2 bg-surface2 border-line', refs }
        })
    }
    return []
  }

  const cmp = cardSorter(cardMap)
  const groups = buildGroups().map(g => ({ ...g, refs: [...g.refs].sort(cmp) }))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Faction filter */}
      <div className="px-4 py-2 border-b border-line flex gap-1.5 flex-wrap shrink-0 bg-base">
        <button onClick={() => setFilterFaction('ALL')}
          className={`px-2.5 py-1 rounded text-xs transition-colors ${filterFaction === 'ALL' ? 'bg-surface3 text-ink' : 'text-faint hover:text-ink2'}`}>
          All
        </button>
        {FACTIONS.map(f => (
          <button key={f} onClick={() => setFilterFaction(f === filterFaction ? 'ALL' : f)}
            className={`px-2 py-1 rounded text-xs transition-colors flex items-center gap-1 border ${
              filterFaction === f ? FACTION_COLORS[f] : 'border-transparent text-faint hover:text-ink2'}`}>
            {FACTION_ICONS[f] && <img src={FACTION_ICONS[f]} alt={f} className="w-3 h-3 object-contain" />}
            <span className="hidden sm:inline">{FACTION_NAMES[f]}</span>
            <span className="sm:hidden">{f}</span>
          </button>
        ))}
      </div>

      {/* Sort + count */}
      <div className="px-4 py-2 border-b border-line flex items-center gap-2 shrink-0 bg-base">
        <span className="text-xs text-faint mr-auto">
          {new Set(visibleRefs).size} unique{visibleRefs.length !== new Set(visibleRefs).size && ` · ${visibleRefs.length} total`}
        </span>
        <span className="text-xs text-faint">Group by:</span>
        {['faction', 'type', 'cost', 'set'].map(s => (
          <button key={s} onClick={() => setSortBy(s)}
            className={`px-2.5 py-1 rounded text-xs capitalize transition-colors ${sortBy === s ? 'bg-accent text-on-accent font-bold' : 'bg-surface2 text-muted hover:text-ink'}`}>
            {s}
          </button>
        ))}
        <span className="text-xs text-faint ml-2 hidden sm:inline">View:</span>
        {[['cards', 'Cards'], ['list', 'List']].map(([v, label]) => (
          <button key={v} onClick={() => setViewMode(v)}
            className={`px-2.5 py-1 rounded text-xs transition-colors ${viewMode === v ? 'bg-accent text-on-accent font-bold' : 'bg-surface2 text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Card grid — generous padding + stable gutter so zoom never reflows the page */}
      {viewMode === 'cards' ? (
        <div className="overflow-y-auto flex-1 px-8 pt-8 pb-40 space-y-6" style={{ scrollbarGutter: 'stable' }}>
          {groups.map(group => (
            <div key={group.key}>
              <div className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border mb-2 ${group.colorCls}`}>
                {group.icon && <img src={group.icon} alt="" className="w-3.5 h-3.5 object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />}
                {group.label} <span className="font-bold">({group.refs.length})</span>
              </div>
              <CardGridInner refs={group.refs} cardMap={cardMap} loading={loading}
                deck={deck} poolCounts={poolCounts} onAdd={onAdd} onRemove={onRemove} />
            </div>
          ))}
        </div>
      ) : (
        /* Compact columns — each group is a vertical stack of cost + name rows, so the whole
           pool/deck fits on one screen with little scrolling (requested by TOs for overview). */
        <div className="overflow-auto flex-1 p-4" style={{ scrollbarGutter: 'stable' }}>
          <div className="flex flex-wrap gap-x-6 gap-y-4 items-start">
            {groups.map(group => (
              <div key={group.key} className="min-w-[210px] flex-1">
                <div className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border mb-1.5 ${group.colorCls}`}>
                  {group.icon && <img src={group.icon} alt="" className="w-3.5 h-3.5 object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />}
                  {group.label} <span className="font-bold">({group.refs.length})</span>
                </div>
                <div>
                  {dedupeRefs(group.refs).map(([ref, occ]) => (
                    <CompactRow key={ref} ref_={ref} occurrences={occ} card={cardMap[ref]}
                      deck={deck} poolCounts={poolCounts} onAdd={onAdd} onRemove={onRemove} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Collapse a ref list (with duplicates) into [ref, count] pairs, order preserved. */
function dedupeRefs(refs) {
  const seen = new Map()
  for (const r of refs) seen.set(r, (seen.get(r) ?? 0) + 1)
  return [...seen.entries()]
}

/** One compact line: cost + name (+ deck +/- when wired). Used by the List view. */
function CompactRow({ ref_, occurrences, card, deck, poolCounts, onAdd, onRemove }) {
  const zoom = useCardZoom()
  const poolQty = poolCounts ? (poolCounts[ref_] ?? occurrences) : occurrences
  const inDeck = deck?.[ref_] ?? 0
  const canAdd = inDeck < poolQty
  const canRemove = inDeck > 0
  const isHero = card?.cardType === 'HERO'
  const cost = isHero ? '' : (card?.mainCost != null ? card.mainCost : '—')

  return (
    <div className="flex items-center gap-2 px-1.5 py-0.5 rounded hover:bg-surface2 text-sm">
      <span className="w-5 shrink-0 text-center text-xs font-bold text-ink2 tabular-nums">{cost}</span>
      {/* Tap the name to see the card full screen (no art in this compact view). */}
      <button onClick={() => zoom.open(card)}
        className="flex-1 min-w-0 truncate text-left text-ink2 hover:text-ink transition-colors" title={card?.name}>
        {card?.name ?? ref_}
      </button>
      {onAdd && onRemove ? (
        <span className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => onRemove(ref_)} disabled={!canRemove}
            className="w-7 h-7 rounded-md bg-surface2 hover:bg-red-800 disabled:opacity-25 text-white font-bold flex items-center justify-center text-base leading-none transition-colors">−</button>
          <span className={`min-w-[2.5rem] text-center text-xs font-bold tabular-nums ${inDeck > 0 ? 'text-accent' : 'text-faint'}`}>{inDeck}/{poolQty}</span>
          <button onClick={() => onAdd(ref_)} disabled={!canAdd}
            className="w-7 h-7 rounded-md bg-surface2 hover:bg-green-800 disabled:opacity-25 text-white font-bold flex items-center justify-center text-base leading-none transition-colors">+</button>
        </span>
      ) : (
        occurrences > 1 && <span className="shrink-0 text-xs text-faint">×{occurrences}</span>
      )}
    </div>
  )
}

/** Self-contained card grid (no filter/sort controls). */
export function SimpleCardGrid({ refs, cardMap, loading, deck, poolCounts, onAdd, onRemove }) {
  return (
    <CardGridInner refs={refs} cardMap={cardMap} loading={loading}
      deck={deck} poolCounts={poolCounts} onAdd={onAdd} onRemove={onRemove} />
  )
}

function CardGridInner({ refs, cardMap, loading, deck, poolCounts, onAdd, onRemove }) {
  const seen = new Map()
  for (const ref of refs) seen.set(ref, (seen.get(ref) ?? 0) + 1)
  const unique = [...seen.entries()]

  return (
    <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
      {unique.map(([ref, occurrences]) => (
        <PoolCard key={ref} ref_={ref} occurrences={occurrences} card={cardMap[ref]}
          loading={loading} deck={deck} poolCounts={poolCounts} onAdd={onAdd} onRemove={onRemove} />
      ))}
    </div>
  )
}

function PoolCard({ ref_, occurrences, card, loading, deck, poolCounts, onAdd, onRemove }) {
  const { ref, origin, onMouseEnter } = useZoomOrigin()
  const zoom = useCardZoom()
  const poolQty = poolCounts ? (poolCounts[ref_] ?? occurrences) : occurrences
  const inDeck = deck?.[ref_] ?? 0
  const canAdd = inDeck < poolQty
  const canRemove = inDeck > 0
  const setIcon = SET_ICONS[setCodeFromRef(ref_)]
  const hasControls = onAdd && onRemove

  return (
    <div className="relative flex flex-col rounded-lg border border-line bg-surface">
      <div ref={ref} onMouseEnter={onMouseEnter} onClick={() => zoom.open(card)} style={{ transformOrigin: origin }}
        className="aspect-[2/3] bg-surface2 overflow-hidden rounded-t-lg relative cursor-zoom-in
        transition-transform duration-150 ease-out hover:scale-[1.6] hover:z-30 hover:shadow-xl hover:shadow-black/70">
        {card?.imagePath ? (
          <img src={card.imagePath} alt={card?.name} className="w-full h-full object-cover" loading="lazy"
            onError={e => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-1">
            <span className="text-xs text-faint text-center leading-tight">{loading ? '…' : (card?.name ?? ref_)}</span>
          </div>
        )}
        {occurrences > 1 && (
          <div className="absolute top-1 left-1 bg-surface/90 text-ink2 font-bold text-xs px-1.5 py-0.5 rounded border border-line">
            ×{occurrences}
          </div>
        )}
        {/* +/- live ON the image (same element that scales on hover) so they zoom together
            with the card, stay big and clickable while zoomed, and never end up covered
            by the enlarged art the way a separate footer did. */}
        {hasControls && (
          <div onClick={e => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 py-1.5 bg-black/70 rounded-b-lg">
            <button onClick={() => onRemove(ref_)} disabled={!canRemove}
              className="w-7 h-7 shrink-0 rounded-md bg-white/15 hover:bg-red-700 disabled:opacity-25 text-white font-bold flex items-center justify-center text-lg leading-none transition-colors">
              −
            </button>
            <span className={`min-w-[2.75rem] text-center text-sm font-bold tabular-nums ${inDeck > 0 ? 'text-accent2' : 'text-white/80'}`}>
              {inDeck}/{poolQty}
            </span>
            <button onClick={() => onAdd(ref_)} disabled={!canAdd}
              className="w-7 h-7 shrink-0 rounded-md bg-white/15 hover:bg-green-700 disabled:opacity-25 text-white font-bold flex items-center justify-center text-lg leading-none transition-colors">
              +
            </button>
          </div>
        )}
      </div>
      {/* Footer: name + set/rarity icons only — never interactive, so it can't get in the way */}
      <div className="p-1">
        <p className="text-xs text-ink2 leading-tight line-clamp-1">{card?.name ?? ''}</p>
        <div className="flex items-center gap-1 mt-1">
          <span className="ml-auto flex items-center gap-1">
            {card?.cardType !== 'HERO' && RARITY_GEMS[card?.rarity] && <img src={RARITY_GEMS[card.rarity]} alt="" className="w-3 h-3 object-contain" />}
            {setIcon && <img src={setIcon} alt="" className="w-3 h-3 object-contain opacity-50" onError={e => { e.currentTarget.style.display = 'none' }} />}
          </span>
        </div>
      </div>
    </div>
  )
}
