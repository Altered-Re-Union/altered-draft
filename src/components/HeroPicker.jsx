import { useEffect, useState } from 'react'
import { FACTIONS, SET_ABBREV } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'
import { loadAllHeroes } from '../lib/heroCatalog.js'
import { useLang } from '../lib/i18n/i18n.jsx'

// Hero pool of a cube tournament: a count + "Choose heroes" while closed, every hero of every set
// grouped by faction once open. `value` = selected refs, `preselected` = the heroes found in the cube.
export default function HeroPicker({ value, onChange, preselected = [], disabled = false, lang = 'EN' }) {
  const { t, tc } = useLang()
  const [open, setOpen] = useState(false)
  const [heroes, setHeroes] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open || heroes) return
    let alive = true
    loadAllHeroes(lang).then(h => { if (alive) setHeroes(h) }).catch(e => { if (alive) setError(t('tournaments.cubeLoadFailed', { msg: e.message })) })
    return () => { alive = false }
  }, [open, heroes, lang])

  const selected = new Set(value)
  const set = refs => onChange([...new Set(refs)].sort())
  const toggle = ref => set(selected.has(ref) ? value.filter(r => r !== ref) : [...value, ref])
  const q = search.trim().toLowerCase()

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <span data-testid="hero-pool-count" className="text-sm text-ink">{tc('tournaments.heroPoolCount', value.length)}</span>
        {!open && (
          <button type="button" data-testid="hero-pool-open" disabled={disabled} onClick={() => setOpen(true)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface3 hover:bg-surface3 disabled:opacity-40 text-ink transition-colors">
            {t('tournaments.heroPoolChoose')}
          </button>
        )}
      </div>
      {preselected.length > 0 && <p className="text-xs text-faint">{t('tournaments.heroPoolFromCube')}</p>}

      {open && (
        <div className="rounded-xl border border-line bg-surface2/40 p-3 space-y-3">
          <input data-testid="hero-pool-search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('tournaments.heroPoolSearch')} aria-label={t('tournaments.heroPoolSearch')}
            className="w-full bg-surface2 border border-line rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
          {error && <p className="text-xs text-danger">{error}</p>}
          {!heroes && !error && <p className="text-xs text-faint">{t('tournaments.heroPoolLoading')}</p>}
          {heroes && FACTIONS.map(f => {
            const all = heroes.filter(h => h.faction === f)
            if (!all.length) return null
            const shown = all.filter(h => !q || h.name.toLowerCase().includes(q))
            const refs = all.map(h => h.ref)
            const count = refs.filter(r => selected.has(r)).length
            return (
              <div key={f} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <img src={FACTION_ICONS[f]} alt={f} className="w-5 h-5" />
                  <span className="text-sm font-semibold text-ink">{f}</span>
                  <span className="text-xs text-faint tabular-nums">{count} / {all.length}</span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" data-testid={`hero-faction-all-${f}`} disabled={disabled}
                      onClick={() => set([...value, ...refs])}
                      className="text-xs text-accent-ink hover:text-accent disabled:opacity-40">{t('tournaments.heroPoolAll')}</button>
                    <button type="button" data-testid={`hero-faction-none-${f}`} disabled={disabled}
                      onClick={() => set(value.filter(r => !refs.includes(r)))}
                      className="text-xs text-muted hover:text-ink disabled:opacity-40">{t('tournaments.heroPoolNone')}</button>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {shown.map(h => (
                    <button key={h.ref} type="button" data-testid={`hero-chip-${h.ref}`} aria-pressed={selected.has(h.ref)}
                      disabled={disabled} onClick={() => toggle(h.ref)}
                      className={`px-2 py-1 rounded-lg text-xs transition-colors disabled:opacity-40 ${
                        selected.has(h.ref) ? 'bg-accent text-on-accent font-semibold' : 'bg-surface2 text-ink2 hover:bg-surface3'}`}>
                      {h.name} <span className="opacity-70">{SET_ABBREV[h.set] ?? h.set}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          <button type="button" data-testid="hero-pool-close" onClick={() => setOpen(false)}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent hover:bg-accent2 text-on-accent transition-colors">
            {t('tournaments.heroPoolClose')}
          </button>
        </div>
      )}
    </div>
  )
}
