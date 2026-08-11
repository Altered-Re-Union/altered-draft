import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'

const FLAGS = [
  { code: 'en', flag: '🇬🇧' },
  { code: 'fr', flag: '🇫🇷' },
]

// UI language flags (EN/FR) — always visible regardless of login state, since language
// isn't a Re:Union concept. Lives here (rather than duplicated per top bar) because this
// is the one component rendered in every header that has room for it (TopNav, Sealed,
// Results — see CLAUDE.md's theming section for where each top bar lives).
function LangFlags() {
  const { lang, setLang, t } = useLang()
  return (
    <span className="flex items-center gap-1">
      {FLAGS.map(({ code, flag }) => (
        <button key={code} onClick={() => setLang(code)}
          title={t('lang.switchTo', { name: t(`lang.${code}`) })}
          aria-label={t(`lang.${code}`)}
          className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ${
            lang === code ? 'bg-surface3 ring-1 ring-accent' : 'bg-surface2 hover:bg-surface3 opacity-70 hover:opacity-100'}`}>
          {flag}
        </button>
      ))}
    </span>
  )
}

// Connect / Disconnect control for Re:Union login. Renders nothing while the initial
// auth check is in flight, "Connect Re:Union" (+ language flags) when logged out, and the
// pseudo (+ flags) when logged in — clicking the pseudo opens a small dropdown with
// Disconnect, so that action isn't a permanently-visible button.
export default function ReunionButton({ className = '' }) {
  const { user, loading, login, logout } = useAuth()
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (loading) return null

  if (!user) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <LangFlags />
        <button onClick={() => login()}
          className="px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface3 text-sm text-ink transition-colors">
          {t('reunion.connect')}
        </button>
      </div>
    )
  }

  return (
    <div ref={box} className={`relative flex items-center gap-2 text-sm ${className}`}>
      <LangFlags />
      <button onClick={() => setOpen(o => !o)} title={t('reunion.signedInTitle')}
        className="px-2 py-1 rounded-lg text-ink2 hover:bg-surface2 hover:text-ink transition-colors">
        {user.pseudo}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 min-w-[140px] bg-surface border border-line rounded-xl shadow-2xl p-1 z-50">
          <button onClick={() => { setOpen(false); logout() }}
            className="w-full text-left px-3 py-1.5 text-xs rounded-lg text-muted hover:bg-surface2 hover:text-ink transition-colors">
            {t('reunion.disconnect')}
          </button>
        </div>
      )}
    </div>
  )
}
