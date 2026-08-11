import { createPortal } from 'react-dom'
import { useLang } from '../lib/i18n/i18n.jsx'

// Short "how it works" overlay opened from the top menu.
export default function HelpModal({ onClose }) {
  const { t } = useLang()
  const Section = ({ title, children }) => (
    <div>
      <h3 className="font-display text-base font-semibold text-ink mb-1">{title}</h3>
      <p className="text-sm text-ink2 leading-relaxed">{children}</p>
    </div>
  )
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl border border-line">
        <div className="flex items-center justify-between p-5 border-b border-line shrink-0">
          <h2 className="font-display text-lg text-ink">{t('helpModal.title')}</h2>
          <button onClick={onClose} className="text-faint hover:text-ink text-xl leading-none p-1">✕</button>
        </div>
        <div className="p-5 space-y-4 overflow-y-auto">
          <Section title={t('helpModal.draftTitle')}>{t('helpModal.draftBody')}</Section>
          <Section title={t('helpModal.sealedTitle')}>{t('helpModal.sealedBody')}</Section>
          <Section title={t('helpModal.cubesTitle')}>{t('helpModal.cubesBody')}</Section>
          <Section title={t('helpModal.reunionTitle')}>{t('helpModal.reunionBody')}</Section>
          <Section title={t('helpModal.exportingTitle')}>{t('helpModal.exportingBody')}</Section>
        </div>
      </div>
    </div>,
    document.body
  )
}
