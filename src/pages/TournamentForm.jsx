import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'
import { parseBgaTournamentUrl } from '../lib/bgaUrl.js'
import { validateTournamentFields } from '../lib/tournamentRules.js'
import { validateTournamentConfig } from '../lib/tournamentConfig.js'
import { hasFactionRanges } from '../lib/uniqueFactionRanges.js'
import { createTournament, updateTournament, getTournament } from '../lib/tournamentApi.js'
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

const FIELD_ERROR_KEYS = {
  name: 'tournaments.errName',
  description: 'tournaments.errDescription',
  startsAt: 'tournaments.errStartsAt',
  endsAt: 'tournaments.errEndsAt',
  bgaUrl: 'tournaments.errBgaUrl',
}

export default function TournamentForm() {
  const { id } = useParams() // present in edit mode
  const navigate = useNavigate()
  const { user, login, loading: authLoading } = useAuth()
  const { t } = useLang()
  const isEdit = !!id

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [bgaUrl, setBgaUrl] = useState('')
  const [startsAt, setStartsAt] = useState(defaultStart)
  const [endsAt, setEndsAt] = useState('')
  const [setCode, setSetCode] = useState(null)
  const [heroes, setHeroes] = useState('packs')
  const [uniques, setUniques] = useState({ inBoosters: 1, guaranteed: 1, evenFactions: false })
  const [excludeBanlist, setExcludeBanlist] = useState(false)

  const [locked, setLocked] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  // Edit mode: prefill from the tournament; only its organizer or a moderator may be here.
  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    getTournament(id)
      .then(tn => {
        if (cancelled) return
        if (!tn.viewer?.isOrganizer && !tn.viewer?.isModerator) { navigate(`/tournament/t/${id}`, { replace: true }); return }
        setName(tn.name); setDescription(tn.description); setBgaUrl(tn.bgaUrl)
        setStartsAt(toLocalInput(tn.startsAt)); setEndsAt(toLocalInput(tn.endsAt))
        setSetCode(tn.config.source.setCode); setHeroes(tn.config.heroes)
        setUniques(tn.config.uniques); setExcludeBanlist(!!tn.config.excludeBanlist)
        setLocked(!!tn.locked)
      })
      .catch(e => { if (!cancelled) setError(e.status === 404 ? t('tournaments.notFound') : t('tournaments.errGeneric', { msg: e.message })) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [id, isEdit, navigate, t, user])

  const bgaParsed = useMemo(() => parseBgaTournamentUrl(bgaUrl), [bgaUrl])
  const uniqueSupport = !setCode || hasFactionRanges(setCode)
  const tz = useMemo(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone } catch { return 'UTC' } }, [])

  const config = {
    v: 1, format: 'sealed',
    source: { type: 'set', setCode, boosters: 7 },
    heroes,
    uniques: uniqueSupport ? uniques : { inBoosters: 0, guaranteed: 0, evenFactions: false },
    excludeBanlist,
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setFieldErrors({})
    const body = { name, description, bgaUrl, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt), config }

    // Same pure checks the server runs — surfaces errors before the round-trip.
    const fields = validateTournamentFields(body, { isCreate: !isEdit })
    const cfg = validateTournamentConfig(config)
    if (!fields.ok || (!locked && !cfg.ok)) {
      setFieldErrors(fields.errors)
      if (!locked && !cfg.ok) setError(cfg.errors.includes('source.setCode') ? t('tournaments.errSelectSet') : t('tournaments.errGeneric', { msg: cfg.errors.join(', ') }))
      return
    }

    setSaving(true)
    try {
      if (isEdit) {
        const patch = { name: body.name, description: body.description, startsAt: body.startsAt, endsAt: body.endsAt }
        if (!locked) { patch.bgaUrl = body.bgaUrl; patch.config = cfg.config }
        await updateTournament(id, patch)
        navigate(`/tournament/t/${id}`)
      } else {
        const created = await createTournament({ ...body, config: cfg.config })
        navigate(`/tournament/t/${created.id}`)
      }
    } catch (err) {
      if (err.status === 400 && err.data?.fields) setFieldErrors(err.data.fields)
      else if (err.status === 409 && err.data?.error === 'bga_tournament_taken') setFieldErrors({ bgaUrl: 'taken' })
      else if (err.status === 409 && err.data?.error === 'tournament_locked') setError(t('tournaments.errLocked'))
      else if (err.status === 429) setError(t('tournaments.errTooMany'))
      else setError(t('tournaments.errGeneric', { msg: err.message }))
    } finally {
      setSaving(false)
    }
  }

  const fieldMsg = key => {
    const code = fieldErrors[key]
    if (!code) return null
    if (key === 'bgaUrl' && code === 'taken') return t('tournaments.errBgaTaken')
    if (key === 'startsAt' && code === 'must_be_before_end') return t('tournaments.errStartsAtBeforeEnd')
    return t(FIELD_ERROR_KEYS[key] ?? 'tournaments.errGeneric', { msg: code })
  }
  const inputCls = 'w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent'
  const ErrorLine = ({ field }) => fieldMsg(field) ? <p className="text-xs text-red-400 mt-1">{fieldMsg(field)}</p> : null

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

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <form onSubmit={handleSubmit} className="max-w-2xl w-full mx-auto px-4 py-8 flex-1 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-display">{isEdit ? t('tournaments.editTitle') : t('tournaments.createTitle')}</h1>
          <Link to={isEdit ? `/tournament/t/${id}` : '/tournament'} className="text-sm text-muted hover:text-ink">{t('lobby.back')}</Link>
        </div>
        {loading && <p className="text-muted text-sm">{t('tournaments.loading')}</p>}
        {error && <p className="text-red-400 text-sm">{error}</p>}

        {/* Section 1 — the tournament */}
        <section className="bg-surface rounded-xl border border-line p-5 space-y-4">
          <h2 className="font-semibold">{t('tournaments.sectionInfo')}</h2>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-name">{t('tournaments.nameLabel')}</label>
            <input id="tn-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} className={inputCls} />
            <ErrorLine field="name" />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-desc">{t('tournaments.descriptionLabel')}</label>
            <textarea id="tn-desc" value={description} onChange={e => setDescription(e.target.value)} rows={4} maxLength={2000} className={`${inputCls} resize-y`} />
            <ErrorLine field="description" />
          </div>
          <div>
            <label className="block text-sm text-muted mb-1" htmlFor="tn-bga">{t('tournaments.bgaUrlLabel')}</label>
            <input id="tn-bga" value={bgaUrl} onChange={e => setBgaUrl(e.target.value)} disabled={locked}
              placeholder="https://boardgamearena.com/tournament?id=…" className={`${inputCls} font-mono disabled:opacity-60`} />
            <p className="text-xs text-faint mt-1">{t('tournaments.bgaUrlHint')}</p>
            {bgaUrl.trim() && (
              <p className={`text-xs mt-1 ${bgaParsed ? 'text-green-400' : 'text-red-400'}`}>
                {bgaParsed ? t('tournaments.bgaIdDetected', { id: bgaParsed.id }) : t('tournaments.bgaUrlInvalid')}
              </p>
            )}
            <ErrorLine field="bgaUrl" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-muted mb-1" htmlFor="tn-start">{t('tournaments.startsAtLabel')}</label>
              <input id="tn-start" type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className={inputCls} />
              <ErrorLine field="startsAt" />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1" htmlFor="tn-end">{t('tournaments.endsAtLabel')}</label>
              <input id="tn-end" type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className={inputCls} />
              <ErrorLine field="endsAt" />
            </div>
          </div>
          <p className="text-xs text-faint">{t('tournaments.timezoneNote', { tz })}</p>
        </section>

        {/* Section 2 — cards */}
        <section className="bg-surface rounded-xl border border-line p-5 space-y-4">
          <h2 className="font-semibold">{t('tournaments.sectionCards')}</h2>
          {locked && <p className="text-xs text-accent2">{t('tournaments.lockedNotice')}</p>}
          <p className="text-sm text-muted">{t('tournaments.cardsHint')}</p>
          <SetPresetGrid selected={setCode} onSelect={setSetCode} disabled={locked || saving} />
        </section>

        {/* Section 3 — settings */}
        <section className="bg-surface rounded-xl border border-line p-5 space-y-6">
          <h2 className="font-semibold">{t('tournaments.sectionSettings')}</h2>
          <fieldset disabled={locked || saving} className="space-y-6 disabled:opacity-60">
            <SettingsFields
              mode="sealed"
              showLang={false}
              heroMode={heroes} setHeroMode={setHeroes}
              showUniques={false}
              excludeBanlist={excludeBanlist} setExcludeBanlist={setExcludeBanlist}
              showBanlist
            />
            <TournamentUniqueFields uniques={uniques} onChange={setUniques} uniqueSupport={uniqueSupport} disabled={locked || saving} />
          </fieldset>
        </section>

        <button type="submit" disabled={saving || loading}
          className="w-full py-2.5 bg-accent hover:bg-accent2 disabled:opacity-40 text-on-accent font-bold rounded-lg transition-colors">
          {saving ? t('tournaments.saving') : isEdit ? t('tournaments.submitSave') : t('tournaments.submitCreate')}
        </button>
      </form>
      <Footer />
    </div>
  )
}
