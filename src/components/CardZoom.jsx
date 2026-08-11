import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

// App-wide "tap a card to see it full screen" overlay. Hover-zoom (PoolGrid) only works on
// desktop; this is the mobile-friendly way to actually read a card — important when players
// are discovering a new set. Any card tile calls useCardZoom().open(card); the modal is
// rendered once at the app root (see main.jsx) so it sits above everything.
//
// Optional deck +/- controls: open(card, id, controls) shows a qty/total + +/- bar under the
// image. `id` identifies the card slot (its ref) so a caller can push fresh numbers in via
// sync(id, controls) as its own qty/total change — otherwise the modal would freeze on the
// snapshot taken at open() time and drift from the live deck state.
const CardZoomContext = createContext(null)

export function useCardZoom() {
  return useContext(CardZoomContext) ?? { open: () => {}, close: () => {}, sync: () => {} }
}

export function CardZoomProvider({ children }) {
  const [card, setCard] = useState(null)
  const [controls, setControls] = useState(null)
  const openId = useRef(null)

  const open = useCallback((c, id = null, ctrl = null) => {
    if (c && (c.imagePath || c.name)) { openId.current = id; setCard(c); setControls(ctrl) }
  }, [])
  const sync = useCallback((id, ctrl) => {
    if (openId.current !== null && openId.current === id) setControls(ctrl)
  }, [])
  const close = useCallback(() => { openId.current = null; setCard(null); setControls(null) }, [])

  // Escape closes; lock the background from scrolling while open.
  useEffect(() => {
    if (!card) return
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [card, close])

  return (
    <CardZoomContext.Provider value={{ open, close, sync }}>
      {children}
      {card && createPortal(
        <div onClick={close} role="dialog" aria-modal="true"
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 cursor-zoom-out">
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
          <button onClick={close} aria-label="Close"
            className="absolute top-3 right-3 w-11 h-11 rounded-full bg-surface/80 hover:bg-surface text-ink text-xl leading-none flex items-center justify-center shadow-lg">
            ✕
          </button>
        </div>,
        document.body,
      )}
    </CardZoomContext.Provider>
  )
}