import { useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { fetchPoolById } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TournamentPoolView from '../components/TournamentPoolView.jsx'

export default function TournamentBoundDetail() {
  const { id } = useParams()
  const { t } = useLang()
  const load = useCallback(() => fetchPoolById(id), [id])

  return <TournamentPoolView title={t('tournamentPages.boundDetailTitle')} load={load} reset={null} />
}