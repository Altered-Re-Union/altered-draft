import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { handleCallback } from '../lib/reunion.js'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'

// Lands here after Keycloak redirects back with ?code=…. Exchanges the code (via
// /api/token), loads the profile, then returns to wherever the user started.
export default function AuthCallback() {
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const { t } = useLang()
  const [error, setError] = useState('')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return // auth codes are single-use — guard against double-run
    ran.current = true
    handleCallback()
      .then(async (returnPath) => {
        await refreshUser()
        navigate(returnPath || '/', { replace: true })
      })
      .catch(e => setError(e.message || t('authCallback.signInFailed')))
  }, [navigate, refreshUser, t])

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {error
        ? <div className="text-center">
            <p className="text-red-400 mb-3">{error}</p>
            <button onClick={() => navigate('/', { replace: true })}
              className="px-4 py-2 rounded-lg bg-surface2 hover:bg-surface3 text-sm">{t('authCallback.backHome')}</button>
          </div>
        : <p className="text-muted">{t('authCallback.signingIn')}</p>}
    </div>
  )
}