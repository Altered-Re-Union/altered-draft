import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n/i18n.jsx'
import { copyText, canNativeShare, nativeShare, tournamentShareUrl } from '../lib/share.js'
import QrCode from './QrCode.jsx'
import QrModal from './QrModal.jsx'

// Share box of the tournament page: link, copy, native share (when available) and QR code.
// Below `sm` the inline QR is hidden and a "Show QR code" button opens it large in a dialog.
export default function ShareBox({ tournament }) {
  const { t } = useLang()
  const [copied, setCopied] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const closeQr = useCallback(() => setQrOpen(false), [])
  const inputRef = useRef(null)
  const timer = useRef(null)
  const url = tournamentShareUrl(tournament.id)

  useEffect(() => () => clearTimeout(timer.current), [])

  const hint = tournament.visibility === 'private'
    ? t('tournaments.sharePrivateHint')
    : (tournament.status === 'upcoming' || tournament.status === 'ongoing') ? t('tournaments.shareHint') : null

  async function handleCopy() {
    const ok = await copyText(url)
    if (!ok) { inputRef.current?.focus(); inputRef.current?.select(); return }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section data-testid="share-box" aria-labelledby="share-title" className="bg-surface rounded-xl border border-line p-4">
      <div className="flex gap-4 items-start">
        <div className="flex-1 min-w-0 space-y-3">
          <h2 id="share-title" className="font-semibold text-sm">{t('tournaments.shareTitle')}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
          <input
            ref={inputRef} readOnly data-testid="share-url" aria-label={t('tournaments.shareTitle')}
            value={url} onFocus={e => e.target.select()}
            className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-xs font-mono text-ink"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="share-copy" onClick={handleCopy}
              className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${copied ? 'bg-ok-soft text-ok' : 'bg-accent text-on-accent hover:bg-accent2'}`}>
              {copied ? t('tournaments.shareCopied') : t('tournaments.shareCopy')}
            </button>
            {canNativeShare() && (
              <button type="button" data-testid="share-native" onClick={() => nativeShare({ title: tournament.name, url })}
                className="px-3 py-2 rounded-lg text-sm border border-line bg-surface2 text-ink2 hover:bg-surface3">
                {t('tournaments.shareNative')}
              </button>
            )}
            <button type="button" data-testid="share-qr-open" onClick={() => setQrOpen(true)}
              className="sm:hidden px-3 py-2 rounded-lg text-sm border border-line bg-surface2 text-ink2 hover:bg-surface3">
              {t('tournaments.shareQrShow')}
            </button>
          </div>
        </div>
        <QrCode value={url} label={t('tournaments.shareQrAlt')} testId="share-qr" className="hidden sm:block shrink-0" />
      </div>
      {qrOpen && (
        <QrModal value={url} title={t('tournaments.shareTitle')} label={t('tournaments.shareQrAlt')}
          closeLabel={t('tournaments.shareQrClose')} onClose={closeQr} />
      )}
    </section>
  )
}
