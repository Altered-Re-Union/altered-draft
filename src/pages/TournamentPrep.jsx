import { useCallback } from 'react'
import { fetchPrepPool } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TournamentPoolView from '../components/TournamentPoolView.jsx'

export default function TournamentPrep() {
  const { t } = useLang()
  const load = useCallback(() => fetchPrepPool(), [])

  return <TournamentPoolView title={t('tournamentPages.prepTitle')} load={load} reset={null} />
}