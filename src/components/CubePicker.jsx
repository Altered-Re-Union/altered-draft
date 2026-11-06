import { useState } from 'react'
import { COMMUNITY_CUBES } from '../lib/cubes.js'
import { parseDecklist } from '../lib/cubeParser.js'
import { listDecks, getDeck, deckCardsToRefs } from '../lib/decks.js'
import { resolveCubeCards } from '../lib/cubeResolve.js'
import { CUBE_LIMITS } from '../lib/cubeSealed.js'
import { FACTIONS } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'
import CubePreviewModal from './CubePreviewModal.jsx'

const deckKey = d => d.id ?? d.uuid ?? d.name
const btn = 'px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors'
const btnSecondary = `${btn} bg-surface3 hover:bg-line text-ink`
const btnPrimary = `${btn} bg-accent hover:bg-accent2 text-on-accent`
const input = 'w-full bg-surface2 border border-line rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent disabled:opacity-40'

const totalOf = cards => cards.reduce((n, c) => n + c.qty, 0)
const expand = cards => cards.flatMap(c => Array(c.qty).fill(c.ref))

// Chooses the cube of a tournament: a community cube, the user's Re:Union decks, or a pasted list.
// `value` = null | { name, origin, cubeId, cards, heroesFound, unresolved, resolved: true }.
// The card data is always resolved in EN (the preview and the pool page do the same).
export default function CubePicker({ value, onChange, disabled = false }) {
  const { user, login } = useAuth()
  const { t, tc } = useLang()
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [decks, setDecks] = useState(null)
  const [deckSearch, setDeckSearch] = useState('')
  const [deckFormat, setDeckFormat] = useState('all')
  const [selectedDeckIds, setSelectedDeckIds] = useState([])
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')

  async function choose(rawRefs, { name, origin, cubeId = null, empty }) {
    setMsg(''); setBusy(true)
    try {
      const { cards, heroes, unresolved } = await resolveCubeCards(rawRefs, 'EN')
      if (!cards.length) { setMsg(empty); return }
      if (totalOf(cards) > CUBE_LIMITS.maxCards) { setMsg(t('tournaments.cubeTooLarge', { n: CUBE_LIMITS.maxCards })); return }
      onChange({ name, origin, cubeId, cards, heroesFound: heroes, unresolved, resolved: true })
    } catch (e) {
      setMsg(t('tournaments.cubeLoadFailed', { msg: e.message }))
    } finally { setBusy(false) }
  }

  async function loadDecks() {
    setMsg(''); setBusy(true)
    try {
      const list = await listDecks()
      setDecks(list)
      if (!list.length) setMsg(t('tournaments.cubeReunionNone'))
    } catch (e) { setMsg(e.message) } finally { setBusy(false) }
  }

  async function importDecks() {
    const chosen = (decks ?? []).filter(d => selectedDeckIds.includes(deckKey(d)))
    if (!chosen.length) return
    setMsg(''); setBusy(true)
    try {
      const lists = await Promise.all(chosen.map(d => getDeck(d.id ?? d.uuid).then(deckCardsToRefs)))
      const refs = lists.flat()
      if (!refs.length) { setMsg(t('tournaments.cubeReunionNoCards')); setBusy(false); return }
      setBusy(false)
      await choose(refs, {
        name: chosen.length === 1 ? chosen[0].name || t('lobby.untitledDeck') : t('tournaments.cubeDecksName', { n: chosen.length }),
        origin: 'reunion', empty: t('tournaments.cubeReunionNoCards'),
      })
    } catch (e) { setMsg(e.message); setBusy(false) }
  }

  function parsePaste() {
    const { refs } = parseDecklist(pasteText)
    if (!refs.length) { setMsg(t('tournaments.cubePasteNoRefs')); return }
    return choose(refs, { name: pasteName.trim() || t('tournaments.cubePastedName'), origin: 'paste', empty: t('tournaments.cubePasteNoCards') })
  }

  if (value) {
    const total = totalOf(value.cards)
    const byFaction = Object.fromEntries(FACTIONS.map(f => [f, 0]))
    for (const c of value.cards) if (c.faction in byFaction) byFaction[c.faction] += c.qty
    const origin = { community: 'cubeOriginCommunity', reunion: 'cubeOriginReunion', paste: 'cubeOriginPaste' }[value.origin]
    const originLabel = origin ? t(`tournaments.${origin}`) : ''
    const unresolved = value.unresolved ?? []
    return (
      <div data-testid="cube-chosen" className="rounded-xl border-2 border-accent bg-accent/5 p-4 space-y-3">
        <p className="text-xs uppercase tracking-widest text-accent-ink font-semibold">{t('tournaments.cubeChosenTitle')}</p>
        <label className="block space-y-1">
          <span className="text-xs text-muted">{t('tournaments.cubeNameLabel')}</span>
          <input data-testid="cube-name" value={value.name} maxLength={80} disabled={disabled}
            onChange={e => onChange({ ...value, name: e.target.value })} className={input} />
        </label>
        <p className="text-xs text-faint">{originLabel}</p>
        <p data-testid="cube-count" className="text-sm text-ink">{tc('tournaments.cubeCount', total, { distinct: value.cards.length })}</p>
        <div className="flex flex-wrap gap-3">
          {FACTIONS.map(f => (
            <span key={f} data-testid={`cube-faction-${f}`} className="flex items-center gap-1 text-xs text-ink2 tabular-nums">
              <img src={FACTION_ICONS[f]} alt={f} className="w-4 h-4" />{byFaction[f]}
            </span>
          ))}
        </div>
        <p className="text-xs text-muted">
          {value.heroesFound.length === 0 ? t('tournaments.cubeHeroesFoundZero') : tc('tournaments.cubeHeroesFound', value.heroesFound.length)}
        </p>
        {unresolved.length > 0 && (
          <p data-testid="cube-unresolved" className="text-xs text-accent-ink">
            {tc('tournaments.cubeUnresolved', unresolved.length)}{' '}
            <span className="font-mono break-all">
              {unresolved.slice(0, 8).join(', ')}{unresolved.length > 8 ? ` … (+${unresolved.length - 8})` : ''}
            </span>
          </p>
        )}
        <div className="flex items-center gap-3">
          <button type="button" data-testid="cube-preview" onClick={() => setPreview({
            name: value.name, author: originLabel, cardCount: total + value.heroesFound.length,
            refs: [...expand(value.cards), ...value.heroesFound.map(h => h.ref)],
          })} className="text-xs text-accent-ink hover:text-accent transition-colors">{t('tournaments.cubePreview')}</button>
          <button type="button" data-testid="cube-change" disabled={disabled} onClick={() => { setMsg(''); onChange(null) }}
            className="text-xs text-faint hover:text-ink2 disabled:opacity-40 transition-colors ml-auto">{t('tournaments.cubeChange')}</button>
        </div>
        {preview && <CubePreviewModal cube={preview} onClose={() => setPreview(null)} />}
      </div>
    )
  }

  const off = disabled || busy
  const formats = [...new Set((decks ?? []).map(d => d.format).filter(Boolean))]
  const q = deckSearch.trim().toLowerCase()
  const shown = (decks ?? []).filter(d =>
    (deckFormat === 'all' || d.format === deckFormat) && (!q || (d.name ?? '').toLowerCase().includes(q)))

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <p className="font-semibold text-sm text-ink">{t('tournaments.cubeCommunityTitle')}</p>
        <p className="text-xs text-faint">{t('tournaments.cubeCommunityHint')}</p>
        {COMMUNITY_CUBES.map(cube => (
          <div key={cube.id} className="rounded-xl border-2 border-line bg-surface2 p-4 space-y-1.5">
            <p className="font-semibold text-sm text-ink">{cube.name}</p>
            <p className="text-xs text-faint">{cube.author} · {cube.cardCount}</p>
            <p className="text-xs text-muted leading-relaxed">{cube.description}</p>
            <div className="flex items-center gap-3 pt-1">
              <button type="button" data-testid={`cube-community-${cube.id}`} disabled={off}
                onClick={() => choose([...cube.refs, ...(cube.heroes ?? [])], { name: cube.name, origin: 'community', cubeId: cube.id, empty: t('tournaments.cubeLoadFailed', { msg: cube.name }) })}
                className={btnPrimary}>{t('tournaments.cubeUse')}</button>
              <button type="button" data-testid={`cube-preview-${cube.id}`} disabled={disabled}
                onClick={() => setPreview({ ...cube, refs: [...cube.refs, ...(cube.heroes ?? [])] })}
                className="text-xs text-accent-ink hover:text-accent disabled:opacity-40 transition-colors">{t('tournaments.cubePreview')}</button>
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-xl border-2 border-dashed border-line bg-surface2/40 p-4 space-y-2">
        <p className="font-semibold text-sm text-ink">{t('tournaments.cubeReunionTitle')}</p>
        <p className="text-xs text-faint">{t('tournaments.cubeReunionHint')}</p>
        {!user ? (
          <div className="space-y-2">
            <p className="text-xs text-faint leading-relaxed">{t('lobby.connectReunionHint')}</p>
            <button type="button" disabled={disabled} onClick={() => login()} className={btnSecondary}>{t('reunion.connect')}</button>
          </div>
        ) : (
          <div className="space-y-2">
            <button type="button" data-testid="cube-reunion-load" disabled={off} onClick={loadDecks} className={btnSecondary}>
              {decks ? t('tournaments.cubeReunionRefresh') : t('tournaments.cubeReunionLoad')}
            </button>
            {decks && decks.length > 0 && (
              <div className="space-y-2">
                <input data-testid="cube-reunion-search" value={deckSearch} disabled={disabled} onChange={e => setDeckSearch(e.target.value)}
                  placeholder={t('tournaments.cubeReunionSearch')} aria-label={t('tournaments.cubeReunionSearch')} className={input} />
                {formats.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {['all', ...formats].map(f => (
                      <button key={f} type="button" aria-pressed={deckFormat === f} disabled={disabled} onClick={() => setDeckFormat(f)}
                        className={`px-2 py-0.5 rounded text-xs capitalize transition-colors disabled:opacity-40 ${
                          deckFormat === f ? 'bg-accent text-on-accent font-bold' : 'bg-surface2 text-muted hover:text-ink'}`}>
                        {f === 'all' ? t('lobby.filterAll') : f.replace('_', ' ')}
                      </button>
                    ))}
                  </div>
                )}
                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                  {shown.map((d, i) => {
                    const key = deckKey(d)
                    const checked = selectedDeckIds.includes(key)
                    return (
                      <button key={key ?? i} type="button" role="checkbox" aria-checked={checked} data-testid={`cube-reunion-deck-${d.id ?? d.uuid ?? d.name}`}
                        disabled={disabled}
                        onClick={() => setSelectedDeckIds(ids => ids.includes(key) ? ids.filter(x => x !== key) : [...ids, key])}
                        className={`w-full flex items-center gap-2 text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                          checked ? 'bg-accent/20 text-accent-ink' : 'bg-surface2 hover:bg-surface3 text-ink'}`}>
                        <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center text-[10px] ${
                          checked ? 'bg-accent border-accent text-on-accent' : 'border-line'}`}>{checked ? '✓' : ''}</span>
                        <span className="truncate flex-1">{d.name || t('lobby.untitledDeck')}</span>
                        {d.format && <span className="text-[10px] uppercase tracking-wide text-faint shrink-0">{d.format.replace('_', ' ')}</span>}
                      </button>
                    )
                  })}
                  {!shown.length && <p className="text-xs text-faint px-1 py-2">{t('tournaments.cubeReunionNoMatch')}</p>}
                </div>
                <button type="button" data-testid="cube-reunion-import" disabled={off || !selectedDeckIds.length} onClick={importDecks} className={btnPrimary}>
                  {selectedDeckIds.length === 0 ? t('tournaments.cubeReunionImportZero') : tc('tournaments.cubeReunionImport', selectedDeckIds.length)}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border-2 border-dashed border-line bg-surface2/40 p-4 space-y-2">
        <p className="font-semibold text-sm text-ink">{t('tournaments.cubePasteTitle')}</p>
        <p className="text-xs text-faint leading-relaxed">{t('tournaments.cubePasteHint')}</p>
        <input data-testid="cube-paste-name" value={pasteName} disabled={disabled} onChange={e => setPasteName(e.target.value)}
          placeholder={t('tournaments.cubePasteName')} aria-label={t('tournaments.cubePasteName')} maxLength={80} className={input} />
        <textarea data-testid="cube-paste-text" value={pasteText} disabled={disabled} onChange={e => setPasteText(e.target.value)} rows={6}
          placeholder={'1 ALT_CORE_B_YZ_03_C\n3 ALT_CORE_B_MU_06_R2\n...'}
          className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-accent resize-none disabled:opacity-40" />
        <button type="button" data-testid="cube-paste-parse" disabled={off || !pasteText.trim()} onClick={parsePaste} className={btnSecondary}>
          {busy ? t('tournaments.cubePasteParsing') : t('tournaments.cubePasteParse')}
        </button>
      </section>

      {msg && <p role="alert" className="text-xs text-danger">{msg}</p>}
      {preview && <CubePreviewModal cube={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
