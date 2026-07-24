import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { generateRoomCode } from '../lib/roomCode.js'
import { useAuth } from '../auth/AuthProvider.jsx'
import { fetchBoundPools } from '../lib/tournamentApi.js'
import TopNav from '../components/TopNav.jsx'

export default function Home() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const prefillCode = params.get('join') ?? ''

  const [joinCode, setJoinCode] = useState(prefillCode.toUpperCase())
  const [joinName, setJoinName] = useState('')
  const [createName, setCreateName] = useState('')
  const [mode, setMode] = useState(prefillCode ? 'join' : null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasBoundTournaments, setHasBoundTournaments] = useState(false)

  // Button 3 ("modifier mes decks sur les tournois en cours") only shows up once the
  // player actually has at least one bound tournament pool.
  useEffect(() => {
    if (!user) { setHasBoundTournaments(false); return }
    fetchBoundPools().then(data => setHasBoundTournaments((data.pools ?? []).length > 0)).catch(() => {})
  }, [user])

  // Logged in to Re:Union → prefill the display name with your pseudo (without
  // overwriting anything you've already typed).
  useEffect(() => {
    if (!user?.pseudo) return
    setCreateName(n => n || user.pseudo)
    setJoinName(n => n || user.pseudo)
  }, [user])

  async function handleCreate(e) {
    e.preventDefault()
    if (!createName.trim()) { setError('Enter your display name'); return }
    setLoading(true)
    setError('')

    const code = generateRoomCode()
    const playerId = crypto.randomUUID()

    const initialState = {
      config: { sets: ['CORE'], playerCount: 4, lang: 'EN' },
      players: [{ id: playerId, name: createName.trim(), joinedAt: new Date().toISOString() }],
      phase: 'lobby',
      round: 1,
      packs: {},
      picks: {},
      waitingFor: [],
      remainingPacks: [],
      version: 0,
    }

    const { error: dbErr } = await supabase
      .from('draft_rooms')
      .insert({ id: code, state: initialState })

    if (dbErr) {
      setError('Could not create room. Please try again.')
      setLoading(false)
      return
    }

    localStorage.setItem(`player_${code}`, JSON.stringify({ id: playerId, name: createName.trim(), isHost: true }))
    navigate(`/room/${code}`)
  }

  async function handleJoin(e) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (!code || code.length < 3) { setError('Enter a valid room code'); return }
    if (!joinName.trim()) { setError('Enter your display name'); return }
    setLoading(true)
    setError('')

    const { data, error: dbErr } = await supabase
      .from('draft_rooms')
      .select('state')
      .eq('id', code)
      .single()

    if (dbErr || !data) {
      setError('Room not found. Check the code and try again.')
      setLoading(false)
      return
    }

    if (data.state.phase !== 'lobby') {
      setError('This draft has already started.')
      setLoading(false)
      return
    }

    const playerId = crypto.randomUUID()
    const newPlayer = { id: playerId, name: joinName.trim(), joinedAt: new Date().toISOString() }
    const updatedPlayers = [...data.state.players, newPlayer]
    const newState = { ...data.state, players: updatedPlayers }

    const { error: updateErr } = await supabase
      .from('draft_rooms')
      .update({ state: newState })
      .eq('id', code)

    if (updateErr) {
      setError('Could not join room. Please try again.')
      setLoading(false)
      return
    }

    localStorage.setItem(`player_${code}`, JSON.stringify({ id: playerId, name: joinName.trim(), isHost: false }))
    navigate(`/room/${code}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-display tracking-wide mb-2">
            <span className="text-accent">Altered</span> Draft
          </h1>
          <p className="text-muted text-sm">
            Multiplayer booster draft simulator for the Altered TCG.
            Open a room, share the code, draft together in real time.
          </p>
        </div>

        {user && (
          <div className="space-y-2 mb-6">
            <button onClick={() => navigate('/tournament/normal')}
              className="w-full bg-surface2 hover:bg-surface3 text-ink font-semibold py-3 rounded-lg transition-colors text-left px-4">
              Jouer sur BGA en scellé (mode normal)
            </button>
            <button onClick={() => navigate('/tournament/prep')}
              className="w-full bg-surface2 hover:bg-surface3 text-ink font-semibold py-3 rounded-lg transition-colors text-left px-4">
              Préparer mon prochain tournoi en scellé sur BGA
            </button>
            {hasBoundTournaments && (
              <button onClick={() => navigate('/tournament/pools')}
                className="w-full bg-surface2 hover:bg-surface3 text-ink font-semibold py-3 rounded-lg transition-colors text-left px-4">
                Modifier mes decks sur les tournois en cours
              </button>
            )}
            <div className="border-t border-line my-4" />
          </div>
        )}
        {!user && (
          <p className="text-xs text-faint text-center mb-6">
            Connectez-vous avec Re:Union pour accéder aux scellés BGA (normal et tournoi).
          </p>
        )}

        {!mode && (
          <div className="flex gap-4">
            <button onClick={() => setMode('create')}
              className="flex-1 bg-accent hover:bg-accent2 text-on-accent font-semibold py-3 rounded-lg transition-colors">
              Create a room
            </button>
            <button onClick={() => setMode('join')}
              className="flex-1 bg-surface2 hover:bg-surface3 text-ink font-semibold py-3 rounded-lg transition-colors">
              Join a room
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreate} className="bg-surface rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">Create a draft room</h2>
            <div>
              <label className="block text-sm text-muted mb-1">Your display name</label>
              <input value={createName} onChange={e => setCreateName(e.target.value)}
                placeholder="e.g. Alice"
                className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                autoFocus />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setMode(null); setError('') }}
                className="flex-1 py-2 rounded-lg bg-surface2 hover:bg-surface3 text-sm transition-colors">Back</button>
              <button type="submit" disabled={loading}
                className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent2 text-on-accent font-semibold text-sm transition-colors disabled:opacity-50">
                {loading ? 'Creating…' : 'Create room'}
              </button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form onSubmit={handleJoin} className="bg-surface rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">Join a draft room</h2>
            <div>
              <label className="block text-sm text-muted mb-1">Room code</label>
              <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder="e.g. XKQZ" maxLength={6}
                className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm font-mono tracking-widest uppercase focus:outline-none focus:border-accent"
                autoFocus />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">Your display name</label>
              <input value={joinName} onChange={e => setJoinName(e.target.value)}
                placeholder="e.g. Bob"
                className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setMode(null); setError('') }}
                className="flex-1 py-2 rounded-lg bg-surface2 hover:bg-surface3 text-sm transition-colors">Back</button>
              <button type="submit" disabled={loading}
                className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent2 text-on-accent font-semibold text-sm transition-colors disabled:opacity-50">
                {loading ? 'Joining…' : 'Join room'}
              </button>
            </div>
          </form>
        )}
      </div>
      </div>
    </div>
  )
}
