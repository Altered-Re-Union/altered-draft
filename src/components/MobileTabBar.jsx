import { useLang } from '../lib/i18n/i18n.jsx'

export default function MobileTabBar({ tab, setTab, pickCount }) {
  const { t } = useLang()
  const tabs = [
    { id: 'pack', label: t('mobileTabBar.pack'), icon: '🃏' },
    { id: 'picks', label: t('mobileTabBar.picks', { n: pickCount }), icon: '📋' },
    { id: 'stats', label: t('mobileTabBar.stats'), icon: '📊' },
  ]
  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-line flex z-40">
      {tabs.map(tabInfo => (
        <button
          key={tabInfo.id}
          onClick={() => setTab(tabInfo.id)}
          className={`flex-1 py-3 flex flex-col items-center gap-0.5 text-xs transition-colors ${
            tab === tabInfo.id ? 'text-accent' : 'text-faint'
          }`}
        >
          <span className="text-base leading-none">{tabInfo.icon}</span>
          <span>{tabInfo.label}</span>
        </button>
      ))}
    </div>
  )
}
