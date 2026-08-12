import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { fetchPoolByDeckId } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TopNav from '../components/TopNav.jsx'

// Deep link from a decks-api deck id (e.g. surfaced by BGA or altered.re) straight to that
// deck's edit page in here — resolved by asking which of the caller's OWN sealed pools links
// that deck id (api/tournament-pool-by-deck.js, scoped to the verified Keycloak sub), then
// redirecting to that pool's page: normal mode, or the specific bound tournament. A deck
// that isn't linked to any pool of the CALLER's — wrong owner, or no such deck at all —
// resolves identically to "not found", so this never reveals whether the deck exists to
// anyone but its owner.
export default function EditDeckRedirect() {
  const { deckId } = useParams()
  const navigate = useNavigate()
  const { user, login, loading: authLoading } = useAuth()
  const { t } = useLang()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetchPoolByDeckId(deckId)
      .then(pool => {
        if (cancelled) return
        navigate(pool.kind === 'normal' ? '/tournament/normal' : `/tournament/pools/${pool.id}`, { replace: true })
      })
      .catch(() => { if (!cancelled) setError(t('tournamentPages.editDeckNotFound')) })
    return () => { cancelled = true }
  }, [user, deckId, navigate, t])

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-2xl w-full mx-auto px-4 py-8 flex-1">
        {!user && !authLoading ? (
          <div className="bg-surface rounded-xl p-6 text-center space-y-3">
            <p className="text-muted text-sm">{t('home.bgaConnectRequired')}</p>
            <button onClick={() => login(`/edit/deck/${deckId}`)}
              className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors">
              {t('reunion.connect')}
            </button>
          </div>
        ) : (
          <p className="text-center text-sm text-muted">
            {error || t('tournamentPages.loading')}
          </p>
        )}
      </div>
    </div>
  )
}