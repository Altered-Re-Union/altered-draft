import { useState, useEffect, useRef } from 'react'
import { SimpleCardGrid } from './PoolGrid.jsx'
import { useCardZoom } from './CardZoom.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'

// Preload one pack's card images; resolves when they've all settled (or a per-image error).
// Returns a cancel fn. Cards in this pool load from a CDN (rares/uniques a touch slower), so
// the reveal waits on this before showing a pack — no half-painted grids.
function preloadImages(refs, cardMap, onDone) {
  const urls = refs.map(r => cardMap[r]?.imagePath).filter(Boolean)
  if (!urls.length) { onDone(); return () => {} }
  let done = 0, cancelled = false
  const tick = () => { if (!cancelled && ++done >= urls.length) onDone() }
  const imgs = urls.map(u => { const img = new Image(); img.onload = tick; img.onerror = tick; img.src = u; return img })
  return () => { cancelled = true; imgs.forEach(img => { img.onload = img.onerror = null }) }
}

/**
 * First-open reveal for a tournament sealed pool: a full-screen overlay that walks the
 * player pack by pack — the 7 boosters plus an 8th "booster" holding the guaranteed unique
 * (which lives in the pool but in no real pack) — sitting on top of the full pool. Purely a
 * presentation layer over data the page already has: dismissing it ("Skip and see full pool",
 * or the final "See full pool") just unmounts the overlay, so the player is already on the
 * deckbuilder with no tab change. The parent shows it once per pool (localStorage flag).
 *
 * Each pack is gated behind an image preload so cards appear only when ready (and the next
 * pack is warmed in the background so advancing feels instant). Deliberately plain otherwise —
 * the isolated full-screen surface is where opening cosmetics can be layered on later.
 *
 * @param {string[][]} packs - packs to reveal in order; when `hasBonus`, the LAST one is the
 *   guaranteed-unique "8th booster".
 */
export default function PackReveal({ packs, hasBonus = false, cardMap, deck, poolCounts, onAdd, onRemove, onClose }) {
  const [index, setIndex] = useState(0)
  const [ready, setReady] = useState(false)
  const packsRef = useRef(packs)
  packsRef.current = packs
  const { t } = useLang()
  const { isOpen: zoomOpen } = useCardZoom()

  // Escape skips the whole reveal (matches the always-visible Skip button) — but not while
  // the full-screen card zoom is open on top of it, since the zoom's own Escape handler
  // already backs out of just the card view, and both listeners would otherwise fire together.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !zoomOpen) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, zoomOpen])

  const currentPack = packs[index] ?? []
  const refsKey = currentPack.join('|')
  // How many of this pack's cards are resolved in cardMap yet — grows as fetchUniques lands,
  // so the effect re-runs (and stops waiting) the moment the pack's data is fully available.
  const resolvedCount = currentPack.reduce((n, r) => n + (cardMap[r] ? 1 : 0), 0)

  // Gate the current pack: wait for its card DATA, then preload its IMAGES, then reveal.
  useEffect(() => {
    setReady(false)
    const refs = packsRef.current[index] ?? []
    if (refs.some(r => !cardMap[r])) return // data not in yet — re-runs when resolvedCount changes
    const cancelPreload = preloadImages(refs, cardMap, () => setReady(true))
    const timer = setTimeout(() => setReady(true), 8000) // never hang on a stuck image
    return () => { cancelPreload(); clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, refsKey, resolvedCount])

  // Warm the next pack's images in the background once the current one is shown.
  useEffect(() => {
    if (!ready) return
    const next = packsRef.current[index + 1]
    if (next) preloadImages(next, cardMap, () => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, index])

  if (!packs.length) return null

  const total = packs.length
  const isLast = index >= total - 1
  const isBonusPack = hasBonus && isLast

  return (
    <div className="fixed inset-0 z-50 bg-base flex flex-col">
      {/* Top bar: title */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
        <h2 className="text-lg font-display">{t('packReveal.openingYourPool')}</h2>
      </div>

      {/* Pack heading */}
      <div className="px-4 pt-3 pb-2 text-center">
        <div className="text-sm text-ink2 tabular-nums">{t('packReveal.boosterOf', { n: index + 1, total })}</div>
        {isBonusPack && <div className="text-xs text-accent2 mt-0.5">{t('packReveal.guaranteedUnique')}</div>}
      </div>

      {/* Current pack — shown only once its images are ready (buffering spinner until then) */}
      <div className="flex-1 min-h-0 mx-4 mb-3 bg-surface rounded-xl border border-line overflow-y-auto">
        {ready ? (
          <SimpleCardGrid
            refs={currentPack}
            cardMap={cardMap}
            deck={deck}
            poolCounts={poolCounts}
            onAdd={onAdd}
            onRemove={onRemove}
            autoZoom
            onZoomNext={isLast ? null : () => setIndex(i => Math.min(total - 1, i + 1))}
            zoomNextLabel={t('packReveal.nextBooster')}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-muted">
            <div className="w-8 h-8 rounded-full border-2 border-line border-t-accent animate-spin" />
            <span className="text-sm">{t('packReveal.openingBooster')}</span>
          </div>
        )}
      </div>

      {/* Nav: Previous · [Skip and see full pool] · Next — skip is the big, central action */}
      <div className="grid grid-cols-3 items-center gap-3 px-4 py-3 border-t border-line">
        <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index <= 0}
          className="justify-self-start text-sm font-semibold px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent hover:text-on-accent disabled:opacity-30 transition-colors">
          {t('packReveal.previous')}
        </button>
        <button onClick={onClose}
          className="justify-self-center text-base font-bold px-6 py-3 rounded-lg bg-accent text-on-accent hover:opacity-90 transition-opacity">
          {isLast ? t('packReveal.seeFullPool') : t('packReveal.skipAndSeeFullPool')}
        </button>
        {isLast ? <span /> : (
          <button onClick={() => setIndex(i => Math.min(total - 1, i + 1))}
            className="justify-self-end text-sm font-semibold px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent hover:text-on-accent transition-colors">
            {t('packReveal.nextBooster')}
          </button>
        )}
      </div>
    </div>
  )
}
