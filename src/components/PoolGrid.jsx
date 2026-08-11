import { useState, useRef, useEffect } from 'react'
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

// The scrollable list itself clips the hover-zoomed card (any ancestor with overflow
// auto/scroll/hidden establishes a clip box at ITS OWN edges) — the true boundary the
// zoom must stay inside is that ancestor's rect, not the browser viewport.
function clipBoundsFor(el) {
  let node = el.parentElement
  while (node && node !== document.body) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
      return node.getBoundingClientRect()
    }
    node = node.parentElement
  }
  return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
}

// Hover-zoom origin: anchor the scale to whichever edge of the scrollable list the card is
// near so the enlarged card never spills outside it (and gets clipped). Works at any
// breakpoint/column count because it measures the card's real position on mouseenter.
export const HOVER_SCALE = 1.6
export function useZoomOrigin(scale = HOVER_SCALE) {
  const ref = useRef(null)
  const [origin, setOrigin] = useState('top')
  function onMouseEnter() {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const bounds = clipBoundsFor(el)
    const growX = (r.width * (scale - 1)) / 2   // overflow each side when centered
    const growY = r.height * (scale - 1)         // overflow below when top-anchored
    let x = ''
    if (r.left - growX < bounds.left + 8) x = 'left'
    else if (r.right + growX > bounds.right - 8) x = 'right'
    // Grow upward by default (anchored to the bottom edge) so the enlarged card overlaps
    // the row above instead of bleeding down into the next row's cards/controls — that
    // downward bleed used to hijack hover as the mouse moved right along a row.
    let y = 'bottom'
    if (r.top - growY < bounds.top + 8 && r.bottom + growY < bounds.bottom - 8) y = 'top'
    setOrigin(`${y}${x ? ' ' + x : ''}`)
  }
  return { ref, origin, onMouseEnter }
}

/**
 * Shared pool browser with faction filter, sort/group, +/- deck controls,
 * and a large hover preview. Heroes are grouped inside their own faction.
 */
export default function PoolGrid({ refs, cardMap, deck, poolCounts, onAdd, onRemove, loading }) {
  const [filterFactions, setFilterFactions] = useState([])
  const [sortBy, setSortBy] = useState('faction')
  const [viewMode, setViewMode] = useState('cards') // 'cards' (art grid) | 'list' (compact columns)

  function toggleFaction(f) {
    setFilterFactions(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f])
  }

  const visibleRefs = filterFactions.length === 0
    ? refs
    : refs.filter(r => filterFactions.includes(cardMap[r]?.faction))

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
        <button onClick={() => setFilterFactions([])}
          className={`px-2.5 py-1 rounded text-xs transition-colors ${filterFactions.length === 0 ? 'bg-surface3 text-ink' : 'text-faint hover:text-ink2'}`}>
          All
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
  const hasControls = onAdd && onRemove
  const zoomControls = hasControls
    ? { qty: inDeck, total: poolQty, canAdd, canRemove, onAdd: () => onAdd(ref_), onRemove: () => onRemove(ref_) }
    : null

  // Keep the full-screen modal's qty/total live if this card's slot is the one currently open.
  useEffect(() => {
    if (zoomControls) zoom.sync(ref_, zoomControls)
  }, [inDeck, poolQty])

  return (
    <div className="flex items-center gap-2 px-1.5 py-0.5 rounded hover:bg-surface2 text-sm">
      <span className="w-5 shrink-0 text-center text-xs font-bold text-ink2 tabular-nums">{cost}</span>
      <span className="w-3.5 shrink-0 flex items-center justify-center">
        {!isHero && RARITY_GEMS[card?.rarity] && <img src={RARITY_GEMS[card.rarity]} alt={card.rarity} title={card.rarity} className="w-3 h-3 object-contain" />}
      </span>
      {/* Tap the name to see the card full screen (no art in this compact view). */}
      <button onClick={() => zoom.open(card, ref_, zoomControls)}
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
  const zoomControls = hasControls
    ? { qty: inDeck, total: poolQty, canAdd, canRemove, onAdd: () => onAdd(ref_), onRemove: () => onRemove(ref_) }
    : null

  // Keep the full-screen modal's qty/total live if this card's slot is the one currently open.
  useEffect(() => {
    if (zoomControls) zoom.sync(ref_, zoomControls)
  }, [inDeck, poolQty])

  return (
    // The whole tile (art + name/icons + +/-) is the hover-zoom target, so the controls
    // scale up together with the card instead of sitting at a fixed size below it.
    <div ref={ref} onMouseEnter={onMouseEnter} style={{ transformOrigin: origin }}
      className="relative flex flex-col rounded-lg border border-line bg-surface
      transition-transform duration-150 ease-out hover:scale-[1.6] hover:z-30 hover:shadow-xl hover:shadow-black/70">
      <div onClick={() => zoom.open(card, ref_, zoomControls)}
        className="aspect-[2/3] bg-surface2 overflow-hidden rounded-t-lg relative cursor-zoom-in">
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
      </div>
      {/* Name/icons + the deck +/- controls, below the art (never overlapping it) but still
          inside the zoomed tile above, so they grow together with the card on hover. */}
      <div className="p-1">
        <div className="flex items-center gap-1">
          <p className="flex-1 min-w-0 text-xs text-ink2 leading-tight line-clamp-1">{card?.name ?? ''}</p>
          <span className="flex items-center gap-1 shrink-0">
            {card?.cardType !== 'HERO' && RARITY_GEMS[card?.rarity] && <img src={RARITY_GEMS[card.rarity]} alt="" className="w-3 h-3 object-contain" />}
            {setIcon && <img src={setIcon} alt="" className="w-3 h-3 object-contain opacity-50" onError={e => { e.currentTarget.style.display = 'none' }} />}
          </span>
        </div>
        {hasControls && (
          <div className="flex items-center justify-center gap-2 mt-1.5">
            <button onClick={() => onRemove(ref_)} disabled={!canRemove}
              className="w-8 h-8 shrink-0 rounded-md bg-surface2 hover:bg-red-800 disabled:opacity-25 text-white font-bold flex items-center justify-center text-lg leading-none transition-colors">
              −
            </button>
            <span className={`min-w-[2.75rem] text-center text-sm font-bold tabular-nums ${inDeck > 0 ? 'text-accent' : 'text-faint'}`}>
              {inDeck}/{poolQty}
            </span>
            <button onClick={() => onAdd(ref_)} disabled={!canAdd}
              className="w-8 h-8 shrink-0 rounded-md bg-surface2 hover:bg-green-800 disabled:opacity-25 text-white font-bold flex items-center justify-center text-lg leading-none transition-colors">
              +
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
