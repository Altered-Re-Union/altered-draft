import { useState } from 'react'
import { useLang } from '../lib/i18n/i18n.jsx'

export default function ExportButton({ decklist, small }) {
  const [state, setState] = useState('idle') // idle | copied | error
  const { t } = useLang()

  async function handleCopy() {
    if (!decklist) return
    try {
      await navigator.clipboard.writeText(decklist)
      setState('copied')
    } catch {
      // Fallback for browsers that deny clipboard API
      try {
        const ta = document.createElement('textarea')
        ta.value = decklist
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setState('copied')
      } catch {
        setState('error')
      }
    }
    setTimeout(() => setState('idle'), 2500)
  }

  const label = state === 'copied' ? t('exportButton.copied')
    : state === 'error' ? t('exportButton.copyFailed')
    : t('exportButton.copyDecklist')

  return (
    <button
      onClick={handleCopy}
      disabled={!decklist}
      className={`
        ${small ? 'w-full py-2 text-xs' : 'px-4 py-2 text-sm'}
        rounded-lg font-medium transition-colors disabled:opacity-40
        ${state === 'copied' ? 'bg-green-600 text-white'
          : state === 'error' ? 'bg-red-700 text-white'
          : 'bg-accent hover:bg-accent2 text-on-accent'}
      `}
    >
      {label}
    </button>
  )
}
