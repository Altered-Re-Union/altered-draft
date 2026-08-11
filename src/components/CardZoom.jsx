import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../lib/i18n/i18n.jsx'

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
const CardZoomContext = createContext(null)
const noop = () => {}

export function useCardZoom() {
  return useContext(CardZoomContext) ?? { open: noop, close: noop, setResolver: noop }
}

const SWIPE_THRESHOLD_PX = 40

export function CardZoomProvider({ children }) {
  const [state, setState] = useState(null) // { refs, index, card, controls } | null
  const resolverRef = useRef(() => null)
  const { t } = useLang()

  const resolveAt = useCallback((refs, index) => {
    const clamped = Math.max(0, Math.min(index, refs.length - 1))
    const resolved = resolverRef.current(refs[clamped]) || {}
    return { refs, index: clamped, card: resolved.card ?? null, controls: resolved.controls ?? null }
  }, [])

  const setResolver = useCallback(fn => {
    resolverRef.current = fn
    setState(prev => (prev ? resolveAt(prev.refs, prev.index) : prev))
  }, [resolveAt])

  const open = useCallback((refs, index) => {
    if (!refs?.length) return
    const next = resolveAt(refs, index)
    if (next.card) setState(next)
  }, [resolveAt])

  const step = useCallback(delta => {
    setState(prev => {
      if (!prev) return prev
      const index = prev.index + delta
      if (index < 0 || index > prev.refs.length - 1) return prev
      return resolveAt(prev.refs, index)
    })
  }, [resolveAt])

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
      else if (e.key === 'ArrowRight') step(1)
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
  }, [!!state, close, step])

  const touchStartXRef = useRef(null)
  function onTouchStart(e) { touchStartXRef.current = e.touches[0]?.clientX ?? null }
  function onTouchEnd(e) {
    const startX = touchStartXRef.current
    touchStartXRef.current = null
    if (startX == null) return
    const dx = (e.changedTouches[0]?.clientX ?? startX) - startX
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return // treat as a tap, not a swipe
    step(dx < 0 ? 1 : -1)
  }

  const card = state?.card
  const controls = state?.controls
  const hasPrev = !!state && state.index > 0
  const hasNext = !!state && state.index < state.refs.length - 1

  return (
    <CardZoomContext.Provider value={{ open, close, setResolver }}>
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
          {card.imagePath ? (
            <div className="flex flex-col items-center gap-3">
              <img src={card.imagePath} alt={card.name ?? ''}
                className="max-h-[82vh] max-w-[94vw] w-auto h-auto rounded-2xl shadow-2xl select-none" />
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
