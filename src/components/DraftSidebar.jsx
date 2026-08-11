import { useState } from 'react'
import { FACTIONS, FACTION_NAMES, FACTION_COLORS } from '../lib/cardData.js'
import { FACTION_ICONS, RARITY_GEMS, SET_ICONS, setCodeFromRef } from '../lib/assets.js'
import { buildDecklist, groupPicksByFaction } from '../lib/exportFormat.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import ExportButton from './ExportButton.jsx'
import DraftStats from './DraftStats.jsx'

export default function DraftSidebar({ pickedRefs, cardMap, round, code }) {
  const [tab, setTab] = useState('picks')
  const { t, tc } = useLang()
  const grouped = groupPicksByFaction(pickedRefs, cardMap)
  const decklist = buildDecklist(pickedRefs, cardMap)
  const total = pickedRefs.length
  const tabLabels = { picks: t('draftSidebar.tabPicks'), stats: t('draftSidebar.tabStats') }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-line">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{t('draftSidebar.yourPicks')}</h3>
          <span className="text-xs text-faint">{tc('draftSidebar.cardCount', total)}</span>
        </div>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4].map(r => (
            <div key={r} className={`h-1 flex-1 rounded-full ${r <= round ? 'bg-accent' : 'bg-surface3'}`} />
          ))}
        </div>
        <p className="text-xs text-faint mt-1">{t('draftSidebar.packOfFour', { n: round })}</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line">
        {['picks', 'stats'].map(tabId => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === tabId
                ? 'text-accent border-b-2 border-accent2'
                : 'text-faint hover:text-ink2'
            }`}
          >
            {tabLabels[tabId]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'picks' ? (
          <div className="px-4 py-3 space-y-4">
            {/* Heroes */}
            {grouped.HERO && (
              <section>
                <h4 className="text-xs uppercase tracking-widest text-accent mb-1">{t('draftSidebar.hero')}</h4>
                {Object.entries(grouped.HERO).map(([ref, qty]) => (
                  <PickRow key={ref} ref_={ref} qty={qty} card={cardMap[ref]} />
                ))}
              </section>
            )}

            {FACTIONS.map(f => {
              const group = grouped[f]
              if (!group) return null
              const fTotal = Object.values(group).reduce((a, b) => a + b, 0)
              return (
                <section key={f}>
                  <h4 className={`text-xs mb-1 inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border ${FACTION_COLORS[f]}`}>
                    {FACTION_ICONS[f] && (
                      <img src={FACTION_ICONS[f]} alt="" className="w-3.5 h-3.5 object-contain" />
                    )}
                    {FACTION_NAMES[f] ?? f} <span className="opacity-60">({fTotal})</span>
                  </h4>
                  <div className="space-y-0.5">
                    {Object.entries(group)
                      .sort((a, b) => (cardMap[a[0]]?.name ?? '').localeCompare(cardMap[b[0]]?.name ?? ''))
                      .map(([ref, qty]) => (
                        <PickRow key={ref} ref_={ref} qty={qty} card={cardMap[ref]} />
                      ))}
                  </div>
                </section>
              )
            })}

            {total === 0 && (
              <p className="text-xs text-faint italic">{t('draftSidebar.noPicksYet')}</p>
            )}
          </div>
        ) : (
          <DraftStats pickedRefs={pickedRefs} cardMap={cardMap} />
        )}
      </div>

      {/* Export */}
      <div className="p-4 border-t border-line">
        <ExportButton decklist={decklist} small />
      </div>
    </div>
  )
}

function PickRow({ ref_, qty, card }) {
  const rarityGem = card?.rarity && card?.cardType !== 'HERO' ? RARITY_GEMS[card.rarity] : null
  const setIcon = SET_ICONS[setCodeFromRef(ref_)]
  return (
    <div className="flex items-center gap-1.5 text-xs py-0.5">
      <span className="w-5 text-center text-faint font-mono shrink-0">{qty}</span>
      <span className="text-ink2 truncate flex-1">{card?.name ?? ref_}</span>
      {rarityGem && <img src={rarityGem} alt={card.rarity} className="w-3.5 h-3.5 object-contain shrink-0" />}
      {setIcon && <img src={setIcon} alt="" className="w-3.5 h-3.5 object-contain shrink-0 opacity-60" />}
    </div>
  )
}
