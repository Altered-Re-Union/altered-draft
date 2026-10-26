import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'
import { getTournament, updateTournament, deleteTournament, fetchTournamentPool } from '../lib/tournamentApi.js'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'
import TournamentChecklist from '../components/TournamentChecklist.jsx'
import { StatusPill, formatDateTime, ConfigSummary } from '../components/TournamentBits.jsx'

export default function TournamentDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const { t, tc } = useLang()
  const [tournament, setTournament] = useState(null)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(() => {
    setError('')
    return getTournament(id)
      .then(setTournament)
      .catch(e => setError(e.status === 404 ? t('tournaments.notFound') : t('tournaments.errGeneric', { msg: e.message })))
  }, [id, t])

  // Re-fetch when the session changes: the viewer block depends on the bearer.
  useEffect(() => { reload() }, [reload, user])

  async function handleOpenPool() {
    setOpening(true); setOpenError('')
    try {
      await fetchTournamentPool(id)
      navigate(`/tournament/t/${id}/pool`)
    } catch (e) {
      setOpenError(e.status === 409 ? t('tournaments.step2Closed') : t('tournaments.errGeneric', { msg: e.message }))
    } finally {
      setOpening(false)
    }
  }

  async function act(action) {
    const confirmKey = action === 'cancel' ? 'tournaments.cancelConfirm' : null
    if (confirmKey && !window.confirm(t(confirmKey))) return
    setBusy(true)
    try {
      setTournament(await updateTournament(id, { action }))
    } catch (e) {
      setError(t('tournaments.errGeneric', { msg: e.message }))
    } finally {
      setBusy(false)
    }
  }

  async function handleDetach() {
    // Count the pools at click time, not at page load: players may have opened one since.
    let poolCount = tournament.poolCount ?? 0
    try {
      const fresh = await getTournament(id)
      setTournament(fresh)
      poolCount = fresh.poolCount ?? 0
    } catch { /* keep the loaded count */ }
    if (!window.confirm(tc('tournaments.detachConfirm', poolCount))) return
    await act('detach')
  }

  async function handleDelete() {
    if (!window.confirm(t('tournaments.deleteConfirm'))) return
    setBusy(true)
    try {
      await deleteTournament(id)
      navigate('/tournament')
    } catch (e) {
      setError(e.status === 409 ? t('tournaments.deleteBlocked') : t('tournaments.errGeneric', { msg: e.message }))
      setBusy(false)
    }
  }

  const viewer = tournament?.viewer ?? null
  const canManage = !!(viewer?.isOrganizer || viewer?.isModerator)
  const detached = tournament?.status === 'detached'
  const btn = 'text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 disabled:opacity-40 transition-colors'

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1 space-y-6">
        <Link to="/tournament" className="text-xs text-muted hover:text-ink">← {t('tournamentPages.menuTitle')}</Link>
        {error && <p className="text-danger text-sm">{error}</p>}
        {!tournament && !error && <p className="text-muted text-sm">{t('tournaments.loading')}</p>}

        {tournament && (
          <>
            <header className="bg-surface rounded-xl border border-line p-5 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-display">{tournament.name}</h1>
                <StatusPill status={tournament.status} t={t} />
              </div>
              <p className="text-sm text-ink2">
                {t('tournaments.startsAt', { date: formatDateTime(tournament.startsAt) })}
                {tournament.endsAt ? ` · ${t('tournaments.endsAt', { date: formatDateTime(tournament.endsAt) })}` : ''}
              </p>
              <p className="text-xs text-faint">
                {t('tournaments.organizedBy', { name: tournament.organizer.name })} · {tc('tournaments.poolsPrepared', tournament.poolCount ?? 0)}
              </p>
              <ConfigSummary config={tournament.config} t={t} tc={tc} className="text-sm text-muted" />
              {tournament.description && <p className="text-sm text-ink whitespace-pre-wrap pt-2">{tournament.description}</p>}
              {detached && <p className="text-sm text-danger pt-2">{t('tournaments.detachedNotice')}</p>}
            </header>

            <TournamentChecklist
              tournament={tournament} viewer={viewer} user={user}
              onLogin={() => login(`/tournament/t/${id}`)}
              onOpenPool={handleOpenPool} opening={opening} openError={openError}
            />

            {canManage && (
              <section data-testid="organizer-panel" className="bg-surface2 rounded-xl border border-line p-4 space-y-3">
                <h2 className="font-semibold text-sm">{t('tournaments.organizerPanel')}</h2>
                {tournament.poolsByOrigin && (
                  <p className="text-xs text-muted">
                    {t('tournaments.poolsByOrigin', { page: tournament.poolsByOrigin.page + tournament.poolsByOrigin.legacy, bga: tournament.poolsByOrigin.bga })}
                  </p>
                )}
                {tournament.status === 'ongoing' && tournament.poolsByOrigin?.bga === 0 && (
                  <p className="text-xs text-accent-ink">{t('tournaments.bgaZeroWarning')}</p>
                )}
                {!detached && <div className="flex flex-wrap gap-2">
                  <Link to={`/tournament/t/${id}/edit`} className={btn}>{t('tournaments.edit')}</Link>
                  {tournament.cancelledAt
                    ? <button onClick={() => act('restore')} disabled={busy} className={btn}>{t('tournaments.restore')}</button>
                    : <button onClick={() => act('cancel')} disabled={busy} className={`${btn} hover:bg-danger-soft hover:text-danger`}>{t('tournaments.cancel')}</button>}
                  {tournament.endedAt
                    ? <button onClick={() => act('reopen')} disabled={busy} className={btn}>{t('tournaments.reopen')}</button>
                    : <button onClick={() => act('close')} disabled={busy} className={btn}>{t('tournaments.close')}</button>}
                  <button onClick={handleDelete} disabled={busy || (tournament.poolCount ?? 0) > 0}
                    title={(tournament.poolCount ?? 0) > 0 ? t('tournaments.deleteBlocked') : undefined}
                    className={`${btn} hover:bg-danger-soft hover:text-danger`}>{t('tournaments.delete')}</button>
                </div>}
                {detached && (
                  <button onClick={handleDelete} disabled={busy} className={`${btn} hover:bg-danger-soft hover:text-danger`}>{t('tournaments.delete')}</button>
                )}
                {viewer?.isModerator && !detached && (
                  <div className="border-t border-line pt-3 space-y-2">
                    <p className="text-xs text-faint">{t('tournaments.detachHint')}</p>
                    <button onClick={handleDetach} disabled={busy} className={`${btn} text-danger hover:bg-danger-soft hover:text-danger`}>{t('tournaments.detach')}</button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
      <Footer />
    </div>
  )
}
