import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { fetchBoundPools, listTournaments } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'
import { StatusPill, formatDateTime, summarizeConfig } from '../components/TournamentBits.jsx'

const BGA_TOURNAMENT_LIST_URL = 'https://boardgamearena.com/tournamentlist?d&type=&players_per_match_min=0&players_per_match_max=0&status=future&gamecateg=3&game=1909&full=true&tournament_i_registered=0&time=0&prestige=0&order=recommended'

function TournamentCard({ tn, t, tc }) {
  const v = tn.viewer
  return (
    <Link to={`/tournament/t/${tn.id}`}
      className="block bg-surface border border-line hover:border-accent/60 rounded-lg px-4 py-3 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-semibold">{tn.name}</p>
        <StatusPill status={tn.status} t={t} />
        {v?.hasPool && <span className="text-xs text-green-400">✓ {t('tournaments.youHavePool')}</span>}
      </div>
      <p className="text-sm text-ink2">{t('tournaments.startsAt', { date: formatDateTime(tn.startsAt) })}</p>
      <p className="text-xs text-muted">{summarizeConfig(tn.config, t, tc)}</p>
      <p className="text-xs text-faint">
        {t('tournaments.organizedBy', { name: tn.organizer.name })} · {tc('tournaments.poolsPrepared', tn.poolCount ?? 0)}
        {v?.deck ? ` · ${t('tournaments.yourDeck', { name: v.deck.name, n: v.deck.cardQuantity ?? 0 })}` : ''}
      </p>
    </Link>
  )
}

// /tournament — the tournaments hub (spec §8): public upcoming/ongoing lists, creation,
// the player's own tournaments, and the legacy generic preparation flow at the bottom.
export default function TournamentMenu() {
  const navigate = useNavigate()
  const { user, login, loading: authLoading } = useAuth()
  const { t, tc } = useLang()
  const [tournaments, setTournaments] = useState(null)
  const [listError, setListError] = useState('')
  const [pools, setPools] = useState(null)
  const [error, setError] = useState('')

  // Public list; re-fetched when the session changes so the viewer flags appear.
  useEffect(() => {
    if (authLoading) return
    listTournaments('open')
      .then(data => setTournaments(data.tournaments))
      .catch(e => setListError(e.message || t('tournaments.couldNotLoad')))
  }, [user, authLoading, t])

  useEffect(() => {
    if (!user) return
    fetchBoundPools()
      .then(data => setPools(data.pools))
      .catch(e => setError(e.message || t('tournamentPages.couldNotLoadTournaments')))
  }, [user, t])

  const upcoming = tournaments?.filter(tn => tn.status === 'upcoming') ?? []
  const ongoing = tournaments?.filter(tn => tn.status === 'ongoing') ?? []

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1 space-y-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-display">{t('tournamentPages.menuTitle')}</h1>
          <button onClick={() => user ? navigate('/tournament/new') : login('/tournament/new')}
            className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors text-sm">
            {t('tournaments.createButton')}
          </button>
        </div>

        <div className="bg-surface2 border border-line rounded-lg p-3 text-sm text-muted">
          <p>
            {t('tournamentPages.registerNoticePrefix')}{' '}
            <a href={BGA_TOURNAMENT_LIST_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              {t('tournamentPages.registerNoticeLinkLabel')}
            </a>
          </p>
          <p className="mt-1">{t('tournamentPages.registerNoticeSchedule')}</p>
        </div>

        <section className="space-y-2">
          <h2 className="font-semibold text-lg">{t('tournaments.upcomingTitle')}</h2>
          {listError && <p className="text-red-400 text-sm">{listError}</p>}
          {!tournaments && !listError && <p className="text-muted text-sm">{t('tournaments.loading')}</p>}
          {tournaments && upcoming.length === 0 && <p className="text-muted text-sm">{t('tournaments.noUpcoming')}</p>}
          {upcoming.map(tn => <TournamentCard key={tn.id} tn={tn} t={t} tc={tc} />)}
        </section>

        {ongoing.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-semibold text-lg">{t('tournaments.ongoingTitle')}</h2>
            {ongoing.map(tn => <TournamentCard key={tn.id} tn={tn} t={t} tc={tc} />)}
          </section>
        )}

        {!user && !authLoading ? (
          <div className="bg-surface rounded-xl p-6 text-center space-y-3">
            <p className="text-muted text-sm">{t('home.bgaConnectRequired')}</p>
            <button onClick={() => login('/tournament')}
              className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors">
              {t('reunion.connect')}
            </button>
          </div>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="font-semibold text-lg">{t('tournaments.myTournamentsTitle')}</h2>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              {!pools && !error && <p className="text-muted text-sm">{t('tournamentPages.loading')}</p>}
              {pools && pools.length === 0 && <p className="text-muted text-sm">{t('tournamentPages.noOngoingTournaments')}</p>}
              {pools?.map(p => {
                const href = p.tournament ? `/tournament/t/${p.tournament.id}/pool` : `/tournament/pools/${p.id}`
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 bg-surface border border-line rounded-lg px-4 py-3">
                    <div>
                      <p className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                        {p.tournamentName || t('tournamentPages.sealedPoolFallback', { set: p.setCode })}
                        {p.tournament && <StatusPill status={p.tournament.status} t={t} />}
                      </p>
                      <p className="text-xs text-faint">
                        {p.tournament
                          ? t('tournaments.startsAt', { date: formatDateTime(p.tournament.startsAt) })
                          : t('tournamentPages.boundAt', { date: p.boundAt ? new Date(p.boundAt).toLocaleString() : '—' })}
                        {p.deck ? ` · ${p.deck.name} · ${tc('tournamentPages.cardsInDeck', p.deck.cardQuantity ?? 0)}` : ` · ${t('tournamentPages.noDeckStartedYet')}`}
                      </p>
                    </div>
                    <Link to={href} className="shrink-0 text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 transition-colors">
                      {t('tournamentPages.changeMyDeck')}
                    </Link>
                  </div>
                )
              })}
            </section>

            <section className="border-t border-line pt-5 space-y-2">
              <h2 className="font-semibold text-sm text-ink2">{t('tournaments.genericPrepTitle')}</h2>
              <p className="text-xs text-faint">{t('tournaments.genericPrepHint')}</p>
              <button onClick={() => navigate('/tournament/prep')}
                className="text-sm px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface3 text-ink transition-colors">
                {t('tournamentPages.prepareNext')}
              </button>
            </section>
          </>
        )}
      </div>
      <Footer />
    </div>
  )
}
