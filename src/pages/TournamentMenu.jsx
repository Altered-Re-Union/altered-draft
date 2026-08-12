import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { fetchBoundPools } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TopNav from '../components/TopNav.jsx'

const BGA_TOURNAMENT_LIST_URL = 'https://boardgamearena.com/tournamentlist?d&type=&players_per_match_min=0&players_per_match_max=0&status=future&gamecateg=3&game=1909&full=true&tournament_i_registered=0&time=0&prestige=0&order=recommended'

// Fixed-URL submenu ("Tournois" from Home) — see ROADMAP.md "Set 6 preview". Bookmarkable
// at /tournament so a player can jump straight to their ongoing tournaments.
export default function TournamentMenu() {
  const navigate = useNavigate()
  const { user, login, loading: authLoading } = useAuth()
  const { t, tc } = useLang()
  const [pools, setPools] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    fetchBoundPools()
      .then(data => setPools(data.pools))
      .catch(e => setError(e.message || t('tournamentPages.couldNotLoadTournaments')))
  }, [user, t])

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1">
        <h1 className="text-2xl font-display mb-4">{t('tournamentPages.menuTitle')}</h1>

        <div className="bg-surface2 border border-line rounded-lg p-3 text-sm text-muted mb-6">
          <p>
            {t('tournamentPages.registerNoticePrefix')}{' '}
            <a href={BGA_TOURNAMENT_LIST_URL} target="_blank" rel="noopener noreferrer"
              className="text-accent hover:underline">
              {t('tournamentPages.registerNoticeLinkLabel')}
            </a>
          </p>
          <p className="mt-1">{t('tournamentPages.registerNoticeSchedule')}</p>
          <p className="mt-1">{t('tournamentPages.registerNoticeAfterStart')}</p>
        </div>

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
            <button onClick={() => navigate('/tournament/prep')}
              className="w-full bg-surface2 hover:bg-surface3 text-ink font-semibold py-3 rounded-lg transition-colors text-left px-4 mb-8">
              {t('tournamentPages.prepareNext')}
            </button>

            <h2 className="font-semibold text-lg mb-3">{t('tournamentPages.myOngoingTournaments')}</h2>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            {!pools && !error && <p className="text-muted text-sm">{t('tournamentPages.loading')}</p>}
            {pools && pools.length === 0 && (
              <p className="text-muted text-sm">{t('tournamentPages.noOngoingTournaments')}</p>
            )}
            <div className="space-y-2">
              {pools?.map(p => (
                <div key={p.id}
                  className="flex items-center justify-between gap-3 bg-surface border border-line rounded-lg px-4 py-3">
                  <div>
                    <p className="font-semibold text-sm">{p.deck?.name ?? t('tournamentPages.sealedPoolFallback', { set: p.setCode })}</p>
                    <p className="text-xs text-faint">
                      {t('tournamentPages.boundAt', { date: p.boundAt ? new Date(p.boundAt).toLocaleString() : '—' })}
                      {p.deck ? ` · ${tc('tournamentPages.cardsInDeck', p.deck.cardQuantity ?? 0)}` : ` · ${t('tournamentPages.noDeckStartedYet')}`}
                    </p>
                  </div>
                  <Link to={`/tournament/pools/${p.id}`}
                    className="shrink-0 text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 transition-colors">
                    {t('tournamentPages.changeMyDeck')}
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}