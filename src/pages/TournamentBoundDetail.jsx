import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPoolById } from '../lib/tournamentApi.js'
import TournamentPoolView from '../components/TournamentPoolView.jsx'

export default function TournamentBoundDetail() {
  const { id } = useParams()
  const load = useCallback(() => fetchPoolById(id), [id])

  return <TournamentPoolView title="Tournament pool — edit between games" load={load} reset={null} />
}
