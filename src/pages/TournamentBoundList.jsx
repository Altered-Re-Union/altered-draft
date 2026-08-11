import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { fetchBoundPools } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TopNav from '../components/TopNav.jsx'

// Button 3: "modifier mes decks sur les tournois en cours" — see ROADMAP.md "Set 6
// preview". There's no signal for when a tournament actually ends, so this list only
// ever grows over a player's career; accepted as-is.
export default function TournamentBoundList() {
  const [pools, setPools] = useState(null)
  const [error, setError] = useState('')
  const { t, tc } = useLang()

  useEffect(() => {
    fetchBoundPools()
      .then(data => setPools(data.pools))
      .catch(e => setError(e.message || t('tournamentPages.couldNotLoadTournaments')))
  }, [t])

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1">
        <h1 className="text-2xl font-display mb-4">{t('tournamentPages.yourOngoingTournaments')}</h1>
        {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
        {!pools && !error && <p className="text-muted text-sm">{t('tournamentPages.loading')}</p>}
        {pools && pools.length === 0 && (
          <p className="text-muted text-sm">{t('tournamentPages.noTournamentsYet')}</p>
        )}
        <div className="space-y-2">
          {pools?.map(p => (
            <Link key={p.id} to={`/tournament/pools/${p.id}`}
              className="block bg-surface hover:bg-surface2 border border-line rounded-lg px-4 py-3 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm">{p.deck?.name ?? t('tournamentPages.sealedPoolFallback', { set: p.setCode })}</p>
                  <p className="text-xs text-faint">
                    {t('tournamentPages.boundAt', { date: p.boundAt ? new Date(p.boundAt).toLocaleString() : '—' })}
                    {p.deck ? ` · ${tc('tournamentPages.cardsInDeck', p.deck.cardQuantity ?? 0)}` : ` · ${t('tournamentPages.noDeckStartedYet')}`}
                  </p>
                </div>
                <span className="text-accent text-sm">{t('tournamentPages.edit')}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}