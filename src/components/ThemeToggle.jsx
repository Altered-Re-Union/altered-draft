import { useState } from 'react'
import { getTheme, toggleTheme } from '../lib/theme.js'
import { useLang } from '../lib/i18n/i18n.jsx'

// Light/dark switch. Colors are CSS-var driven so flipping the theme needs no React
// re-render of other components; only this button tracks state to swap its own icon.
export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(getTheme())
  const { t } = useLang()
  const isDark = theme === 'dark'
  return (
    <button
      onClick={() => setTheme(toggleTheme())}
      title={isDark ? t('theme.toLight') : t('theme.toDark')}
      aria-label={t('theme.toggle')}
      className={`w-8 h-8 rounded-lg bg-surface2 hover:bg-surface3 text-ink2 flex items-center justify-center transition-colors ${className}`}>
      {isDark ? '☀' : '☾'}
    </button>
  )
}
