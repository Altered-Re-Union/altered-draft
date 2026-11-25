import { createPortal } from 'react-dom'
import { useLang } from '../lib/i18n/i18n.jsx'
import CubeContents from './CubeContents.jsx'

export default function CubePreviewModal({ cube, onClose }) {
  const { t, tc } = useLang()

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-surface rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-line shrink-0">
          <div>
            <h2 className="font-bold text-lg">{cube.name}</h2>
            <p className="text-sm text-faint">{t('cubePreview.byAuthorCards', { author: cube.author, cards: tc('cubePreview.cardCount', cube.cardCount) })}</p>
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink text-xl leading-none p-1">✕</button>
        </div>

        <CubeContents refs={cube.refs} booster={cube.booster} />
      </div>
    </div>,
    document.body
  )
}
