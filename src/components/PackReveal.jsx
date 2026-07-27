import { useState, useEffect } from 'react'
import { SimpleCardGrid } from './PoolGrid.jsx'

/**
 * First-open reveal for a tournament sealed pool: a full-screen overlay that walks the
 * player pack by pack — the 7 boosters plus an 8th "booster" holding the guaranteed unique
 * (which lives in the pool but in no real pack) — sitting on top of the full pool. Purely a
 * presentation layer over data the page already has: dismissing it (Skip, or the final
 * "See full pool") just unmounts the overlay, so the player is already on the deckbuilder
 * with no tab change. The parent shows it once per pool (localStorage flag).
 *
 * Deliberately plain to start — the value here is the isolated full-screen surface, which is
 * where pack-opening cosmetics (tear/flip/glow, etc.) can be layered on later without
 * touching the deckbuilder underneath.
 *
 * @param {string[][]} packs - packs to reveal in order; when `hasBonus`, the LAST one is the
 *   guaranteed-unique "8th booster".
 */
export default function PackReveal({ packs, hasBonus = false, cardMap, deck, poolCounts, onAdd, onRemove, onClose }) {
  const [index, setIndex] = useState(0)

  // Escape skips the whole reveal (matches the always-visible Skip button).
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!packs.length) return null

  const total = packs.length
  const isLast = index >= total - 1
  const isBonusPack = hasBonus && isLast
  const currentPack = packs[index]

  return (
    <div className="fixed inset-0 z-50 bg-base flex flex-col">
      {/* Top bar: title + always-available Skip */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
        <h2 className="text-lg font-display">Opening your pool</h2>
        <button onClick={onClose}
          className="ml-auto text-sm px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 text-ink2 transition-colors">
          Skip ▸
        </button>
      </div>

      {/* Pack heading */}
      <div className="px-4 pt-3 pb-2 text-center">
        <div className="text-sm text-ink2 tabular-nums">Booster {index + 1} / {total}</div>
        {isBonusPack && <div className="text-xs text-accent2 mt-0.5">✦ Your guaranteed unique</div>}
      </div>

      {/* Current pack (reuses the same grid as the pool, so cards behave identically) */}
      <div className="flex-1 mx-4 mb-3 bg-surface rounded-xl border border-line overflow-hidden">
        <SimpleCardGrid
          refs={currentPack}
          cardMap={cardMap}
          deck={deck}
          poolCounts={poolCounts}
          onAdd={onAdd}
          onRemove={onRemove}
        />
      </div>

      {/* Nav: Previous · Next / See full pool */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-line">
        <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index <= 0}
          className="text-sm px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 disabled:opacity-30 text-ink2 transition-colors">
          ← Previous
        </button>
        {isLast ? (
          <button onClick={onClose}
            className="ml-auto text-sm px-4 py-1.5 rounded bg-accent text-on-accent font-bold hover:opacity-90 transition-opacity">
            See full pool →
          </button>
        ) : (
          <button onClick={() => setIndex(i => Math.min(total - 1, i + 1))}
            className="ml-auto text-sm px-4 py-1.5 rounded bg-accent text-on-accent font-bold hover:opacity-90 transition-opacity">
            Next booster →
          </button>
        )}
      </div>
    </div>
  )
}
