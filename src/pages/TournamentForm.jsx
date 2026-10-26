import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'
import { parseBgaTournamentUrl } from '../lib/bgaUrl.js'
import { tournamentFormIssues } from '../lib/tournamentForm.js'
import { validateTournamentConfig } from '../lib/tournamentConfig.js'
import { hasFactionRanges } from '../lib/uniqueFactionRanges.js'
import { createTournament, updateTournament, getTournament, checkBgaTournament } from '../lib/tournamentApi.js'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'
import SetPresetGrid from '../components/SetPresetGrid.jsx'
import SettingsFields from '../components/SettingsFields.jsx'
import TournamentUniqueFields from '../components/TournamentUniqueFields.jsx'

// <input type="datetime-local"> speaks local wall-clock time without a zone; the API
// speaks ISO/UTC. Convert at the edges only.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
function defaultStart() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(20, 0, 0, 0)
  return toLocalInput(d.toISOString())
}

// Every problem is listed next to the submit button, which sits in a bar stuck to the bottom
// of the screen: the reason the button is disabled is always in view, whatever the scroll.
// Each listed problem jumps to its field. Inline messages appear once a field was touched.
const FIELD_DOM_ID = {
  name: 'tn-name', description: 'tn-desc', bgaUrl: 'tn-bga', startsAt: 'tn-start', endsAt: 'tn-end',
  setCode: 'tn-cards', uniques: 'tn-settings',
}
const FIELD_LABEL_KEY = {
  name: 'tournaments.nameLabel', description: 'tournaments.descriptionLabel', bgaUrl: 'tournaments.bgaUrlLabel',
  startsAt: 'tournaments.startsAtLabel', endsAt: 'tournaments.endsAtLabel', setCode: 'tournaments.sectionCards',
  uniques: 'tournaments.tournamentUniquesTitle',
}

function issueMessage({ field, code }, t) {
  switch (field) {
    case 'name': return t('tournaments.errName')
    case 'description': return t('tournaments.errDescription')
    case 'bgaUrl': return code === 'taken' ? t('tournaments.errBgaTaken') : code === 'mixed_formats' ? t('tournaments.errBgaMixed') : t('tournaments.errBgaUrl')
    case 'startsAt': return code === 'must_be_before_end' ? t('tournaments.errStartsAtBeforeEnd') : t('tournaments.errStartsAt')
    case 'endsAt': return t('tournaments.errEndsAt')
    case 'setCode': return t('tournaments.errSelectSet')
    case 'uniques':
      if (code === 'uniques.unsupportedSet') return t('tournaments.uniquesUnsupported')
      if (code === 'uniques.faction') return t('tournaments.errUniquesFaction')
      return t('tournaments.errGeneric', { msg: code })
    default: return t('tournaments.errGeneric', { msg: code })
  }
}

function focusField(field) {
  const el = document.getElementById(FIELD_DOM_ID[field])
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (typeof el.focus === 'function') el.focus({ preventScroll: true })
}

export default function TournamentForm() {
  const { id } = useParams() // present in edit mode
  const navigate = useNavigate()
  const { user, login, loading: authLoading } = useAuth()
  const { t, tc } = useLang()
  const isEdit = !!id

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [bgaUrl, setBgaUrl] = useState('')
  const [startsAt, setStartsAt] = useState(defaultStart)
  const [endsAt, setEndsAt] = useState('')
  const [setCode, setSetCode] = useState(null)
  const [heroes, setHeroes] = useState('packs')
  const [uniques, setUniques] = useState({ inBoosters: 1, guaranteed: 1, evenFactions: false, faction: null })
  const [excludeBanlist, setExcludeBanlist] = useState(false)

  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState('') // non-field failure of the last submit
  const [sessionExpired, setSessionExpired] = useState(false)
  const [touched, setTouched] = useState(() => new Set())
  const [takenBgaIds, setTakenBgaIds] = useState(() => new Map()) // BGA id -> live tournament id
  const [legacyByBgaId, setLegacyByBgaId] = useState(() => new Map()) // BGA id -> { pools, mixed, config }

  const touch = field => setTouched(prev => (prev.has(field) ? prev : new Set(prev).add(field)))
  // Wraps a setter: any edit clears the last server error and marks the field touched.
  const edit = (field, setter) => value => { setter(value); setServerError(''); touch(field) }
  // Crossed dates are reported under the date field changed last (see tournamentFormIssues).
  const [lastDateEdited, setLastDateEdited] = useState(null)

  // A session that expired while the form was being filled: the reconnect goes through
  // Keycloak (full page load), so what was typed is parked in sessionStorage and put back
  // when the form comes back (create mode: on mount; edit mode: over the server values).
  const draftKey = `tournament_form_draft:${id ?? 'new'}`
  const readDraft = () => {
    try {
      const raw = sessionStorage.getItem(draftKey)
      if (raw) sessionStorage.removeItem(draftKey)
      return raw ? JSON.parse(raw) : null
    } catch { return null }
  }
  const applyDraft = (d, { withConfig }) => {
    setName(d.name ?? ''); setDescription(d.description ?? ''); setStartsAt(d.startsAt ?? ''); setEndsAt(d.endsAt ?? '')
    if (withConfig) {
      setBgaUrl(d.bgaUrl ?? ''); if (d.setCode !== undefined) setSetCode(d.setCode)
      if (d.heroes) setHeroes(d.heroes); if (d.uniques) setUniques(d.uniques); setExcludeBanlist(!!d.excludeBanlist)
    }
  }
  function reconnect() {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ name, description, bgaUrl, startsAt, endsAt, setCode, heroes, uniques, excludeBanlist }))
    } catch { /* storage unavailable: the reconnect still works, the draft is lost */ }
    login(isEdit ? `/tournament/t/${id}/edit` : '/tournament/new')
  }
  useEffect(() => {
    if (isEdit) return
    const d = readDraft()
    if (d) applyDraft(d, { withConfig: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  // Edit mode: prefill from the tournament; only its organizer or a moderator may be here.
  // Logged out, wait: the page shows the Connect prompt instead (the viewer block, which
  // says who may edit, only comes with a bearer).
  useEffect(() => {
    if (!isEdit || authLoading || !user) return
    let cancelled = false
    let redirected = false
    getTournament(id)
      .then(tn => {
        if (cancelled) return
        if (tn.detachedAt || (!tn.viewer?.isOrganizer && !tn.viewer?.isModerator)) {
          redirected = true // stay on the loading screen: the form is never rendered for them
          navigate(`/tournament/t/${id}`, { replace: true })
          return
        }
        setName(tn.name); setDescription(tn.description); setBgaUrl(tn.bgaUrl)
        setStartsAt(toLocalInput(tn.startsAt)); setEndsAt(toLocalInput(tn.endsAt))
        setSetCode(tn.config.source.setCode); setHeroes(tn.config.heroes)
        setUniques(tn.config.uniques); setExcludeBanlist(!!tn.config.excludeBanlist)
        setLocked(!!tn.locked)
        const d = readDraft()
        if (d) applyDraft(d, { withConfig: !tn.locked })
      })
      .catch(e => { if (!cancelled) setLoadError(e.status === 404 ? t('tournaments.notFound') : t('tournaments.errGeneric', { msg: e.message })) })
      .finally(() => { if (!cancelled && !redirected) setLoading(false) })
    return () => { cancelled = true }
  }, [id, isEdit, navigate, t, user, authLoading])

  // Is the pasted link already declared, or already played with legacy pools (whose format
  // the tournament must then take)? One targeted lookup per BGA id, debounced while typing
  // (GET /api/tournaments?bgaId=). The server re-checks both on submit.
  const bgaParsedId = parseBgaTournamentUrl(bgaUrl)?.id ?? null
  useEffect(() => {
    if (!bgaParsedId || locked) return
    let cancelled = false
    const timer = setTimeout(() => {
      checkBgaTournament(bgaParsedId)
        .then(({ holder, legacy }) => {
          if (cancelled) return
          setTakenBgaIds(prev => {
            const next = new Map(prev)
            if (holder) next.set(bgaParsedId, holder.id)
            else next.delete(bgaParsedId)
            return next
          })
          setLegacyByBgaId(prev => {
            const next = new Map(prev)
            if (legacy) next.set(bgaParsedId, legacy)
            else next.delete(bgaParsedId)
            return next
          })
        })
        .catch(() => { /* the server check on submit covers it */ })
    }, 350)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [bgaParsedId, locked])

  // Players already have pools for this BGA tournament: its format is imposed (theirs).
  const legacy = !locked && bgaParsedId ? legacyByBgaId.get(bgaParsedId) ?? null : null
  const imposed = !!legacy && !legacy.mixed
  useEffect(() => {
    if (!imposed) return
    const c = legacy.config
    setSetCode(c.source.setCode); setHeroes(c.heroes); setUniques({ ...c.uniques, faction: c.uniques.faction ?? null }); setExcludeBanlist(!!c.excludeBanlist)
  }, [imposed, legacy])
  const mixedBgaIds = new Set([...legacyByBgaId].filter(([, l]) => l.mixed).map(([bgaId]) => bgaId))
  const configFrozen = locked || imposed

  const bgaParsed = useMemo(() => parseBgaTournamentUrl(bgaUrl), [bgaUrl])
  const uniqueSupport = !setCode || hasFactionRanges(setCode)
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }, [])

  const config = {
    v: 1, format: 'sealed',
    source: { type: 'set', setCode, boosters: 7 },
    heroes,
    uniques: uniqueSupport ? uniques : { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null },
    excludeBanlist,
  }
  const body = { name, description, bgaUrl, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt) }
  const issues = tournamentFormIssues({ body, config, isCreate: !isEdit, locked, takenBgaIds, ownId: id ?? null, mixedBgaIds, lastDateEdited })
  const fieldIssue = field => (touched.has(field) ? issues.find(i => i.field === field) : null)
  const blocked = issues.length > 0 || saving || loading || !!loadError

  function showFirstIssue() {
    setTouched(new Set(issues.map(i => i.field)))
    focusField(issues[0].field)
  }

  // Enter in a field: same as clicking the first listed problem. The submit button is disabled
  // while problems are listed, and a disabled default button blocks implicit submission, so
  // the form never sees that Enter; catch it here instead.
  function handleKeyDown(e) {
    const el = e.target
    if (e.key !== 'Enter' || !issues.length || el.tagName !== 'INPUT' || ['checkbox', 'radio'].includes(el.type)) return
    e.preventDefault()
    showFirstIssue()
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (issues.length) { showFirstIssue(); return }
    setServerError(''); setSessionExpired(false)
    setSaving(true)
    try {
      const cfg = validateTournamentConfig(config)
      if (isEdit) {
        const patch = { ...body }
        if (!locked) { patch.bgaUrl = body.bgaUrl; patch.config = cfg.config } else delete patch.bgaUrl
        await updateTournament(id, patch)
        navigate(`/tournament/t/${id}`)
      } else {
        const created = await createTournament({ ...body, config: cfg.config })
        navigate(`/tournament/t/${created.id}`)
      }
    } catch (err) {
      if (err.status === 409 && err.data?.error === 'bga_tournament_taken' && bgaParsed) {
        // Declared meanwhile: remember it so the live check shows it from now on.
        setTakenBgaIds(prev => new Map(prev).set(bgaParsed.id, 'taken'))
        touch('bgaUrl')
        focusField('bgaUrl')
      } else if (err.status === 409 && err.data?.error === 'bga_tournament_mixed_formats' && bgaParsed) {
        setLegacyByBgaId(prev => new Map(prev).set(bgaParsed.id, { pools: 0, mixed: true, config: null }))
        touch('bgaUrl')
        focusField('bgaUrl')
      } else if (err.status === 400 && err.data?.fields && Object.keys(err.data.fields).length) {
        const first = Object.keys(err.data.fields)[0]
        setServerError(issueMessage({ field: first, code: err.data.fields[first] }, t))
        focusField(first)
      } else if (err.status === 409 && err.data?.error === 'tournament_locked') setServerError(t('tournaments.errLocked'))
      else if (err.status === 429) setServerError(t('tournaments.errTooMany'))
      else if (err.status === 401) setSessionExpired(true)
      else setServerError(t('tournaments.errGeneric', { msg: err.message }))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = invalid => `w-full bg-surface2 border rounded-lg px-3 py-2 text-sm focus:outline-none ${invalid ? 'border-danger focus:border-danger' : 'border-line focus:border-accent'}`
  const ErrorLine = ({ field }) => {
    const issue = fieldIssue(field)
    return issue ? <p className="text-xs text-danger mt-1" role="alert">{issueMessage(issue, t)}</p> : null
  }
  const submitLabel = saving ? t('tournaments.saving') : isEdit ? t('tournaments.submitSave') : t('tournaments.submitCreate')
  const issuesText = issues.map(i => `${t(FIELD_LABEL_KEY[i.field])} — ${issueMessage(i, t)}`)

  if (!authLoading && !user) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopNav />
        <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1">
          <div className="bg-surface rounded-xl p-6 text-center space-y-3">
            <p className="text-muted text-sm">{t('home.bgaConnectRequired')}</p>
            <button onClick={() => login(isEdit ? `/tournament/t/${id}/edit` : '/tournament/new')}
              className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors">
              {t('reunion.connect')}
            </button>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  // Edit mode: nothing of the form shows until the API said this viewer may edit (the
  // viewer block of GET /api/tournaments/:id); a stranger goes straight to the tournament
  // page. The PATCH is refused server-side anyway (403).
  if (isEdit && (authLoading || loading || loadError)) {
    return (
      <div className="min-h-screen flex flex-col">
        <TopNav />
        <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1">
          {loadError
            ? <p className="text-danger text-sm">{loadError}</p>
            : <p className="text-muted text-sm">{t('tournaments.loading')}</p>}
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} noValidate className="max-w-2xl w-full mx-auto px-4 pt-8 flex-1 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display">{isEdit ? t('tournaments.editTitle') : t('tournaments.createTitle')}</h1>
          <Link to={isEdit ? `/tournament/t/${id}` : '/tournament'} className="text-sm text-muted hover:text-ink">{t('lobby.back')}</Link>
        </div>

        {/* Section 1 — the tournament */}
        <section className="bg-surface rounded-xl border border-line p-5 space-y-4">
          <h2 className="font-semibold">{t('tournaments.sectionInfo')}</h2>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-name">{t('tournaments.nameLabel')}</label>
            <input id="tn-name" value={name} onChange={e => edit('name', setName)(e.target.value)} onBlur={() => touch('name')}
              maxLength={80} aria-invalid={!!fieldIssue('name')} className={inputCls(fieldIssue('name'))} />
            <ErrorLine field="name" />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-desc">{t('tournaments.descriptionLabel')}</label>
            <textarea id="tn-desc" value={description} onChange={e => edit('description', setDescription)(e.target.value)} onBlur={() => touch('description')}
              rows={4} maxLength={2000} className={`${inputCls(fieldIssue('description'))} resize-y`} />
            <ErrorLine field="description" />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-bga">{t('tournaments.bgaUrlLabel')}</label>
            <input id="tn-bga" value={bgaUrl} onChange={e => edit('bgaUrl', setBgaUrl)(e.target.value)} onBlur={() => touch('bgaUrl')} disabled={locked}
              placeholder="https://boardgamearena.com/tournament?id=…" aria-invalid={!!fieldIssue('bgaUrl')}
              className={`${inputCls(fieldIssue('bgaUrl'))} font-mono disabled:opacity-60`} />
            <p className="text-xs text-faint mt-1">{t('tournaments.bgaUrlHint')}</p>
            {bgaParsed && !fieldIssue('bgaUrl') && <p className="text-xs mt-1 text-ok">{t('tournaments.bgaIdDetected', { id: bgaParsed.id })}</p>}
            <ErrorLine field="bgaUrl" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1" htmlFor="tn-start">{t('tournaments.startsAtLabel')}</label>
              <input id="tn-start" type="datetime-local" value={startsAt} onChange={e => { setLastDateEdited('startsAt'); edit('startsAt', setStartsAt)(e.target.value) }}
                aria-invalid={!!fieldIssue('startsAt')} className={inputCls(fieldIssue('startsAt'))} />
              <ErrorLine field="startsAt" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1" htmlFor="tn-end">{t('tournaments.endsAtLabel')}</label>
              <input id="tn-end" type="datetime-local" value={endsAt} onChange={e => { setLastDateEdited('endsAt'); edit('endsAt', setEndsAt)(e.target.value) }}
                aria-invalid={!!fieldIssue('endsAt')} className={inputCls(fieldIssue('endsAt'))} />
              <ErrorLine field="endsAt" />
            </div>
          </div>
          <p className="text-xs text-faint">{t('tournaments.timezoneNote', { tz })}</p>
        </section>

        {/* Section 2 — cards */}
        <section id="tn-cards" tabIndex={-1} className="bg-surface rounded-xl border border-line p-5 space-y-4 focus:outline-none">
          <h2 className="font-semibold">{t('tournaments.sectionCards')}</h2>
          {locked && <p className="text-xs text-accent-ink">{t('tournaments.lockedNotice')}</p>}
          {imposed && <p className="text-sm text-accent-ink" role="status">{tc('tournaments.legacyImposed', legacy.pools)}</p>}
          <p className="text-sm text-muted">{t('tournaments.cardsHint')}</p>
          <SetPresetGrid selected={setCode} onSelect={edit('setCode', setSetCode)} disabled={configFrozen || saving} />
          <ErrorLine field="setCode" />
        </section>

        {/* Section 3 — settings */}
        <section id="tn-settings" tabIndex={-1} className="bg-surface rounded-xl border border-line p-5 space-y-6 focus:outline-none">
          <h2 className="font-semibold">{t('tournaments.sectionSettings')}</h2>
          <fieldset disabled={configFrozen || saving} className="space-y-6 disabled:opacity-60">
            <SettingsFields
              mode="sealed"
              showLang={false}
              heroMode={heroes} setHeroMode={setHeroes}
              showUniques={false}
              excludeBanlist={excludeBanlist} setExcludeBanlist={setExcludeBanlist}
              showBanlist
            />
            <TournamentUniqueFields uniques={uniques} onChange={setUniques} uniqueSupport={uniqueSupport} disabled={configFrozen || saving} />
          </fieldset>
        </section>

        {/* Action bar, stuck to the bottom of the viewport */}
        <div className="sticky bottom-0 z-20 -mx-4 px-4 pt-3 pb-4 bg-base/95 backdrop-blur border-t border-line space-y-2">
          {serverError && <p className="text-sm text-danger" role="alert">{serverError}</p>}
          {sessionExpired && (
            <div className="flex flex-wrap items-center gap-3" role="alert">
              <p className="text-sm text-danger">{t('tournaments.errSessionExpired')}</p>
              <button type="button" onClick={reconnect}
                className="text-sm px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface3 text-ink border border-line transition-colors">
                {t('tournaments.reconnectKeep')}
              </button>
            </div>
          )}
          {issues.length > 0 && !loading && (
            <div className="text-sm">
              <p className="text-muted mb-1">{isEdit ? t('tournaments.issuesTitleSave') : t('tournaments.issuesTitleCreate')}</p>
              <ul className="space-y-0.5">
                {issues.map((issue, i) => (
                  <li key={`${issue.field}-${issue.code}`}>
                    <button type="button" onClick={() => { touch(issue.field); focusField(issue.field) }}
                      className={`text-left hover:underline ${touched.has(issue.field) ? 'text-danger' : 'text-ink2'}`}>
                      • {issuesText[i]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <span className="block" title={issues.length ? issuesText.join('\n') : undefined}>
            <button type="submit" disabled={blocked}
              className="w-full py-2.5 bg-accent hover:bg-accent2 text-on-accent font-bold rounded-lg transition-colors border border-transparent disabled:bg-surface2 disabled:border-line disabled:text-ink/45 disabled:cursor-not-allowed">
              {submitLabel}
            </button>
          </span>
        </div>
      </form>
      <Footer />
    </div>
  )
}
