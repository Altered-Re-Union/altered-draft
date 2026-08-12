import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { getRoom, insertRoom, updateRoom } from '../lib/roomStore.js'
import { generateRoomCode } from '../lib/roomCode.js'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'

export default function Home() {
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const { t } = useLang()
  const params = new URLSearchParams(window.location.search)
  const prefillCode = params.get('join') ?? ''

  const [joinCode, setJoinCode] = useState(prefillCode.toUpperCase())
  const [joinName, setJoinName] = useState('')
  const [createName, setCreateName] = useState('')
  const [mode, setMode] = useState(prefillCode ? 'join' : null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Logged in to Re:Union → prefill the display name with your pseudo (without
  // overwriting anything you've already typed).
  useEffect(() => {
    if (!user?.pseudo) return
    setCreateName(n => n || user.pseudo)
    setJoinName(n => n || user.pseudo)
  }, [user])

  async function handleCreate(e) {
    e.preventDefault()
    if (!createName.trim()) { setError(t('home.errorEnterName')); return }
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

    const { error: dbErr } = await insertRoom(code, initialState)

    if (dbErr) {
      setError(t('home.errorCreateFailed'))
      setLoading(false)
      return
    }

    localStorage.setItem(`player_${code}`, JSON.stringify({ id: playerId, name: createName.trim(), isHost: true }))
    navigate(`/room/${code}`)
  }

  async function handleJoin(e) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (!code || code.length < 3) { setError(t('home.errorEnterCode')); return }
    if (!joinName.trim()) { setError(t('home.errorEnterName')); return }
    setLoading(true)
    setError('')

    const { data, error: dbErr } = await getRoom(code)

    if (dbErr || !data) {
      setError(t('home.errorRoomNotFound'))
      setLoading(false)
      return
    }

    if (data.state.phase !== 'lobby') {
      setError(t('home.errorAlreadyStarted'))
      setLoading(false)
      return
    }

    const playerId = crypto.randomUUID()
    const newPlayer = { id: playerId, name: joinName.trim(), joinedAt: new Date().toISOString() }
    const updatedPlayers = [...data.state.players, newPlayer]
    const newState = { ...data.state, players: updatedPlayers }

    const { error: updateErr } = await updateRoom(code, newState)

    if (updateErr) {
      setError(t('home.errorJoinFailed'))
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
        </div>

        <div className="mb-6">
          <h2 className="font-semibold text-lg">{t('home.sealedTitle')}</h2>
          <p className="text-muted text-sm mb-3">{t('home.sealedDesc')}</p>
          <div className="space-y-2">
            <button onClick={() => user ? navigate('/tournament') : login('/tournament')}
              className="w-full bg-surface2 hover:bg-surface3 text-ink rounded-lg overflow-hidden transition-colors text-left">
              <img src="/images/tournois.png" alt="" className="w-full h-24 object-cover" />
              <span className="block font-semibold py-3 px-4">{t('home.tournamentsBtn')}</span>
            </button>
            <button onClick={() => user ? navigate('/tournament/normal') : login('/tournament/normal')}
              className="w-full bg-surface2 hover:bg-surface3 text-ink rounded-lg overflow-hidden transition-colors text-left">
              <img src="/images/normal.png" alt="" className="w-full h-24 object-cover" />
              <span className="block font-semibold py-3 px-4">{t('home.normalModeBtn')}</span>
            </button>
            {!user && (
              <p className="text-xs text-faint text-center pt-1">
                {t('home.bgaConnectRequired')}
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-line my-6" />

        <div className="mb-6">
          <h2 className="font-semibold text-lg">{t('home.otherFormatsTitle')}</h2>
          <p className="text-muted text-sm mb-3">{t('home.tagline')}</p>
        </div>

        {!mode && (
          <div className="flex gap-4">
            <button onClick={() => setMode('create')}
              className="flex-1 bg-accent hover:bg-accent2 text-on-accent font-semibold py-3 rounded-lg transition-colors">
              {t('home.createRoom')}
            </button>
            <button onClick={() => setMode('join')}
              className="flex-1 bg-surface2 hover:bg-surface3 text-ink font-semibold py-3 rounded-lg transition-colors">
              {t('home.joinRoom')}
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form onSubmit={handleCreate} className="bg-surface rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">{t('home.createRoomTitle')}</h2>
            <div>
              <label className="block text-sm text-muted mb-1">{t('home.displayNameLabel')}</label>
              <input value={createName} onChange={e => setCreateName(e.target.value)}
                placeholder={t('home.displayNamePlaceholderAlice')}
                className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
                autoFocus />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setMode(null); setError('') }}
                className="flex-1 py-2 rounded-lg bg-surface2 hover:bg-surface3 text-sm transition-colors">{t('home.back')}</button>
              <button type="submit" disabled={loading}
                className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent2 text-on-accent font-semibold text-sm transition-colors disabled:opacity-50">
                {loading ? t('home.creating') : t('home.createRoomBtn')}
              </button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form onSubmit={handleJoin} className="bg-surface rounded-xl p-6 space-y-4">
            <h2 className="font-semibold text-lg">{t('home.joinRoomTitle')}</h2>
            <div>
              <label className="block text-sm text-muted mb-1">{t('home.roomCodeLabel')}</label>
              <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                placeholder={t('home.roomCodePlaceholder')} maxLength={6}
                className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm font-mono tracking-widest uppercase focus:outline-none focus:border-accent"
                autoFocus />
            </div>
            <div>
              <label className="block text-sm text-muted mb-1">{t('home.displayNameLabel')}</label>
              <input value={joinName} onChange={e => setJoinName(e.target.value)}
                placeholder={t('home.displayNamePlaceholderBob')}
                className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => { setMode(null); setError('') }}
                className="flex-1 py-2 rounded-lg bg-surface2 hover:bg-surface3 text-sm transition-colors">{t('home.back')}</button>
              <button type="submit" disabled={loading}
                className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent2 text-on-accent font-semibold text-sm transition-colors disabled:opacity-50">
                {loading ? t('home.joining') : t('home.joinRoomBtn')}
              </button>
            </div>
          </form>
        )}
      </div>
      </div>
      <Footer />
    </div>
  )
}
