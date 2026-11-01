import { useState, useEffect } from 'react'
import { getUniqueFace, subscribeUniqueFace, requestUniqueFace, retryUniqueFace } from '../lib/uniqueFaces.js'
import { useLang } from '../lib/i18n/i18n.jsx'

// A unique's face state, requested on mount — { status, src } (see uniqueFaces.js).
// `card.faceLang` marks a unique whose face must be drawn; anything else returns null.
export function useUniqueFace(card) {
  const ref = card?.faceLang ? card.reference : null
  const lang = card?.faceLang
  const [face, setFace] = useState(() => ref ? getUniqueFace(ref, lang) : null)
  useEffect(() => {
    if (!ref) { setFace(null); return }
    const sync = () => setFace(getUniqueFace(ref, lang))
    const unsubscribe = subscribeUniqueFace(ref, lang, sync)
    requestUniqueFace(ref, lang)
    sync()
    return unsubscribe
  }, [ref, lang])
  return face
}

/**
 * A card's art. For a unique whose face is still being drawn: the card back with a gold
 * sweep, never the base rare's art; if the drawing failed, the still card back with a retry
 * button. `className` styles the image, `backClassName` (default `className`) the card back —
 * an image sized by its natural width (the zoom) needs an explicit size there. `fallback`
 * renders when there's no art at all (card data not loaded yet).
 */
export default function CardImage({ card, alt, className = '', backClassName, loading, fallback = null }) {
  const face = useUniqueFace(card)
  const { t } = useLang()
  const src = card?.imagePath ?? (face?.status === 'ready' ? face.src : null)

  if (src) {
    return <img src={src} alt={alt ?? card?.name ?? ''} className={className} loading={loading}
      onError={e => { e.currentTarget.style.display = 'none' }} />
  }
  if (!face) return fallback

  const failed = face.status === 'failed'
  const retry = e => { e.preventDefault(); e.stopPropagation(); retryUniqueFace(card.reference, card.faceLang) }
  return (
    <div role="img" aria-label={failed ? t('cardImage.failed', { name: card.name }) : t('cardImage.pending', { name: card.name })}
      aria-busy={!failed}
      className={`unique-back ${failed ? '' : 'unique-back--pending'} ${backClassName ?? className}`}>
      {failed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          {/* A span, not a <button>: several tiles are buttons themselves, and buttons can't nest. */}
          <span role="button" tabIndex={0} onClick={retry} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') retry(e) }}
            className="px-2 py-1 rounded-md bg-accent text-on-accent text-xs font-bold shadow hover:opacity-90 cursor-pointer">
            {t('cardImage.retry')}
          </span>
        </div>
      )}
    </div>
  )
}
