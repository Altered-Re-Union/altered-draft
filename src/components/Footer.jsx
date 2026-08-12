import { useLang } from '../lib/i18n/i18n.jsx'

// Altered's Fan Content Policy badge + disclaimer — required on every page that uses their
// IP. Shared so it's consistent everywhere it appears (previously duplicated inline on
// Home only); see .fan-content-badge in index.css for the dark-mode invert filter.
export default function Footer() {
  const { t } = useLang()
  return (
    <div className="mt-8 py-6 flex flex-col items-center gap-2">
      <img src="/images/fan-content.png" alt="Altered Fan Content" className="fan-content-badge h-8 w-auto" />
      <p className="text-xs text-faint text-center px-4">{t('footer.fanContentDisclaimer')}</p>
    </div>
  )
}