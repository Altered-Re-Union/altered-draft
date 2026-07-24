import { useCallback } from 'react'
import { fetchNormalPool, resetNormalPool } from '../lib/tournamentApi.js'
import TournamentPoolView from '../components/TournamentPoolView.jsx'

export default function TournamentNormal() {
  const load = useCallback(() => fetchNormalPool(), [])
  const reset = useCallback(async () => {
    try {
      return await resetNormalPool()
    } catch (e) {
      if (e.status === 429) return { cooldownRemainingMs: e.data?.remainingMs ?? 0 }
      throw e
    }
  }, [])

  return <TournamentPoolView title="Sealed on BGA — normal mode" load={load} reset={reset} />
}
