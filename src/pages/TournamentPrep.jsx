import { useCallback } from 'react'
import { fetchPrepPool } from '../lib/tournamentApi.js'
import TournamentPoolView from '../components/TournamentPoolView.jsx'

export default function TournamentPrep() {
  const load = useCallback(() => fetchPrepPool(), [])

  return <TournamentPoolView title="Preparing your next tournament pool" load={load} reset={null} />
}
