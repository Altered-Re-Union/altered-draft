import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../lib/i18n/i18n.jsx'

// Holographic tilt/shine effect on the zoomed card image, ported from simeydotme's
// pokemon-cards-css (https://codepen.io/simeydotme/pen/abYWJdX). Pointer position sets
// --pointer-x/--pointer-y and a tilt rotation as inline CSS vars; the gradient layers
// themselves live in index.css (.holo-card*) so this component only tracks input.
// Common cards get only the tilt, no shine at all. Rare gets a barely-there glare so it
// reads as a very slight step up from Common. Exalted/Unique keep their full rainbow/gold
// sheen, with a distinct look per rarity (see index.css).
function holoClassForRarity(rarity) {
  if (rarity === 'EX') return 'holo-card--ex'
  if (rarity === 'U') return 'holo-card--u'
  if (rarity === 'R1' || rarity === 'R2') return 'holo-card--r'
  return ''
}

function useHoloTilt() {
  const rotatorRef = useRef(null)
  const zoneRef = useRef(null) // wraps the card with extra padding so tilt keeps tracking a bit past its edges

  const applyFromClientPoint = useCallback((clientX, clientY) => {
    const el = rotatorRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
    const py = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100))
    const centerX = px - 50
    const centerY = py - 50
    el.style.setProperty('--pointer-x', `${px}%`)
    el.style.setProperty('--pointer-y', `${py}%`)
    el.style.setProperty('--rotate-x', `${-(centerX / 3.5)}deg`)
    el.style.setProperty('--rotate-y', `${centerY / 3.5}deg`)
    el.style.setProperty('--card-opacity', '1')
  }, [])

  const reset = useCallback(() => {
    const el = rotatorRef.current
    if (!el) return
    el.style.setProperty('--pointer-x', '50%')
    el.style.setProperty('--pointer-y', '50%')
    el.style.setProperty('--rotate-x', '0deg')
    el.style.setProperty('--rotate-y', '0deg')
    el.style.setProperty('--card-opacity', '0')
  }, [])

  const onPointerMove = useCallback(e => applyFromClientPoint(e.clientX, e.clientY), [applyFromClientPoint])
  const onPointerLeave = useCallback(() => reset(), [reset])

  // Mobile devices without a mouse get the effect driven by device tilt instead of touch,
  // since touch position is already used for swipe navigation between cards.
  useEffect(() => {
    const onOrientation = e => {
      const el = rotatorRef.current
      if (!el || e.beta == null || e.gamma == null) return
      const x = Math.min(18, Math.max(-18, e.gamma))
      const y = Math.min(18, Math.max(-18, e.beta - 45))
      el.style.setProperty('--pointer-x', `${((x + 18) / 36) * 100}%`)
      el.style.setProperty('--pointer-y', `${((y + 18) / 36) * 100}%`)
      el.style.setProperty('--rotate-x', `${-x}deg`)
      el.style.setProperty('--rotate-y', `${y}deg`)
      el.style.setProperty('--card-opacity', '1')
    }
    window.addEventListener('deviceorientation', onOrientation)
    return () => window.removeEventListener('deviceorientation', onOrientation)
  }, [])

  return { rotatorRef, zoneRef, onPointerMove, onPointerLeave }
}

// App-wide "tap a card to see it full screen" overlay. Hover-zoom (PoolGrid) only works on
// desktop; this is the mobile-friendly way to actually read a card — important when players
// are discovering a new set. The modal is rendered once at the app root (see main.jsx).
//
// Navigation: open(refs, index) shows refs[index] with left/right arrows, arrow keys, and
// touch swipe all moving through the same ordered ref list — e.g. every card currently in a
// PoolGrid view, in on-screen order, so browsing doesn't require closing and reopening.
//
// Callers register a `resolve(ref) => { card, controls } | null` function via setResolver()
// — called on every render of the list that's on screen (deck/cardMap changes), so an open
// modal always shows live data instead of a snapshot frozen at open() time, and navigation
// can resolve any ref in the list on demand.
//
// open(refs, index, { onNext, nextLabel }) optionally wires an edge action: swiping/pressing
// right past the LAST card reveals a "next booster"-style screen (instead of a dead no-op),
// and swiping/pressing right again (or tapping its button) calls onNext(). Purely a UI hook —
// the caller decides what "next" means (e.g. advance a booster index) and re-opens the zoom
// itself if it wants the new content shown full screen.
const CardZoomContext = createContext(null)
const noop = () => {}

export function useCardZoom() {
  return useContext(CardZoomContext) ?? { open: noop, close: noop, setResolver: noop, isOpen: false }
}

const SWIPE_THRESHOLD_PX = 40

export function CardZoomProvider({ children }) {
  const [state, setState] = useState(null) // { refs, index, card, controls, atEnd, onNext, nextLabel } | null
  const stateRef = useRef(null)
  stateRef.current = state
  const resolverRef = useRef(() => null)
  const { t } = useLang()
  const { rotatorRef, zoneRef, onPointerMove, onPointerLeave } = useHoloTilt()

  const resolveAt = useCallback((refs, index) => {
    const clamped = Math.max(0, Math.min(index, refs.length - 1))
    const resolved = resolverRef.current(refs[clamped]) || {}
    return { refs, index: clamped, card: resolved.card ?? null, controls: resolved.controls ?? null }
  }, [])

  const setResolver = useCallback(fn => {
    resolverRef.current = fn
    setState(prev => (prev ? { ...resolveAt(prev.refs, prev.index), atEnd: prev.atEnd, onNext: prev.onNext, nextLabel: prev.nextLabel } : prev))
  }, [resolveAt])

  const open = useCallback((refs, index, opts = {}) => {
    if (!refs?.length) return
    const next = resolveAt(refs, index)
    if (next.card) setState({ ...next, atEnd: false, onNext: opts.onNext ?? null, nextLabel: opts.nextLabel ?? null })
  }, [resolveAt])

  const step = useCallback(delta => {
    setState(prev => {
      if (!prev) return prev
      if (delta > 0 && !prev.atEnd) {
        const index = prev.index + 1
        if (index > prev.refs.length - 1) {
          // Past the last card: reveal the "next booster" screen instead of a dead no-op,
          // but only when the caller actually wired one up via open()'s onNext.
          return prev.onNext ? { ...prev, atEnd: true } : prev
        }
        return { ...resolveAt(prev.refs, index), atEnd: false, onNext: prev.onNext, nextLabel: prev.nextLabel }
      }
      if (delta < 0) {
        if (prev.atEnd) return { ...prev, atEnd: false } // step back from the reveal screen to the last card
        const index = prev.index - 1
        if (index < 0) return prev
        return { ...resolveAt(prev.refs, index), atEnd: false, onNext: prev.onNext, nextLabel: prev.nextLabel }
      }
      return prev
    })
  }, [resolveAt])

  // Confirms the "next booster" reveal screen — reads live state directly rather than via a
  // setState updater, since calling a caller-supplied side effect from inside one risks a
  // double-invoke under StrictMode's dev-mode double-render of updaters.
  const confirmNext = useCallback(() => { stateRef.current?.onNext?.() }, [])

  const close = useCallback(() => setState(null), [])

  // Escape closes, arrow keys navigate; lock the background from scrolling while open.
  // Plain `overflow: hidden` on body doesn't actually stop touch-scroll on iOS Safari — the
  // page still creeps a few px when swiping between cards, which reveals/collapses the
  // address bar and leaves a gap above the fixed overlay. Pinning body to `position: fixed`
  // at its current scroll offset removes anything left to scroll, and restoring scrollTo on
  // close puts the page back exactly where it was.
  useEffect(() => {
    if (!state) return
    const onKey = e => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') { if (stateRef.current?.atEnd) confirmNext(); else step(1) }
    }
    window.addEventListener('keydown', onKey)
    const scrollY = window.scrollY
    const body = document.body.style
    const prev = { position: body.position, top: body.top, left: body.left, right: body.right, overflow: body.overflow }
    body.position = 'fixed'
    body.top = `-${scrollY}px`
    body.left = '0'
    body.right = '0'
    body.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      body.position = prev.position
      body.top = prev.top
      body.left = prev.left
      body.right = prev.right
      body.overflow = prev.overflow
      window.scrollTo(0, scrollY)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only presence of `state` matters here
  }, [!!state, close, step, confirmNext])

  const touchStartXRef = useRef(null)
  function onTouchStart(e) { touchStartXRef.current = e.touches[0]?.clientX ?? null }
  function onTouchEnd(e) {
    const startX = touchStartXRef.current
    touchStartXRef.current = null
    if (startX == null) return
    const dx = (e.changedTouches[0]?.clientX ?? startX) - startX
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return // treat as a tap, not a swipe
    if (dx < 0 && stateRef.current?.atEnd) { confirmNext(); return }
    step(dx < 0 ? 1 : -1)
  }

  const card = state?.card
  const controls = state?.controls
  const atEnd = !!state?.atEnd
  const hasPrev = !!state && (state.index > 0 || atEnd)
  const hasNext = !!state && !atEnd && state.index < state.refs.length - 1
  const showConfirmNext = atEnd && !!state?.onNext

  useEffect(() => { onPointerLeave() }, [card, onPointerLeave])

  return (
    <CardZoomContext.Provider value={{ open, close, setResolver, isOpen: !!state }}>
      {children}
      {card && createPortal(
        <div onClick={close} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
          role="dialog" aria-modal="true" style={{ touchAction: 'none' }}
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 cursor-zoom-out">
          {hasPrev && (
            <button onClick={e => { e.stopPropagation(); step(-1) }} aria-label={t('cardZoom.previousCard')}
              className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-surface/80 hover:bg-surface text-ink text-2xl leading-none flex items-center justify-center shadow-lg">
              ‹
            </button>
          )}
          {hasNext && (
            <button onClick={e => { e.stopPropagation(); step(1) }} aria-label={t('cardZoom.nextCard')}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-surface/80 hover:bg-surface text-ink text-2xl leading-none flex items-center justify-center shadow-lg">
              ›
            </button>
          )}
          {showConfirmNext && (
            <button onClick={e => { e.stopPropagation(); confirmNext() }} aria-label={state.nextLabel ?? t('cardZoom.nextBooster')}
              className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-accent hover:opacity-90 text-on-accent text-2xl leading-none flex items-center justify-center shadow-lg">
              ›
            </button>
          )}
          {atEnd ? (
            <div onClick={e => e.stopPropagation()} className="flex flex-col items-center gap-4 text-center px-6">
              <div className="text-ink text-base">{t('cardZoom.endOfBooster')}</div>
              {state.onNext && (
                <button onClick={confirmNext}
                  className="text-base font-bold px-6 py-3 rounded-lg bg-accent text-on-accent hover:opacity-90 transition-opacity">
                  {state.nextLabel ?? t('cardZoom.nextBooster')}
                </button>
              )}
            </div>
          ) : card.imagePath ? (
            <div className="flex flex-col items-center gap-3">
              <div ref={zoneRef} className="holo-card-zone" onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
                <div className={`holo-card max-h-[82vh] max-w-[94vw] ${holoClassForRarity(card.rarity)}`}>
                  <div ref={rotatorRef} className="holo-card__rotator">
                    <img src={card.imagePath} alt={card.name ?? ''}
                      className="max-h-[82vh] max-w-[94vw] w-auto h-auto rounded-2xl shadow-2xl select-none" />
                    <div className="holo-card__shine" />
                    <div className="holo-card__glare" />
                  </div>
                </div>
              </div>
              {controls && (
                <div onClick={e => e.stopPropagation()}
                  className="flex items-center justify-center gap-3 bg-surface/90 rounded-full px-4 py-2 shadow-lg">
                  <button onClick={controls.onRemove} disabled={!controls.canRemove}
                    className="w-12 h-12 rounded-full bg-surface2 hover:bg-red-800 disabled:opacity-25 text-ink font-bold flex items-center justify-center text-2xl leading-none transition-colors">
                    −
                  </button>
                  <span className="min-w-[3.5rem] text-center text-lg font-bold tabular-nums text-ink">
                    {controls.qty}/{controls.total}
                  </span>
                  <button onClick={controls.onAdd} disabled={!controls.canAdd}
                    className="w-12 h-12 rounded-full bg-surface2 hover:bg-green-800 disabled:opacity-25 text-ink font-bold flex items-center justify-center text-2xl leading-none transition-colors">
                    +
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-ink text-lg text-center px-6">{card.name}</div>
          )}
          <button onClick={close} aria-label={t('cardZoom.close')}
            className="absolute top-3 right-3 w-11 h-11 rounded-full bg-surface/80 hover:bg-surface text-ink text-xl leading-none flex items-center justify-center shadow-lg">
            ✕
          </button>
        </div>,
        document.body,
      )}
    </CardZoomContext.Provider>
  )
}
