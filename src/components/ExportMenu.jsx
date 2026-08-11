import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider.jsx'
import { createDeck, toDeckCards } from '../lib/decks.js'
import { useLang } from '../lib/i18n/i18n.jsx'

// Where "open ↗" points after a save. A finished DECK is a legal deck (one hero), so use
// altered.re's clean per-deck viewer (handles its own login, no raw 401). A saved POOL is
// NOT a legal deck — it holds every hero + 90+ cards — and altered.re renders decks
// through a legality lens that only surfaces ONE hero, so a pool looks like it lost
// heroes there. Open pools in the Re:Union deckbuilder instead, which lists the full pool
// incl. every hero. (Nothing is dropped on save — the decks API stores all heroes as
// deckCards; this is purely which viewer reads them back.)
const openUrl = (id, kind) => kind === 'pool'
  ? `https://deckbuilder.alteredcore.org/decks/${encodeURIComponent(id)}`
  : `https://altered.re/pages/deck?id=${encodeURIComponent(id)}`

// DDMM for saved-deck names (e.g. 1706).
function ddmm() {
  const d = new Date()
  return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0')
}

async function copyText(text) {
  if (!text) return false
  try { await navigator.clipboard.writeText(text); return true }
  catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta)
      return true
    } catch { return false }
  }
}

// One dropdown for both copying card lists (altered.re format) and saving to Re:Union —
// replaces the separate copy + save buttons on Results & Sealed. `format` is the human
// label ("Draft" | "Sealed") woven into saved deck names, e.g. "AB12 · Draft deck · 1706".
// `deckIsValid` mirrors the page's own validity check (≥30 non-hero cards, ≤3 factions,
// ≤1 hero) — a saved deck only clears isDraft on the decks API once it's actually legal there.
export default function ExportMenu({ poolRefs, deckRefs, deckIsValid = false, poolDecklist, deckDecklist, name, format = 'Draft' }) {
  const { user, login } = useAuth()
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [saving, setSaving] = useState(null) // 'pool' | 'deck' | null
  const [saved, setSaved] = useState({})     // { pool?, deck?, poolErr?, deckErr? }
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const hasDeck = deckRefs?.length > 0

  async function copy(text, label) {
    const ok = await copyText(text)
    setToast(ok ? t('exportMenu.copiedSuffix', { label }) : t('exportMenu.copyFailed'))
    setTimeout(() => setToast(''), 2000)
  }

  async function save(kind) {
    const refs = kind === 'pool' ? poolRefs : deckRefs
    if (!refs?.length) return
    setSaving(kind)
    setSaved(s => ({ ...s, [kind]: undefined, [`${kind}Err`]: undefined }))
    try {
      const deckName = `${name} · ${format} ${kind} · ${ddmm()}`
      // Pools open in deckbuilder.alteredcore.org, which 401s on a PRIVATE deck when the
      // viewer isn't logged in there → save pools PUBLIC so the "Open ↗" link just works
      // (and is shareable). Decks stay private: they open on altered.re, which handles login.
      // A deck only loses draft status once it's actually valid per our own rules — pushing
      // an unfinished deck as non-draft would misreport it as legal on the decks API.
      const { id } = await createDeck({ name: deckName, deckCards: toDeckCards(refs), isDraft: kind === 'pool' ? true : !deckIsValid, format: 'sandbox', isPublic: kind === 'pool' })
      setSaved(s => ({ ...s, [kind]: id }))
    } catch (e) {
      setSaved(s => ({ ...s, [`${kind}Err`]: e.message }))
    }
    setSaving(null)
  }

  const item = 'w-full flex items-center justify-between gap-3 text-left px-3 py-2 text-sm rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen(o => !o)}
        className="px-3 py-1.5 bg-accent hover:bg-accent2 text-on-accent font-medium text-sm rounded-lg transition-colors flex items-center gap-1.5">
        {t('exportMenu.exportSave')} <span className="text-xs">▾</span>
      </button>
      {toast && !open && <span className="absolute right-0 top-full mt-1 text-xs text-green-400 whitespace-nowrap">{toast}</span>}

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-line rounded-xl shadow-2xl p-2 z-50 space-y-0.5">
          <p className="px-3 pt-1 pb-1.5 text-xs uppercase tracking-widest text-faint">{t('exportMenu.copyForAlteredRe')} {toast && <span className="text-green-400 normal-case tracking-normal ml-1">{toast}</span>}</p>
          <button className={`${item} hover:bg-surface2 text-ink`} onClick={() => copy(poolDecklist, t('exportMenu.poolLabel'))} disabled={!poolDecklist}>
            <span>{t('exportMenu.copyYourPool')}</span>
            <span className="text-xs text-faint">{poolRefs?.length ?? 0}</span>
          </button>
          <button className={`${item} hover:bg-surface2 text-ink`} onClick={() => copy(deckDecklist, t('exportMenu.deckLabel'))} disabled={!hasDeck}>
            <span>{t('exportMenu.copyYourDeck')}</span>
            <span className="text-xs text-faint">{deckRefs?.length ?? 0}</span>
          </button>

          <div className="h-px bg-surface2 my-1.5" />
          <p className="px-3 pb-1.5 text-xs uppercase tracking-widest text-faint">{t('exportMenu.saveToReunion')}</p>

          {!user ? (
            <button className={`${item} hover:bg-surface2 text-accent`} onClick={() => login()}>
              {t('exportMenu.connectToSave')}
            </button>
          ) : (
            <>
              <button className={`${item} hover:bg-surface2 text-ink`} onClick={() => save('pool')} disabled={saving === 'pool' || !poolRefs?.length}>
                <span>{saving === 'pool' ? t('exportMenu.saving') : t('exportMenu.saveYourPool')}</span>
                {saved.pool ? <a href={openUrl(saved.pool, 'pool')} target="_blank" rel="noopener noreferrer" className="text-xs text-green-400 hover:underline" onClick={e => e.stopPropagation()}>{t('exportMenu.open')}</a>
                  : saved.poolErr ? <span className="text-xs text-red-400" title={saved.poolErr}>{t('exportMenu.failed')}</span>
                  : <span className="text-xs text-faint">{poolRefs?.length ?? 0}</span>}
              </button>
              <button className={`${item} hover:bg-surface2 text-ink`} onClick={() => save('deck')} disabled={saving === 'deck' || !hasDeck}>
                <span>{saving === 'deck' ? t('exportMenu.saving') : t('exportMenu.saveYourDeck')}</span>
                {saved.deck ? <a href={openUrl(saved.deck, 'deck')} target="_blank" rel="noopener noreferrer" className="text-xs text-green-400 hover:underline" onClick={e => e.stopPropagation()}>{t('exportMenu.open')}</a>
                  : saved.deckErr ? <span className="text-xs text-red-400" title={saved.deckErr}>{t('exportMenu.failed')}</span>
                  : <span className="text-xs text-faint">{deckRefs?.length ?? 0}</span>}
              </button>
              <p className="px-3 pt-1 text-xs text-faint">{t('exportMenu.savedAs', { pseudo: user.pseudo })}{!deckIsValid && hasDeck ? t('exportMenu.draftUntilValid') : ''}</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}