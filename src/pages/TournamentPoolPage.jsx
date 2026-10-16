import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { fetchTournamentPool } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TournamentPoolView from '../components/TournamentPoolView.jsx'

// A player's pool for a declared tournament. TournamentPoolView shows the pool's
// tournamentName (the altered-draft name) as the title.
export default function TournamentPoolPage() {
  const { id } = useParams()
  const { t } = useLang()
  const load = useCallback(() => fetchTournamentPool(id), [id])
  return (
    <TournamentPoolView
      title={t('tournamentPages.boundDetailTitle')}
      load={load}
      reset={null}
      backTo={{ to: `/tournament/t/${id}`, label: t('tournaments.backToTournament') }}
    />
  )
}
