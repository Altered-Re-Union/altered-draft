import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useZoomOrigin } from './PoolGrid.jsx'
import CardImage from './CardImage.jsx'

// Standalone, view-only card art (Winston piles, the blind-drawn card, the hero strip).
// Hover grows it in place (anchored so it never spills off-screen); clicking opens a
// full-size lightbox so the card is fully readable. `width` is a Tailwind width class,
// `overlay` renders badges over the art, `highlight` rings it.
const HOVER_SCALE = 2 // bigger than the deckbuilder grid (1.6) since these cards are small
export default function ZoomCard({ card, ref_, width = 'w-24', overlay = null, highlight = false }) {
  const { ref, origin, onMouseEnter } = useZoomOrigin(HOVER_SCALE)
  const [full, setFull] = useState(false)
  const name = card?.name ?? ref_

  useEffect(() => {
    if (!full) return
    const onKey = e => { if (e.key === 'Escape') setFull(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [full])

  return (
    <>
      <button
        ref={ref} onMouseEnter={onMouseEnter} onClick={() => setFull(true)}
        style={{ transformOrigin: origin }} title={name}
        className={`block ${width} aspect-[2/3] shrink-0 relative overflow-hidden rounded-lg border bg-surface2 cursor-zoom-in
          transition-transform duration-150 ease-out hover:scale-[2] hover:z-30 hover:shadow-xl hover:shadow-black/70
          ${highlight ? 'border-accent ring-2 ring-accent/60' : 'border-line'}`}>
        <CardImage card={card} alt={name} loading="lazy" className="w-full h-full object-cover" fallback={
          <div className="w-full h-full flex items-center justify-center p-1 text-[10px] text-faint text-center leading-tight">{name}</div>
        } />
        {overlay}
      </button>

      {full && createPortal(
        <div className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setFull(false)}>
          <CardImage card={card} alt={name} className="max-h-[92vh] max-w-[92vw] rounded-2xl shadow-2xl object-contain"
            backClassName="w-[min(92vw,66vh)] aspect-[744/1039] rounded-2xl shadow-2xl" fallback={
              <div className="bg-surface border border-line rounded-2xl px-8 py-12 text-ink text-lg">{name}</div>
            } />
        </div>,
        document.body
      )}
    </>
  )
}
