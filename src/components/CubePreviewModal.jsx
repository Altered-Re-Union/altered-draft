import { useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { FACTIONS, FACTION_NAMES, FACTION_COLORS, SET_ABBREV, SET_FULL_NAMES, SET_ABBREV_ICON_CODE, fetchSet, apiSetCode, fetchUniques, isUniqueRef, needsCardApi } from '../lib/cardData.js'
import { FACTION_ICONS, RARITY_GEMS, SET_ICONS } from '../lib/assets.js'
import { setsForCube } from '../lib/cubes.js'
import { useLang } from '../lib/i18n/i18n.jsx'

// Parse info from reference without any API fetch
function parseRef(ref) {
  const parts = ref.split('_')
  const knownFactions = new Set(['AX', 'BR', 'LY', 'MU', 'OR', 'YZ'])
  const rawSet = parts[1] === 'CORE' && parts[2] === 'KS' ? 'COREKS' : parts[1]
  const abbrev = SET_ABBREV[rawSet] ?? rawSet  // CORE/COREKS → BTG etc.
  const uniq = isUniqueRef(ref)  // ALT_..._U_<serial>
  let faction = '??', rarity = 'C'
  for (let i = 2; i < parts.length; i++) {
    if (knownFactions.has(parts[i])) {
      faction = parts[i]
      rarity = parts[parts.length - 1]
      break
    }
  }
  if (uniq) rarity = 'U'
  else if (rarity === 'E') rarity = 'EX'
  return { set: rawSet, abbrev, faction, rarity, ref }
}

const RARITY_ORDER = { C: 0, R1: 1, R2: 2, EX: 3, U: 4 }
// Dict keys, not display text — the actual label comes from t() at render time so it
// stays in sync with the current UI language (see RotisserieGrid/DraftStats for the
// same "stable internal key, translated label" split).
const RARITY_LABEL_KEY = { C: 'cubePreview.common', R1: 'cubePreview.rare', R2: 'cubePreview.rare', EX: 'cubePreview.exalted', U: 'cubePreview.unique' }

export default function CubePreviewModal({ cube, onClose }) {
  const { t, tc } = useLang()
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState('faction')
  const [viewMode, setViewMode] = useState('list') // 'list' | 'grid'
  const [cardMap, setCardMap] = useState({})
  const [loadingCards, setLoadingCards] = useState(true)
  const [hoverCard, setHoverCard] = useState(null)

  // Fetch all card data for this cube on mount
  useEffect(() => {
    const setCodes = [...new Set(setsForCube(cube.refs).map(apiSetCode))]
    Promise.all(setCodes.map(s => fetchSet(s, 'EN').catch(() => [])))
      .then(async results => {
        const map = {}
        for (const cards of results) {
          for (const c of cards) map[c.reference] = c
        }
        const uCards = await fetchUniques(cube.refs.filter(needsCardApi), 'EN')
        for (const c of uCards) map[c.reference] = c
        setCardMap(map)
        setLoadingCards(false)
      })
  }, [cube])

  // Offline parse (faction from the ref string) — refined to the real mainFaction in
  // `enriched` once card data loads, which matters for out-of-faction R2 prints.
  // Recipe cubes count Exalted as a rare (it fills a rare slot in the booster).
  const exAsRare = !!cube.booster
  const parsedCards = useMemo(() => cube.refs.map(ref => {
    const p = parseRef(ref)
    return exAsRare && p.rarity === 'EX' ? { ...p, rarity: 'R1' } : p
  }), [cube, exAsRare])

  // Prefer the real card's faction over the ref-string parse: an out-of-faction (R2)
  // print keeps its home-faction letters in the ref but is natively the other faction
  // (e.g. ALT_ALIZE_B_YZ_45_R2 reads "YZ" but is an Axiom card).
  const enriched = useMemo(() =>
    parsedCards.map(p => {
      const card = cardMap[p.ref] ?? null
      return { ...p, card, faction: card?.faction ?? p.faction }
    }),
  [parsedCards, cardMap])

  const filtered = useMemo(() => {
    if (!search.trim()) return enriched
    const q = search.toLowerCase()
    return enriched.filter(c =>
      c.ref.toLowerCase().includes(q) ||
      (c.card?.name ?? '').toLowerCase().includes(q) ||
      c.faction.toLowerCase().includes(q) ||
      (FACTION_NAMES[c.faction] ?? '').toLowerCase().includes(q) ||
      c.set.toLowerCase().includes(q)
    )
  }, [enriched, search])

  // Stats — sets merged by abbreviation (CORE+COREKS → BTG)
  const factionCounts = {}, rarityCounts = { C: 0, R1: 0, R2: 0, EX: 0, U: 0 }, setCounts = {}
  for (const c of enriched) {
    factionCounts[c.faction] = (factionCounts[c.faction] ?? 0) + 1
    if (c.rarity in rarityCounts) rarityCounts[c.rarity]++
    setCounts[c.abbrev] = (setCounts[c.abbrev] ?? 0) + 1
  }

  function groupCards() {
    const sortedByRarity = (arr) => [...arr].sort((a, b) => (RARITY_ORDER[a.rarity] ?? 0) - (RARITY_ORDER[b.rarity] ?? 0))
    if (groupBy === 'faction') {
      const groups = {}
      for (const f of [...FACTIONS, '??']) groups[f] = []
      for (const c of filtered) (groups[c.faction] ?? groups['??']).push(c)
      return Object.entries(groups).filter(([, v]) => v.length).map(([key, cards]) => ({
        key, label: FACTION_NAMES[key] ?? key,
        icon: FACTION_ICONS[key] ?? null,
        colorCls: FACTION_COLORS[key] ?? 'text-muted bg-surface2 border-line',
        cards: sortedByRarity(cards),
      }))
    }
    if (groupBy === 'set') {
      const groups = {}
      // Group by abbreviation so CORE+COREKS merge under BTG
      for (const c of filtered) { if (!groups[c.abbrev]) groups[c.abbrev] = []; groups[c.abbrev].push(c) }
      const abbrevOrder = ['BTG','TBF','WTM','SKY','SDU','ROC','NEJ']
      return Object.entries(groups)
        .sort((a, b) => (abbrevOrder.indexOf(a[0]) + 1 || 99) - (abbrevOrder.indexOf(b[0]) + 1 || 99))
        .map(([key, cards]) => {
          const iconCode = SET_ABBREV_ICON_CODE[key]
          return {
            key, label: `${key} · ${SET_FULL_NAMES[key] ?? key}`,
            icon: iconCode ? SET_ICONS[iconCode] : null,
            colorCls: 'text-ink2 bg-surface2 border-line',
            cards: sortedByRarity(cards),
          }
        })
    }
    if (groupBy === 'rarity') {
      const order = ['C', 'R1', 'R2', 'EX', 'U']
      const groups = {}
      for (const c of filtered) { if (!groups[c.rarity]) groups[c.rarity] = []; groups[c.rarity].push(c) }
      return order.filter(r => groups[r]?.length).map(key => ({
        key, label: t(RARITY_LABEL_KEY[key]) ?? key, icon: RARITY_GEMS[key] ?? null,
        colorCls: 'text-ink2 bg-surface2 border-line',
        cards: [...(groups[key] ?? [])].sort((a, b) => a.faction.localeCompare(b.faction)),
      }))
    }
    return []
  }

  const groups = groupCards()
  const groupByLabels = { faction: t('cubePreview.groupFaction'), set: t('cubePreview.groupSet'), rarity: t('cubePreview.groupRarity') }

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

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar stats */}
          <div className="w-40 border-r border-line p-4 space-y-4 shrink-0 overflow-y-auto">
            <div>
              <p className="text-xs uppercase tracking-widest text-faint mb-2">{t('cubePreview.factions')}</p>
              <div className="space-y-1.5">
                {FACTIONS.filter(f => factionCounts[f]).map(f => (
                  <div key={f} className="flex items-center gap-1.5">
                    {FACTION_ICONS[f] && <img src={FACTION_ICONS[f]} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />}
                    <span className="text-xs text-ink2 flex-1">{FACTION_NAMES[f]}</span>
                    <span className="text-xs text-faint">{factionCounts[f]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-faint mb-2">{t('cubePreview.rarity')}</p>
              <div className="space-y-1.5">
                {[{ key: 'C', label: t('cubePreview.common') }, { key: 'R1', label: t('cubePreview.rare'), merge: 'R2' }, { key: 'EX', label: t('cubePreview.exalted') }, { key: 'U', label: t('cubePreview.unique') }]
                  .map(({ key, label, merge }) => {
                    const count = rarityCounts[key] + (merge ? (rarityCounts[merge] ?? 0) : 0)
                    if (!count) return null
                    return (
                      <div key={key} className="flex items-center gap-1.5">
                        {RARITY_GEMS[key] && <img src={RARITY_GEMS[key]} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />}
                        <span className="text-xs text-ink2 flex-1">{label}</span>
                        <span className="text-xs text-faint">{count}</span>
                      </div>
                    )
                  })}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-faint mb-2">{t('cubePreview.sets')}</p>
              <div className="space-y-1.5">
                {Object.entries(setCounts).sort((a, b) => b[1] - a[1]).map(([abbrev, count]) => {
                  const iconCode = SET_ABBREV_ICON_CODE[abbrev]
                  return (
                    <div key={abbrev} className="flex items-center gap-1.5" title={SET_FULL_NAMES[abbrev] ?? abbrev}>
                      {iconCode && SET_ICONS[iconCode]
                        ? <img src={SET_ICONS[iconCode]} alt={abbrev} className="w-3.5 h-3.5 object-contain shrink-0" onError={e => { e.currentTarget.style.display = 'none' }} />
                        : <span className="w-3.5 shrink-0" />}
                      <span className="text-xs text-ink2 flex-1 truncate">{abbrev}</span>
                      <span className="text-xs text-faint">{count}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Main area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Controls */}
            <div className="flex items-center gap-2 p-3 border-b border-line shrink-0">
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t('cubePreview.searchPlaceholder')}
                className="flex-1 bg-surface2 border border-line rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
              <div className="flex gap-1">
                {['faction', 'set', 'rarity'].map(g => (
                  <button key={g} onClick={() => setGroupBy(g)}
                    className={`px-2 py-1.5 rounded text-xs transition-colors ${groupBy === g ? 'bg-accent text-on-accent font-bold' : 'bg-surface2 text-muted hover:text-ink'}`}>
                    {groupByLabels[g]}
                  </button>
                ))}
              </div>
              <div className="flex gap-1 border-l border-line pl-2">
                <button onClick={() => setViewMode('list')}
                  className={`px-2 py-1.5 rounded text-xs transition-colors ${viewMode === 'list' ? 'bg-surface3 text-ink' : 'text-faint hover:text-ink2'}`}
                  title={t('cubePreview.listView')}>☰</button>
                <button onClick={() => setViewMode('grid')}
                  className={`px-2 py-1.5 rounded text-xs transition-colors ${viewMode === 'grid' ? 'bg-surface3 text-ink' : 'text-faint hover:text-ink2'}`}
                  title={t('cubePreview.gridView')}>⊞</button>
              </div>
              <span className="text-xs text-faint shrink-0">{filtered.length}</span>
            </div>

            {/* Loading bar */}
            {loadingCards && (
              <div className="h-0.5 bg-surface2 shrink-0">
                <div className="h-full bg-accent animate-pulse w-1/2" />
              </div>
            )}

            {/* Card list / grid */}
            <div className="overflow-y-auto flex-1 p-3 space-y-5">
              {groups.map(group => (
                <div key={group.key}>
                  <div className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded border mb-2 ${group.colorCls}`}>
                    {group.icon && typeof group.icon === 'string' && group.icon.startsWith('http') && (
                      <img src={group.icon} alt="" className="w-3.5 h-3.5 object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />
                    )}
                    {group.label} <span className="opacity-60">({group.cards.length})</span>
                  </div>

                  {viewMode === 'grid' ? (
                    <div className="grid grid-cols-6 gap-2">
                      {group.cards.map((c, i) => (
                        <div key={`${c.ref}-${i}`}
                          className="relative rounded-lg overflow-hidden border border-line bg-surface2 cursor-default"
                          onMouseEnter={() => setHoverCard(c)}
                          onMouseLeave={() => setHoverCard(null)}>
                          <div className="aspect-[2/3] bg-surface3 overflow-hidden">
                            {c.card?.imagePath ? (
                              <img src={c.card.imagePath} alt={c.card.name}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                onError={e => { e.currentTarget.style.display = 'none' }} />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center p-1">
                                <span className="text-xs text-faint text-center leading-tight">
                                  {loadingCards ? '…' : c.ref.split('_').slice(-2).join('_')}
                                </span>
                              </div>
                            )}
                          </div>
                          {c.rarity !== 'C' && RARITY_GEMS[c.rarity] && (
                            <img src={RARITY_GEMS[c.rarity]} alt={c.rarity}
                              className="absolute bottom-1 right-1 w-3.5 h-3.5 object-contain" />
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {group.cards.map((c, i) => (
                        <div key={`${c.ref}-${i}`} className="flex items-center gap-1.5 py-0.5 text-xs group">
                          {FACTION_ICONS[c.faction] && (
                            <img src={FACTION_ICONS[c.faction]} alt={c.faction} className="w-3 h-3 object-contain shrink-0" />
                          )}
                          <span className="text-ink2 truncate flex-1">
                            {c.card?.name ?? (loadingCards ? <span className="text-faint">…</span> : c.ref)}
                          </span>
                          {RARITY_GEMS[c.rarity] && c.rarity !== 'C' && (
                            <img src={RARITY_GEMS[c.rarity]} alt={c.rarity} className="w-3 h-3 object-contain shrink-0" />
                          )}
                          {SET_ABBREV_ICON_CODE[c.abbrev] && SET_ICONS[SET_ABBREV_ICON_CODE[c.abbrev]] && (
                            <img src={SET_ICONS[SET_ABBREV_ICON_CODE[c.abbrev]]} alt={c.abbrev}
                              className="w-3 h-3 object-contain shrink-0 opacity-40"
                              title={SET_FULL_NAMES[c.abbrev]}
                              onError={e => { e.currentTarget.style.display = 'none' }} />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Hover card image tooltip (grid mode) */}
      {hoverCard?.card?.imagePath && viewMode === 'grid' && (
        <div className="fixed bottom-6 right-6 z-[60] w-48 rounded-xl overflow-hidden shadow-2xl border border-line pointer-events-none">
          <img src={hoverCard.card.imagePath} alt={hoverCard.card.name} className="w-full" />
          <div className="bg-surface px-2 py-1.5">
            <p className="text-xs font-medium text-ink">{hoverCard.card.name}</p>
            <p className="text-xs text-faint">{FACTION_NAMES[hoverCard.faction]} · {t(RARITY_LABEL_KEY[hoverCard.rarity]) ?? hoverCard.rarity}</p>
          </div>
        </div>
      )}
    </div>,
    document.body
  )
}