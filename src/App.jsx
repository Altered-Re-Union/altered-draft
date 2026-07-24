import { Routes, Route, Navigate } from 'react-router-dom'
import Home from './pages/Home.jsx'
import Lobby from './pages/Lobby.jsx'
import Draft from './pages/Draft.jsx'
import Results from './pages/Results.jsx'
import Sealed from './pages/Sealed.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import TournamentNormal from './pages/TournamentNormal.jsx'
import TournamentPrep from './pages/TournamentPrep.jsx'
import TournamentBoundList from './pages/TournamentBoundList.jsx'
import TournamentBoundDetail from './pages/TournamentBoundDetail.jsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/room/:code" element={<Lobby />} />
      <Route path="/room/:code/draft" element={<Draft />} />
      <Route path="/room/:code/sealed" element={<Sealed />} />
      <Route path="/room/:code/results" element={<Results />} />
      <Route path="/tournament/normal" element={<TournamentNormal />} />
      <Route path="/tournament/prep" element={<TournamentPrep />} />
      <Route path="/tournament/pools" element={<TournamentBoundList />} />
      <Route path="/tournament/pools/:id" element={<TournamentBoundDetail />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
