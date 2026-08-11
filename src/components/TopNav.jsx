import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ReunionButton from './ReunionButton.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import HelpModal from './HelpModal.jsx'
import { FEEDBACK_URL, ALTERED_CORE_URL } from '../lib/links.js'
import { useLang } from '../lib/i18n/i18n.jsx'

// Top "menu pill" inspired by alteredcore.org's .altered-navbar: a rounded, bordered
// bar with the wordmark, ecosystem links, and the Re:Union + theme controls on the
// right. Used on the setup pages (Home, Lobby).
export default function TopNav() {
  // Inside a room the wordmark stays in that room's lobby instead of yanking the
  // player back to the create/join screen.
  const { code } = useParams()
  const home = code ? `/room/${code}` : '/'
  const [showHelp, setShowHelp] = useState(false)
  const { t } = useLang()
  const linkCls = 'text-sm text-ink2 hover:text-accent transition-colors'
  return (
    <header className="w-full px-4 pt-4">
      <nav className="max-w-5xl mx-auto px-4 py-2 rounded-2xl bg-surface2 border border-line shadow-lg flex items-center gap-3">
        <Link to={home} className="font-display tracking-wide text-lg text-ink hover:text-accent transition-colors">
          <span className="text-accent">Altered</span> Draft
        </Link>
        <a href={ALTERED_CORE_URL} target="_blank" rel="noopener noreferrer" className={`hidden sm:inline ${linkCls}`}>
          {t('topNav.alteredCore')} ↗
        </a>
        <button onClick={() => setShowHelp(true)} className={linkCls}>{t('topNav.help')}</button>
        {FEEDBACK_URL && (
          <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className={`hidden sm:inline ${linkCls}`}>
            {t('topNav.feedback')} ↗
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          <ReunionButton />
          <ThemeToggle />
        </div>
      </nav>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </header>
  )
}
