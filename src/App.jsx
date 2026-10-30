import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Lobby from './pages/Lobby.jsx'
import Draft from './pages/Draft.jsx'
import Results from './pages/Results.jsx'
import Sealed from './pages/Sealed.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import TournamentMenu from './pages/TournamentMenu.jsx'
import { TOURNAMENT_HUB_PATH } from './lib/links.js'
import TournamentNormal from './pages/TournamentNormal.jsx'
import TournamentPrep from './pages/TournamentPrep.jsx'
import TournamentBoundDetail from './pages/TournamentBoundDetail.jsx'
import EditDeckRedirect from './pages/EditDeckRedirect.jsx'
import TournamentForm from './pages/TournamentForm.jsx'
import TournamentDetail from './pages/TournamentDetail.jsx'
import TournamentPoolPage from './pages/TournamentPoolPage.jsx'

// The hub's address during its beta (lot 1 was tested on BGA's production with the hub hidden
// there): bookmarks and shared links keep working, query included (?tab=…).
function BetaHubRedirect() {
  const { search } = useLocation()
  return <Navigate to={`${TOURNAMENT_HUB_PATH}${search}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/room/:code" element={<Lobby />} />
      <Route path="/room/:code/draft" element={<Draft />} />
      <Route path="/room/:code/sealed" element={<Sealed />} />
      <Route path="/room/:code/results" element={<Results />} />
      <Route path={TOURNAMENT_HUB_PATH} element={<TournamentMenu />} />
      <Route path="/tournament/beta" element={<BetaHubRedirect />} />
      <Route path="/tournament/normal" element={<TournamentNormal />} />
      <Route path="/tournament/prep" element={<TournamentPrep />} />
      <Route path="/tournament/pools/:id" element={<TournamentBoundDetail />} />
      <Route path="/tournament/new" element={<TournamentForm />} />
      <Route path="/tournament/t/:id" element={<TournamentDetail />} />
      <Route path="/tournament/t/:id/edit" element={<TournamentForm />} />
      <Route path="/tournament/t/:id/pool" element={<TournamentPoolPage />} />
      <Route path="/edit/deck/:deckId" element={<EditDeckRedirect />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
