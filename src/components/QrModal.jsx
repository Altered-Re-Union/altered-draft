import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import QrCode from './QrCode.jsx'

// A QR code shown large in a dialog: on a phone the inline QR is hidden (no room for it),
// so the share box opens this one instead. Closes on the button, a click outside or Escape,
// and gives focus back to whatever opened it.
export default function QrModal({ value, title, label, closeLabel, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    const opener = document.activeElement
    closeRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [onClose])

  return createPortal(
    <div data-testid="share-qr-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-qr-title" data-testid="share-qr-dialog"
        className="bg-surface rounded-2xl w-full max-w-sm shadow-2xl border border-line p-5 flex flex-col items-center gap-4">
        <h2 id="share-qr-title" className="font-semibold text-sm text-ink self-start">{title}</h2>
        <QrCode value={value} label={label} size={320} testId="share-qr-large" className="w-full h-auto max-w-[320px]" />
        <button ref={closeRef} type="button" data-testid="share-qr-close" onClick={onClose}
          className="w-full px-3 py-2 rounded-lg text-sm font-semibold border border-line bg-surface2 text-ink hover:bg-surface3">
          {closeLabel}
        </button>
      </div>
    </div>,
    document.body
  )
}
