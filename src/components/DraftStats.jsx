import { useState } from 'react'
import { FACTIONS, FACTION_NAMES, FACTION_COLORS, SET_ABBREV, SET_ABBREV_ICON_CODE } from '../lib/cardData.js'
import { FACTION_ICONS, RARITY_GEMS, SET_ICONS, setCodeFromRef } from '../lib/assets.js'
import { useLang } from '../lib/i18n/i18n.jsx'

const SET_ORDER = ['BTG', 'TBF', 'WTM', 'SKY', 'SDU', 'ROC', 'NEJ']

// `label` is a STABLE internal grouping key (also used to look up `typeCounts['Hero']`
// below) — never rendered directly. Render text comes from draftStats.type<Label> in the
// i18n dict instead, via TYPE_LABEL_KEY, so switching UI language can't desync the grouping.
const TYPE_GROUPS = {
  HERO:                 { label: 'Hero',       color: 'text-accent' },
  CHARACTER:            { label: 'Character',  color: 'text-blue-400' },
  SPELL:                { label: 'Spell',      color: 'text-purple-400' },
  PERMANENT:            { label: 'Permanent',  color: 'text-green-400' },
  LANDMARK_PERMANENT:   { label: 'Permanent',  color: 'text-green-400' },
  EXPEDITION_PERMANENT: { label: 'Permanent',  color: 'text-green-400' },
}
const TYPE_LABEL_KEY = {
  Hero: 'draftStats.typeHero', Character: 'draftStats.typeCharacter',
  Spell: 'draftStats.typeSpell', Permanent: 'draftStats.typePermanent',
}

const FACTION_BAR_COLORS = {
  AX: '#894b33', BR: '#9e3c40', LY: '#d89da3',
  MU: '#3f9085', OR: '#00628e', YZ: '#6d4f95',
}

function buildCostCounts(cards, costField) {
  const counts = {}
  let max = 0
  for (const c of cards) {
    if (c.cardType === 'HERO' || c[costField] == null) continue
    const cost = Number(c[costField])
    if (isNaN(cost)) continue
    counts[cost] = (counts[cost] ?? 0) + 1
    if (cost > max) max = cost
  }
  return { counts, max }
}

function CostCurve({ title, counts, maxCost, color }) {
  const [hovered, setHovered] = useState(null)
  const { tc } = useLang()
  if (!Object.keys(counts).length) return null
  const maxCount = Math.max(...Object.values(counts), 1)

  return (
    <div>
      <p className="text-xs text-faint mb-1">{title}</p>
      <div className="flex items-end gap-1 h-14 relative">
        {Array.from({ length: maxCost + 1 }, (_, i) => i).map(cost => {
          const count = counts[cost] ?? 0
          const height = count ? Math.max(6, Math.round((count / maxCount) * 48)) : 3
          const isHov = hovered === cost
          return (
            <div key={cost} className="flex flex-col items-center gap-0.5 flex-1 relative"
              onMouseEnter={() => setHovered(cost)}
              onMouseLeave={() => setHovered(null)}
            >
              {isHov && count > 0 && (
                <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-surface3 text-ink text-xs rounded px-1 py-0.5 whitespace-nowrap z-10">
                  {tc('draftStats.cardCount', count)}
                </div>
              )}
              <div
                className="w-full rounded-t transition-all duration-200"
                style={{ height: `${height}px`, backgroundColor: count ? color : '#1f2937', opacity: isHov ? 1 : 0.85 }}
              />
              <span className="text-xs text-faint">{cost}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function DraftStats({ pickedRefs, cardMap }) {
  const { t } = useLang()
  const cards = pickedRefs.map(r => cardMap[r]).filter(Boolean)
  const total = cards.length

  // Faction breakdown
  const factionCounts = {}
  for (const c of cards) {
    if (c.cardType === 'HERO') continue
    factionCounts[c.faction] = (factionCounts[c.faction] ?? 0) + 1
  }

  // Card type breakdown
  const typeCounts = {}
  for (const c of cards) {
    const group = TYPE_GROUPS[c.cardType]?.label ?? c.cardType
    typeCounts[group] = (typeCounts[group] ?? 0) + 1
  }

  // Set breakdown — merged by abbreviation (CORE+COREKS → BTG)
  const setCounts = {}
  for (const c of cards) {
    const raw = setCodeFromRef(c.reference)
    const abbrev = SET_ABBREV[raw] ?? raw
    if (abbrev) setCounts[abbrev] = (setCounts[abbrev] ?? 0) + 1
  }

  // Rarity breakdown (exclude heroes)
  const rarityCounts = { C: 0, R1: 0, R2: 0, EX: 0, U: 0 }
  for (const c of cards) {
    if (c.cardType === 'HERO') continue
    if (c.rarity in rarityCounts) rarityCounts[c.rarity]++
  }
  const rarityTotal = Object.values(rarityCounts).reduce((a, b) => a + b, 0)

  // Cost curves — hand & recall share one x-axis (0…max of both) so the two are
  // directly comparable instead of each scaling to its own max.
  const { counts: handCounts, max: handMax } = buildCostCounts(cards, 'mainCost')
  const { counts: recallCounts, max: recallMax } = buildCostCounts(cards, 'recallCost')
  const costMax = Math.max(handMax, recallMax)

  // Biome totals (sum of power values across all non-hero cards)
  let forestTotal = 0, mountainTotal = 0, oceanTotal = 0
  for (const c of cards) {
    if (c.cardType === 'HERO') continue
    if (c.forestPower != null)   forestTotal   += Number(c.forestPower)   || 0
    if (c.mountainPower != null) mountainTotal += Number(c.mountainPower) || 0
    if (c.oceanPower != null)    oceanTotal    += Number(c.oceanPower)    || 0
  }
  const hasBiomes = forestTotal + mountainTotal + oceanTotal > 0

  return (
    <div className="px-4 py-3 space-y-5 overflow-y-auto">

      {/* Faction split */}
      <section>
        <h4 className="text-xs uppercase tracking-widest text-faint mb-2">{t('draftStats.factionSplit')}</h4>
        <div className="space-y-1.5">
          {FACTIONS.map(f => {
            const count = factionCounts[f] ?? 0
            const nonHeroTotal = total - (typeCounts['Hero'] ?? 0)
            const pct = nonHeroTotal > 0 ? Math.round((count / nonHeroTotal) * 100) : 0
            return (
              <div key={f} className="flex items-center gap-2">
                <span className={`text-xs w-20 shrink-0 px-1.5 py-0.5 rounded border inline-flex items-center gap-1 ${FACTION_COLORS[f]}`}>
                  {FACTION_ICONS[f] && <img src={FACTION_ICONS[f]} alt="" className="w-3 h-3 object-contain shrink-0" />}
                  {FACTION_NAMES[f]}
                </span>
                <div className="flex-1 h-2 bg-surface2 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: FACTION_BAR_COLORS[f] ?? '#6b7280' }} />
                </div>
                <span className="text-xs text-muted w-6 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Set breakdown */}
      {Object.keys(setCounts).length > 1 && (
        <section>
          <h4 className="text-xs uppercase tracking-widest text-faint mb-2">{t('draftStats.sets')}</h4>
          <div className="space-y-1.5">
            {SET_ORDER.filter(s => setCounts[s]).map(s => {
              const count = setCounts[s]
              const iconCode = SET_ABBREV_ICON_CODE[s]
              const icon = iconCode ? SET_ICONS[iconCode] : null
              const pct = total > 0 ? Math.round((count / total) * 100) : 0
              return (
                <div key={s} className="flex items-center gap-2">
                  <div className="w-5 h-5 shrink-0 flex items-center justify-center" title={s}>
                    {icon
                      ? <img src={icon} alt={s} className="w-5 h-5 object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />
                      : <span className="text-xs text-faint">{s}</span>}
                  </div>
                  <div className="flex-1 h-2 bg-surface2 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-surface3 transition-all duration-300" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-muted w-6 text-right">{count}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Card type breakdown */}
      <section>
        <h4 className="text-xs uppercase tracking-widest text-faint mb-2">{t('draftStats.cardTypes')}</h4>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(typeCounts).map(([type, count]) => {
            const group = Object.values(TYPE_GROUPS).find(g => g.label === type)
            return (
              <div key={type} className="bg-surface2 rounded-lg px-3 py-2 flex items-center justify-between">
                <span className={`text-xs font-medium ${group?.color ?? 'text-muted'}`}>{t(TYPE_LABEL_KEY[type] ?? type)}</span>
                <span className="text-sm font-bold text-ink">{count}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Rarity breakdown */}
      {rarityTotal > 0 && (
        <section>
          <h4 className="text-xs uppercase tracking-widest text-faint mb-2">{t('draftStats.rarity')}</h4>
          <div className="flex gap-2">
            {[
              { key: 'C',  label: t('draftStats.rarityCommon'),  gem: RARITY_GEMS.C },
              { key: 'R1', label: t('draftStats.rarityRare'),    gem: RARITY_GEMS.R1 },
              { key: 'EX', label: t('draftStats.rarityExalted'), gem: RARITY_GEMS.EX },
              { key: 'U',  label: t('draftStats.rarityUnique'),  gem: RARITY_GEMS.U },
            ].map(({ key, label, gem }) => {
              const count = key === 'R1' ? rarityCounts.R1 + rarityCounts.R2 : rarityCounts[key]
              if (!count) return null
              return (
                <div key={key} className="flex-1 bg-surface2 rounded-lg px-2 py-2 flex flex-col items-center gap-1">
                  <img src={gem} alt={label} className="w-6 h-6 object-contain" />
                  <span className="text-sm font-bold text-ink">{count}</span>
                  <span className="text-xs text-faint">{label}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Cost curves */}
      <section>
        <h4 className="text-xs uppercase tracking-widest text-faint mb-3">{t('draftStats.costCurves')}</h4>
        <div className="space-y-4">
          <CostCurve title={t('draftStats.handCost')} counts={handCounts} maxCost={costMax} color="#f59e0b" />
          <CostCurve title={t('draftStats.recallCost')} counts={recallCounts} maxCost={costMax} color="#60a5fa" />
        </div>
      </section>

      {/* Biome totals */}
      {hasBiomes && (
        <section>
          <h4 className="text-xs uppercase tracking-widest text-faint mb-2">{t('draftStats.biomePower')}</h4>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t('draftStats.forest'),   emoji: '🌲', value: forestTotal,   color: 'text-green-400' },
              { label: t('draftStats.mountain'), emoji: '⛰️',  value: mountainTotal, color: 'text-orange-400' },
              { label: t('draftStats.ocean'),    emoji: '🌊', value: oceanTotal,    color: 'text-blue-400' },
            ].map(({ label, emoji, value, color }) => (
              <div key={label} className="bg-surface2 rounded-lg px-2 py-2 flex flex-col items-center gap-1">
                <span className="text-lg leading-none">{emoji}</span>
                <span className={`text-sm font-bold ${color}`}>{value}</span>
                <span className="text-xs text-faint">{label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

    </div>
  )
}
