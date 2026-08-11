import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

// App-wide "tap a card to see it full screen" overlay. Hover-zoom (PoolGrid) only works on
// desktop; this is the mobile-friendly way to actually read a card — important when players
// are discovering a new set. Any card tile calls useCardZoom().open(card); the modal is
// rendered once at the app root (see main.jsx) so it sits above everything.
const CardZoomContext = createContext(null)

export function useCardZoom() {
  return useContext(CardZoomContext) ?? { open: () => {}, close: () => {} }
}

export function CardZoomProvider({ children }) {
  const [card, setCard] = useState(null)
  const open = useCallback(c => { if (c && (c.imagePath || c.name)) setCard(c) }, [])
  const close = useCallback(() => setCard(null), [])

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
    <CardZoomContext.Provider value={{ open, close }}>
      {children}
      {card && createPortal(
        <div onClick={close} role="dialog" aria-modal="true"
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 cursor-zoom-out">
          {card.imagePath ? (
            <img src={card.imagePath} alt={card.name ?? ''}
              className="max-h-[92vh] max-w-[94vw] w-auto h-auto rounded-2xl shadow-2xl select-none" />
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