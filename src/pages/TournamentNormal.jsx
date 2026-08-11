import { useCallback } from 'react'
import { fetchNormalPool, resetNormalPool } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TournamentPoolView from '../components/TournamentPoolView.jsx'

export default function TournamentNormal() {
  const { t } = useLang()
  const load = useCallback(() => fetchNormalPool(), [])
  const reset = useCallback(async () => {
    try {
      return await resetNormalPool()
    } catch (e) {
      if (e.status === 429) return { cooldownRemainingMs: e.data?.remainingMs ?? 0 }
      throw e
    }
  }, [])

  return <TournamentPoolView title={t('tournamentPages.normalTitle')} load={load} reset={reset} />
}