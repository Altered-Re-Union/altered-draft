import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getRoom, updateRoomIfVersion, subscribeToRoom } from '../lib/roomStore.js'
import { fetchSet, apiSetCode, fetchUniques, isUniqueRef, needsCardApi, uniqueRefsIn } from '../lib/cardData.js'
import { applyPick, applyHeroPick } from '../lib/draftLogic.js'
import { applyRochesterPick } from '../lib/rochesterLogic.js'
import { applyRotisseriePick } from '../lib/rotisserieLogic.js'
import { applyWinstonAction } from '../lib/winstonLogic.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import CardGrid from '../components/CardGrid.jsx'
import RotisserieGrid from '../components/RotisserieGrid.jsx'
import WinstonBoard from '../components/WinstonBoard.jsx'
import DraftSidebar from '../components/DraftSidebar.jsx'
import PoolGrid from '../components/PoolGrid.jsx'
import PlayerStatus from '../components/PlayerStatus.jsx'
import ZoomCard from '../components/ZoomCard.jsx'
import PickTimer from '../components/PickTimer.jsx'
import MobileTabBar from '../components/MobileTabBar.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import DraftStats from '../components/DraftStats.jsx'
import { COMMUNITY_CUBES } from '../lib/cubes.js'

// Compact read-only strip of the heroes you've drafted (during the hero phase, and
// as a reminder afterward). `label` lets callers relabel it per phase.
function MyHeroes({ heroes, cardMap, label }) {
  const { t } = useLang()
  if (!heroes?.length) return null
  return (
    <div className="mb-4 border border-accent/30 bg-accent/5 rounded-lg px-3 py-2.5">
      <p className="text-xs font-semibold text-accent mb-2">{label ?? t('draft.yourHeroes')} ({heroes.length})</p>
      <div className="flex flex-wrap gap-2">
        {heroes.map((ref, i) => (
          <ZoomCard key={`${ref}-${i}`} ref_={ref} card={cardMap?.[ref]} width="w-20 sm:w-24" />
        ))}
      </div>
    </div>
  )
}

export default function Draft() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { t, tc } = useLang()

  const [roomState, setRoomState] = useState(null)
  const [me, setMe] = useState(null)
  const [cardMap, setCardMap] = useState({})
  const [picking, setPicking] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [fetchErrors, setFetchErrors] = useState([])
  const [mobileTab, setMobileTab] = useState('pack')

  // Reconnection
  const [needsRejoin, setNeedsRejoin] = useState(false)
  const [rejoinName, setRejoinName] = useState('')
  const [rejoinError, setRejoinError] = useState('')
  const [showPool, setShowPool] = useState(false) // full filterable view of what you've drafted

  const stateRef = useRef(null)
  stateRef.current = roomState
  const pickingRef = useRef(false)
  pickingRef.current = picking
  // Hard lock against overlapping doPick invocations (timer + click, or retries).
  // Independent of the `picking` UI flag, which realtime clears on every update.
  const inFlightRef = useRef(false)

  useEffect(() => {
    const stored = localStorage.getItem(`player_${code}`)
    if (stored) setMe(JSON.parse(stored))
    else setNeedsRejoin(true)
  }, [code])

  useEffect(() => {
    getRoom(code)
      .then(async ({ data, error }) => {
        if (error || !data) { navigate('/'); return }
        const state = data.state
        setRoomState(state)
        if (state.phase === 'done') { navigate(`/room/${code}/results`); return }
        if (state.phase === 'sealed') { navigate(`/room/${code}/sealed`); return }

        if (state.config.sets?.length) {
          const errors = [], maps = {}
          const apiCodes = [...new Set(state.config.sets.map(apiSetCode))]
          await Promise.all(apiCodes.map(async s => {
            try {
              const cards = await fetchSet(s, state.config.lang || 'EN')
              for (const c of cards) maps[c.reference] = c
            } catch (e) { errors.push(`${s}: ${e.message}`) }
          }))
          if (errors.length) setFetchErrors(errors)
          // Cube uniques aren't in set data — pull them (bundled snapshot, else API).
          const cube = COMMUNITY_CUBES.find(c => c.id === state.config.cubeId)
          const cc = state.config.customCube
          const cubeRefs = cube?.refs ?? (cc ? [...(cc.cards ?? []), ...(cc.heroes ?? [])] : null)
          if (cubeRefs) {
            const uCards = await fetchUniques(cubeRefs.filter(needsCardApi), state.config.lang || 'EN')
            for (const c of uCards) maps[c.reference] = c
          }
          // Uniques injected into packs (the "add random uniques" option) aren't in set
          // data or the cube ref list — scan the live state for any …_U_ refs and fetch them.
          const liveUniques = uniqueRefsIn(state).filter(r => !maps[r])
          if (liveUniques.length) {
            const uCards = await fetchUniques(liveUniques, state.config.lang || 'EN')
            for (const c of uCards) maps[c.reference] = c
          }
          setCardMap(maps)
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per room; me/needsRejoin aren't used in the body
  }, [code, navigate])

  useEffect(() => {
    return subscribeToRoom(code, state => {
      setRoomState(state)
      setPicking(false)
      if (state.phase === 'done') navigate(`/room/${code}/results`)
      if (state.phase === 'sealed') navigate(`/room/${code}/sealed`)
    }, status => {
      if (status === 'error') setReconnecting(true)
      if (status === 'subscribed') setReconnecting(false)
    })
  }, [code, navigate])

  useEffect(() => {
    if (!showPool) return
    const onKey = e => { if (e.key === 'Escape') setShowPool(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showPool])

  const isHeroPhase = roomState?.phase === 'heroDraft'
  const isRochester = roomState?.phase === 'rochester'
  const isRotisserie = roomState?.phase === 'rotisserie'
  const isWinston = roomState?.phase === 'winston'
  // Rochester (one shared pack at a time) and Rotisserie (one shared pool for the whole
  // draft) are both turn-based snake picks driven by pickOrder[turnPos].
  const isSnakePick = isRochester || isRotisserie
  const isTurnBased = isHeroPhase || isSnakePick || isWinston
  const myIndex = roomState && me ? roomState.players.findIndex(p => p.id === me.id) : -1
  // Card draft: simultaneous — each seat has its own pack and is in waitingFor.
  // Hero draft (between rounds): turn-based — ONE shared pool of all heroes, picked in
  // snake order, so only the seat at heroOrder[heroTurnPos] can pick.
  // Winston: 2-player, turn-based — only roomState.turn may act.
  const heroTurnIdx = isHeroPhase ? (roomState.heroOrder?.[roomState.heroTurnPos] ?? -1) : -1
  const snakeTurnIdx = isSnakePick ? (roomState.pickOrder?.[roomState.turnPos] ?? -1) : -1
  const turnIdx = isHeroPhase ? heroTurnIdx : isSnakePick ? snakeTurnIdx : isWinston ? (roomState.turn ?? -1) : -1
  const isMyTurn = isTurnBased
    ? (myIndex !== -1 && myIndex === turnIdx)
    : (myIndex !== -1 && (roomState?.waitingFor?.includes(myIndex) ?? false))
  const myCardPack = (myIndex !== -1 && roomState) ? (roomState.packs?.[String(myIndex)] ?? []) : []
  const myPicks = (myIndex !== -1 && roomState) ? (roomState.picks[String(myIndex)] ?? []) : []
  const myHeroPicks = (myIndex !== -1 && roomState) ? (roomState.heroPicks?.[String(myIndex)] ?? []) : []
  // Everything you've drafted so far (heroes first), for the "My pool" overlay.
  const poolRefs = [...myHeroPicks, ...myPicks]
  const myPack = isHeroPhase ? (roomState?.heroPool ?? [])
    : isRochester ? (roomState?.activePack ?? [])
    : isRotisserie ? (roomState?.pool ?? [])
    : myCardPack
  const turnPlayerName = (turnIdx >= 0 && roomState) ? (roomState.players[turnIdx]?.name ?? '') : ''

  const doPick = useCallback(async (ref) => {
    if (inFlightRef.current) return
    let state = stateRef.current
    if (!state || !me) return
    // Whether this seat may pick `ref` right now — differs by phase. Card draft: it's
    // in your waitingFor and the card is in your pack. Hero draft: it's your turn in
    // the snake order and the hero is in the shared pool.
    const canPick = (s, idx) =>
      s.phase === 'heroDraft' ? (s.heroOrder?.[s.heroTurnPos] === idx && (s.heroPool ?? []).includes(ref))
      : s.phase === 'rochester' ? (s.pickOrder?.[s.turnPos] === idx && (s.activePack ?? []).includes(ref))
      : s.phase === 'rotisserie' ? (s.pickOrder?.[s.turnPos] === idx && (s.pool ?? []).includes(ref))
      : ((s.waitingFor?.includes(idx) ?? false) && (s.packs?.[String(idx)] ?? []).includes(ref))
    const idx0 = state.players.findIndex(p => p.id === me.id)
    if (idx0 === -1 || !canPick(state, idx0)) return

    inFlightRef.current = true
    setPicking(true)
    try {
      // Optimistic concurrency: only commit if the row is still at the version we read.
      // Concurrent picks (card draft) or a moved turn (hero draft) → re-sync and retry.
      for (let attempt = 0; attempt < 12; attempt++) {
        const idx = state.players.findIndex(p => p.id === me.id)
        if (idx === -1 || !canPick(state, idx)) { setPicking(false); return }

        const expectedVersion = state.version ?? 0
        const newState = state.phase === 'heroDraft' ? applyHeroPick(state, idx, ref)
          : state.phase === 'rochester' ? applyRochesterPick(state, idx, ref)
          : state.phase === 'rotisserie' ? applyRotisseriePick(state, idx, ref)
          : applyPick(state, idx, ref)
        newState.version = expectedVersion + 1

        const { data, error } = await updateRoomIfVersion(code, newState, expectedVersion)

        if (error) { // transient/network — drop this attempt, let the user retry
          const { data: fresh } = await getRoom(code)
          if (fresh) setRoomState(fresh.state)
          setPicking(false)
          return
        }
        if (data && data.length > 0) return // committed; realtime will broadcast + clear `picking`

        // Version conflict: someone wrote first. Re-sync to the latest state and retry.
        const { data: fresh } = await getRoom(code)
        if (!fresh) { setPicking(false); return }
        state = fresh.state
        setRoomState(fresh.state)
        await new Promise(r => setTimeout(r, 30 + Math.random() * 70)) // jitter to avoid livelock
      }
      setPicking(false) // exhausted retries — release so the user can try again
    } finally {
      inFlightRef.current = false
    }
  }, [me, code])

  // Winston actions ('take' | 'decline') use the same optimistic-concurrency commit as picks,
  // but the move is an action, not a card ref — so it's a separate path.
  const doWinstonAction = useCallback(async (action) => {
    if (inFlightRef.current) return
    let state = stateRef.current
    if (!state || !me || state.phase !== 'winston') return
    const idx0 = state.players.findIndex(p => p.id === me.id)
    if (idx0 === -1 || state.turn !== idx0) return

    inFlightRef.current = true
    setPicking(true)
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        const idx = state.players.findIndex(p => p.id === me.id)
        if (idx === -1 || state.phase !== 'winston' || state.turn !== idx) { setPicking(false); return }

        const expectedVersion = state.version ?? 0
        const newState = applyWinstonAction(state, idx, action)
        if (newState === state) { setPicking(false); return } // illegal / no-op
        newState.version = expectedVersion + 1

        const { data, error } = await updateRoomIfVersion(code, newState, expectedVersion)

        if (error) {
          const { data: fresh } = await getRoom(code)
          if (fresh) setRoomState(fresh.state)
          setPicking(false); return
        }
        if (data && data.length > 0) return

        const { data: fresh } = await getRoom(code)
        if (!fresh) { setPicking(false); return }
        state = fresh.state
        setRoomState(fresh.state)
        await new Promise(r => setTimeout(r, 30 + Math.random() * 70))
      }
      setPicking(false)
    } finally {
      inFlightRef.current = false
    }
  }, [me, code])

  const handleTimeout = useCallback(() => {
    if (!isMyTurn || pickingRef.current) return
    if (isWinston) { doWinstonAction('take'); return } // auto-take keeps the draft moving
    if (myPack.length === 0) return
    doPick(myPack[Math.floor(Math.random() * myPack.length)])
  }, [isMyTurn, isWinston, myPack, doPick, doWinstonAction])

  async function handleRejoin(e) {
    e.preventDefault()
    const name = rejoinName.trim()
    if (!name) { setRejoinError(t('draft.errEnterName')); return }
    const { data } = await getRoom(code)
    if (!data) { setRejoinError(t('draft.errRoomNotFound')); return }
    const player = data.state.players.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (!player) { setRejoinError(t('draft.errNoPlayerWithName')); return }
    const identity = { id: player.id, name: player.name, isHost: data.state.players[0]?.id === player.id }
    localStorage.setItem(`player_${code}`, JSON.stringify(identity))
    setMe(identity); setNeedsRejoin(false); setRejoinError('')
  }

  if (needsRejoin && !me) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <form onSubmit={handleRejoin} className="bg-surface rounded-xl p-6 w-full max-w-sm space-y-4">
          <h2 className="font-semibold text-lg">{t('draft.rejoinTitle')}</h2>
          <p className="text-sm text-muted">{t('draft.rejoinPrompt', { code })}</p>
          <input value={rejoinName} onChange={e => setRejoinName(e.target.value)} placeholder={t('draft.rejoinPlaceholder')} autoFocus
            className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          {rejoinError && <p className="text-red-400 text-sm">{rejoinError}</p>}
          <div className="flex gap-3">
            <button type="button" onClick={() => navigate('/')} className="flex-1 py-2 rounded-lg bg-surface2 text-sm">{t('draft.home')}</button>
            <button type="submit" className="flex-1 py-2 rounded-lg bg-accent text-on-accent font-semibold text-sm">{t('draft.rejoinBtn')}</button>
          </div>
        </form>
      </div>
    )
  }

  if (!roomState || !me) return <div className="min-h-screen flex items-center justify-center text-muted">{t('draft.loadingDraft')}</div>

  if (myIndex === -1) return (
    <div className="min-h-screen flex items-center justify-center flex-col gap-4 text-muted">
      <p>{t('draft.notParticipant')}</p>
      <button onClick={() => navigate('/')} className="px-4 py-2 bg-surface2 rounded-lg text-sm">{t('draft.goHome')}</button>
    </div>
  )

  const packSize = myPack.length
  const activePicks = isHeroPhase ? myHeroPicks : myPicks
  const heroTarget = isHeroPhase ? (roomState.heroTarget ?? 0) : 0
  const heroPickerName = (isHeroPhase && heroTurnIdx >= 0) ? (roomState.players[heroTurnIdx]?.name ?? '') : ''
  // Progress within the current phase. Hero draft: how many heroes you have toward the
  // target. Card draft: a full pack's size isn't fixed (hero toggle, set composition),
  // so derive it from picks made this round.
  let currentPickNum, totalPicks
  if (isHeroPhase) {
    currentPickNum = myHeroPicks.length // heroes you already have (target shown alongside)
    totalPicks = heroTarget
  } else if (isRochester) {
    currentPickNum = myPicks.length // your running pool size; the pack counter shows progress
    totalPicks = roomState.totalPacks ?? 0
  } else if (isRotisserie) {
    currentPickNum = myPicks.length
    totalPicks = roomState.target ?? 0
  } else if (isWinston) {
    currentPickNum = myPicks.length
    totalPicks = 0
  } else {
    const fullPack = roomState.round ? Math.round((myPicks.length + packSize) / roomState.round) : packSize
    currentPickNum = Math.max(1, fullPack - packSize + 1)
    totalPicks = fullPack
  }

  const topBarLabel = isHeroPhase ? t('draft.heroDraft')
    : isRochester ? t('draft.packOf', { n: roomState.packNum, total: roomState.totalPacks })
    : isRotisserie ? t('draft.rotisserieOf', { n: myPicks.length, target: roomState.target })
    : isWinston ? t('draft.winstonPool', { n: myPicks.length })
    : t('draft.roundOf', { n: roomState.round })

  // `othersKey` differs between the desktop/mobile "nobody's turn" banners below.
  const waitingMessage = othersKey => isHeroPhase
    ? t('draft.waitingForHeroPick', { name: heroPickerName })
    : isSnakePick
      ? t('draft.waitingForPick', { name: turnPlayerName })
      : t(othersKey)

  return (
    <div className="min-h-screen flex flex-col pb-16 md:pb-0">
      {reconnecting && <div className="bg-yellow-600 text-yellow-100 text-center text-sm py-2">{t('draft.reconnecting')}</div>}
      {fetchErrors.length > 0 && (
        <div className="bg-red-900/50 border border-red-700 text-red-300 text-sm px-4 py-2">
          {t('draft.failedToLoad', { errors: fetchErrors.join(', ') })}
        </div>
      )}

      {/* Top bar */}
      <div className="bg-surface border-b border-line px-4 py-2 flex items-center gap-3 shrink-0">
        <span className="font-mono text-accent font-bold text-sm">{code}</span>
        <span className="text-faint text-xs">{topBarLabel}</span>
        <span className="ml-auto text-sm">
          {isMyTurn
            ? <span className="text-green-400 font-medium text-sm">{t('draft.yourTurn')}</span>
            : <span className="text-faint text-xs">{t('draft.waitingEllipsis')}</span>}
        </span>
        <button onClick={() => setShowPool(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/15 hover:bg-accent/25 border border-accent/40 text-accent font-semibold text-sm transition-colors shrink-0">
          <span aria-hidden="true">▦</span> {t('draft.myPool', { n: poolRefs.length })}
        </button>
        <ThemeToggle />
      </div>

      {/* Player status — compact on mobile */}
      <PlayerStatus players={roomState.players}
        picks={isHeroPhase ? (roomState.heroPicks ?? {}) : roomState.picks}
        waitingFor={isTurnBased ? (turnIdx >= 0 ? [turnIdx] : []) : roomState.waitingFor}
        meId={me.id} />

      {/* Desktop: side-by-side layout */}
      <div className="hidden md:flex flex-1 overflow-hidden">
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="flex items-baseline gap-3 mb-3">
            {isHeroPhase ? (
              <>
                <h2 className="font-semibold text-lg text-accent">{t('draft.heroDraft')}</h2>
                <span className="text-sm text-faint">{t('draft.youHaveHeroes', { n: currentPickNum, total: totalPicks })}</span>
              </>
            ) : isRochester ? (
              <>
                <h2 className="font-semibold text-lg">{t('draft.packHeaderOf', { n: roomState.packNum, total: roomState.totalPacks })}</h2>
                <span className="text-sm text-faint">{tc('draft.cardsLeft', packSize, { pool: myPicks.length })}</span>
              </>
            ) : isRotisserie ? (
              <>
                <h2 className="font-semibold text-lg">{t('draft.rotisserieHeader')}</h2>
                <span className="text-sm text-faint">{t('draft.rotisseriePoolStatus', { n: myPicks.length, target: roomState.target, inPool: packSize })}</span>
              </>
            ) : isWinston ? (
              <>
                <h2 className="font-semibold text-lg">{t('draft.winstonHeader')}</h2>
                <span className="text-sm text-faint">{t('draft.winstonPoolStatus', { n: myPicks.length })}</span>
              </>
            ) : (
              <>
                <h2 className="font-semibold text-lg">{t('draft.packHeaderRound', { n: roomState.round })}</h2>
                <span className="text-sm text-faint">{t('draft.pickN', { n: currentPickNum })}</span>
              </>
            )}
          </div>
          {isHeroPhase && (
            <p className="mb-3 text-sm text-muted">
              {roomState.heroStart
                ? tc('draft.heroBlurbStart', heroTarget)
                : t('draft.heroBlurbBetween', { n: heroTarget })}
            </p>
          )}
          {isRochester && (
            <p className="mb-3 text-sm text-muted">
              {t('draft.rochesterBlurb')}
            </p>
          )}
          {isRotisserie && (
            <p className="mb-3 text-sm text-muted">
              {t('draft.rotisserieBlurb', { n: roomState.target })}
            </p>
          )}
          {isWinston && (
            <p className="mb-3 text-sm text-muted">
              {t('draft.winstonBlurb')}
            </p>
          )}
          {isHeroPhase && myHeroPicks.length > 0 && <MyHeroes heroes={myHeroPicks} cardMap={cardMap} label={t('draft.heroesYouveTaken')} />}
          {!isHeroPhase && myHeroPicks.length > 0 && <MyHeroes heroes={myHeroPicks} cardMap={cardMap} />}
          {roomState.config?.timerEnabled && roomState.pickDeadline && (
            <PickTimer deadline={roomState.pickDeadline} isMyTurn={isMyTurn} onTimeout={handleTimeout} />
          )}
          {!isMyTurn && !isWinston && (
            <div className="mb-4 bg-surface border border-line rounded-lg px-4 py-3 text-sm text-muted">
              {waitingMessage('draft.waitingOthersToPick')}
            </div>
          )}
          {isWinston
            ? <WinstonBoard state={roomState} myIndex={myIndex} cardMap={cardMap} isMyTurn={isMyTurn}
                onAction={doWinstonAction} disabled={picking} />
            : isRotisserie
              ? <RotisserieGrid refs={myPack} cardMap={cardMap} onPick={doPick} disabled={!isMyTurn || picking} />
              : <CardGrid packRefs={myPack} cardMap={cardMap} onPick={doPick} disabled={!isMyTurn || picking} />}
        </div>
        <div className="w-80 border-l border-line flex flex-col">
          <DraftSidebar pickedRefs={activePicks} cardMap={cardMap} round={roomState.round} code={code} />
        </div>
      </div>

      {/* Mobile: tab-based layout */}
      <div className="md:hidden flex-1 overflow-y-auto">
        {mobileTab === 'pack' && (
          <div className="p-3">
            <div className="flex items-baseline gap-2 mb-2">
              <h2 className="font-semibold">{isHeroPhase ? <span className="text-accent">{t('draft.heroDraft')}</span> : isRochester ? t('draft.packOf', { n: roomState.packNum, total: roomState.totalPacks }) : isRotisserie ? t('draft.rotisserieHeader') : isWinston ? t('draft.winstonHeader') : t('draft.packHeaderRound', { n: roomState.round })}</h2>
              <span className="text-xs text-faint">{isHeroPhase ? t('draft.mobileHeroesCount', { n: currentPickNum, total: totalPicks }) : isRochester ? t('draft.mobileLeft', { n: packSize }) : isRotisserie ? t('draft.mobileRatio', { n: myPicks.length, total: roomState.target }) : isWinston ? t('draft.mobilePool', { n: myPicks.length }) : t('draft.pickN', { n: currentPickNum })}</span>
            </div>
            {myHeroPicks.length > 0 && <MyHeroes heroes={myHeroPicks} cardMap={cardMap} label={isHeroPhase ? t('draft.heroesYouveTaken') : undefined} />}
            {roomState.config?.timerEnabled && roomState.pickDeadline && (
              <PickTimer deadline={roomState.pickDeadline} isMyTurn={isMyTurn} onTimeout={handleTimeout} />
            )}
            {!isMyTurn && !isWinston && (
              <div className="mb-3 bg-surface border border-line rounded-lg px-3 py-2 text-sm text-muted">
                {waitingMessage('draft.waitingOthers')}
              </div>
            )}
            {isWinston
              ? <WinstonBoard state={roomState} myIndex={myIndex} cardMap={cardMap} isMyTurn={isMyTurn}
                  onAction={doWinstonAction} disabled={picking} />
              : isRotisserie
                ? <RotisserieGrid refs={myPack} cardMap={cardMap} onPick={(ref) => { doPick(ref); setMobileTab('pack') }}
                    disabled={!isMyTurn || picking} />
                : <CardGrid packRefs={myPack} cardMap={cardMap} onPick={(ref) => { doPick(ref); setMobileTab('pack') }}
                    disabled={!isMyTurn || picking} />}
          </div>
        )}
        {mobileTab === 'picks' && (
          <DraftSidebar pickedRefs={activePicks} cardMap={cardMap} round={roomState.round} code={code} />
        )}
        {mobileTab === 'stats' && (
          <div className="p-3">
            <DraftStats pickedRefs={activePicks} cardMap={cardMap} />
          </div>
        )}
      </div>

      <MobileTabBar tab={mobileTab} setTab={setMobileTab} pickCount={activePicks.length} />

      {/* My pool — a full, filterable/sortable view of everything you've drafted so far,
          same browser as the Results pool tab (read-only here). */}
      {showPool && (
        <div className="fixed inset-0 z-50 bg-black/60 p-2 sm:p-6 flex flex-col"
          onMouseDown={e => { if (e.target === e.currentTarget) setShowPool(false) }}>
          <div className="bg-base border border-line rounded-2xl w-full max-w-6xl mx-auto flex-1 min-h-0 flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line shrink-0">
              <h2 className="font-display text-lg text-ink">
                {t('draft.yourPoolHeader')} <span className="text-faint text-sm font-sans">{tc('draft.poolCardsCount', poolRefs.length)}</span>
              </h2>
              <button onClick={() => setShowPool(false)}
                className="text-faint hover:text-ink2 transition-colors text-2xl leading-none">×</button>
            </div>
            <div className="flex-1 min-h-0">
              {poolRefs.length
                ? <PoolGrid refs={poolRefs} cardMap={cardMap} />
                : <p className="p-6 text-sm text-faint">{t('draft.nothingDraftedYet')}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}