import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getRoom } from '../lib/roomStore.js'
import { fetchSet, apiSetCode, SET_ABBREV, SET_FULL_NAMES, fetchUniques, isUniqueRef, needsCardApi, uniqueRefsIn } from '../lib/cardData.js'
import { COMMUNITY_CUBES } from '../lib/cubes.js'
import { SET_ICONS, setCodeFromRef } from '../lib/assets.js'
import { buildDecklist } from '../lib/exportFormat.js'
import ExportMenu from '../components/ExportMenu.jsx'
import ReunionButton from '../components/ReunionButton.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import DraftStats from '../components/DraftStats.jsx'
import PoolGrid, { SimpleCardGrid } from '../components/PoolGrid.jsx'

export default function Sealed() {
  const { code } = useParams()
  const navigate = useNavigate()

  const [roomState, setRoomState] = useState(null)
  const [me, setMe] = useState(null)
  const [cardMap, setCardMap] = useState({})
  const [packIndex, setPackIndex] = useState(0)
  const [tab, setTab] = useState('booster') // 'booster' | 'pool' | 'deck' | 'stats'
  const [statsScope, setStatsScope] = useState('pool') // 'pool' | 'deck'
  const [deck, setDeck] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem(`player_${code}`)
    if (!stored) { navigate('/'); return }
    setMe(JSON.parse(stored))
  }, [code, navigate])

  useEffect(() => {
    getRoom(code)
      .then(async ({ data }) => {
        if (!data) { navigate('/'); return }
        setRoomState(data.state)
        const apiCodes = [...new Set((data.state.config.sets ?? []).map(apiSetCode))]
        const maps = {}
        await Promise.all(apiCodes.map(async s => {
          const cards = await fetchSet(s, data.state.config.lang || 'EN').catch(() => [])
          for (const c of cards) maps[c.reference] = c
        }))
        // Cube uniques aren't in set data — pull them so the unique slot renders.
        const cube = COMMUNITY_CUBES.find(c => c.id === data.state.config.cubeId)
        const cc = data.state.config.customCube
        // Include the free-hero pool so promo/unique heroes seeded into the pool resolve.
        const freeHeroPool = data.state.config.freeHeroPool ?? []
        const cubeRefs = [...(cube?.refs ?? (cc ? [...(cc.cards ?? []), ...(cc.heroes ?? [])] : [])), ...freeHeroPool]
        if (cubeRefs.length) {
          const uCards = await fetchUniques(cubeRefs.filter(needsCardApi), data.state.config.lang || 'EN')
          for (const c of uCards) maps[c.reference] = c
        }
        // Uniques injected into boosters (the "add random uniques" option) aren't in set
        // data or the cube ref list — scan the live state for …_U_ refs and fetch them.
        const liveUniques = uniqueRefsIn(data.state).filter(r => !maps[r])
        if (liveUniques.length) {
          const uCards = await fetchUniques(liveUniques, data.state.config.lang || 'EN')
          for (const c of uCards) maps[c.reference] = c
        }
        setCardMap(maps)
        setLoading(false)
      })
  }, [code, navigate])

  useEffect(() => {
    if (!me) return
    const stored = localStorage.getItem(`sealed_deck_${code}_${me.id}`)
    if (stored) setDeck(JSON.parse(stored))
  }, [me, code])

  function saveDeck(next) {
    setDeck(next)
    if (me) localStorage.setItem(`sealed_deck_${code}_${me.id}`, JSON.stringify(next))
  }

  if (!roomState || !me) return <div className="min-h-screen flex items-center justify-center text-muted">Loading…</div>

  const myIndex = roomState.players.findIndex(p => p.id === me.id)
  const myPacks = roomState.sealedPacks?.[String(myIndex)]
    ?? (roomState.sealedPools?.[String(myIndex)] ? [roomState.sealedPools[String(myIndex)]] : [])
  const totalPacks = myPacks.length
  // Free-hero mode: seed the pool with one copy of each available hero so players pick a
  // hero from the pool like any other card (no separate hero picker UI).
  const freeHeroPool = roomState.config?.freeHero ? (roomState.config.freeHeroPool ?? []) : []
  const allRefs = [...myPacks.flat(), ...freeHeroPool]

  const poolCounts = {}
  for (const ref of allRefs) poolCounts[ref] = (poolCounts[ref] ?? 0) + 1

  const currentPack = myPacks[packIndex] ?? []
  const allDecklist = buildDecklist(allRefs, cardMap)

  // Cube sealed boosters are multiset (cards span every set in the cube), so a
  // per-set label is misleading — show the cube name instead.
  const cube = COMMUNITY_CUBES.find(c => c.id === roomState.config.cubeId)
  const cubeName = cube?.name ?? roomState.config.customCube?.name ?? null
  const isCube = !!cubeName

  // Each sealed booster is single-set — label it from its cards (cubes excepted).
  function packSet(pack) {
    if (isCube) return { name: cubeName, icon: null }
    const raw = pack?.length ? setCodeFromRef(pack[0]) : null
    if (!raw) return { name: null, icon: null }
    const abbrev = SET_ABBREV[raw] ?? raw
    return { name: SET_FULL_NAMES[abbrev] ?? abbrev, icon: SET_ICONS[raw] ?? null }
  }
  const currentSet = packSet(currentPack)
  // Position of this booster among all boosters of the same set, e.g. 1/2
  const sameSetIdx = myPacks.map((p, i) => ({ i, name: packSet(p).name })).filter(x => x.name === currentSet.name)
  const setTotal = sameSetIdx.length
  const setOrdinal = sameSetIdx.findIndex(x => x.i === packIndex) + 1

  const deckTotal = Object.values(deck).reduce((a, b) => a + b, 0)
  const deckRefs = Object.entries(deck).flatMap(([ref, qty]) => Array(qty).fill(ref))
  const deckDecklist = buildDecklist(deckRefs, cardMap)

  // Hero counts toward both card total and faction limit
  const deckFactions = new Set(deckRefs.map(r => cardMap[r]?.faction).filter(Boolean))
  const deckHeroCount = deckRefs.filter(r => cardMap[r]?.cardType === 'HERO').length
  const isEnough = deckRefs.length >= 30
  const isValidFactions = deckFactions.size <= 3
  const isValidHero = deckHeroCount <= 1
  const isValid = isEnough && isValidFactions && isValidHero

  function addToDeck(ref) {
    const have = poolCounts[ref] ?? 0
    const inDeck = deck[ref] ?? 0
    if (inDeck >= have) return
    saveDeck({ ...deck, [ref]: inDeck + 1 })
  }
  function removeFromDeck(ref) {
    const inDeck = deck[ref] ?? 0
    if (inDeck <= 0) return
    const next = { ...deck }
    if (inDeck === 1) delete next[ref]
    else next[ref] = inDeck - 1
    saveDeck(next)
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="bg-surface border-b border-line px-4 py-2 flex items-center gap-3 shrink-0">
        <span className="font-mono text-accent font-bold text-sm">{code}</span>
        <span className="text-muted text-sm">Sealed</span>
        <div className="ml-auto flex gap-2 items-center">
          <ReunionButton />
          <ExportMenu poolRefs={allRefs} deckRefs={deckRefs}
            poolDecklist={allDecklist} deckDecklist={deckDecklist} name={code} format="Sealed" />
          <ThemeToggle />
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-surface border-b border-line flex shrink-0">
        {[
          { id: 'booster', label: `Boosters (${totalPacks})` },
          { id: 'pool',    label: `Full Pool (${allRefs.length})` },
          { id: 'deck',    label: `Deck (${deckTotal})`, highlight: isValid },
          { id: 'stats',   label: 'Stats' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 py-2.5 text-sm transition-colors ${
              tab === t.id
                ? t.highlight ? 'text-green-400 border-b-2 border-green-400' : 'text-accent border-b-2 border-accent2'
                : 'text-faint hover:text-ink2'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* BOOSTER TAB */}
      {tab === 'booster' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-line shrink-0">
            <button onClick={() => setPackIndex(i => Math.max(0, i - 1))} disabled={packIndex === 0}
              className="w-8 h-8 rounded-lg bg-surface2 disabled:opacity-30 flex items-center justify-center text-ink2 hover:bg-surface3">‹</button>
            <div className="flex gap-1 flex-1 justify-center flex-wrap">
              {myPacks.map((pack, i) => {
                const s = packSet(pack)
                return (
                  <button key={i} onClick={() => setPackIndex(i)} title={s.name ?? `Booster ${i + 1}`}
                    className={`h-7 px-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 ${
                      i === packIndex ? 'bg-accent text-on-accent' : 'bg-surface2 text-muted hover:bg-surface3'}`}>
                    {s.icon && <img src={s.icon} alt="" className="w-3.5 h-3.5 object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />}
                    {i + 1}
                  </button>
                )
              })}
            </div>
            <button onClick={() => setPackIndex(i => Math.min(totalPacks - 1, i + 1))} disabled={packIndex === totalPacks - 1}
              className="w-8 h-8 rounded-lg bg-surface2 disabled:opacity-30 flex items-center justify-center text-ink2 hover:bg-surface3">›</button>
          </div>
          <div className="flex-1 overflow-y-auto px-8 pt-4 pb-40" style={{ scrollbarGutter: 'stable' }}>
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              {currentSet.icon && <img src={currentSet.icon} alt="" className="w-5 h-5 object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />}
              <span>Booster {packIndex + 1}</span>
              {currentSet.name && (
                <span className="text-muted font-normal">
                  · {currentSet.name}
                  {!isCube && <span className="text-faint"> {setOrdinal}/{setTotal}</span>}
                </span>
              )}
            </h2>
            <SimpleCardGrid refs={currentPack} cardMap={cardMap} loading={loading}
              deck={deck} poolCounts={poolCounts} onAdd={addToDeck} onRemove={removeFromDeck} />
          </div>
        </div>
      )}

      {/* FULL POOL TAB — shared PoolGrid */}
      {tab === 'pool' && (
        <PoolGrid refs={allRefs} cardMap={cardMap} deck={deck} poolCounts={poolCounts}
          onAdd={addToDeck} onRemove={removeFromDeck} loading={loading} />
      )}

      {/* DECK TAB */}
      {tab === 'deck' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className={`px-4 py-2 border-b shrink-0 flex flex-wrap gap-3 items-center text-sm ${
            isValid ? 'border-green-800 bg-green-900/20' : 'border-line bg-surface'}`}>
            <span className={isEnough ? 'text-green-400' : 'text-red-400'}>{isEnough ? '✓' : '✗'} {deckRefs.length}/30 cards</span>
            <span className={isValidFactions ? 'text-green-400' : 'text-red-400'}>{isValidFactions ? '✓' : '✗'} {deckFactions.size}/3 factions</span>
            <span className={isValidHero ? (deckHeroCount === 1 ? 'text-green-400' : 'text-faint') : 'text-red-400'}>{isValidHero ? '✓' : '✗'} {deckHeroCount}/1 hero</span>
            {isValid && <span className="text-green-400 font-semibold ml-auto">Deck is valid ✓</span>}
          </div>
          {deckTotal === 0
            ? <div className="flex-1 flex items-center justify-center text-faint text-sm">No cards in deck yet. Use + on cards to add them.</div>
            : <div className="flex-1 overflow-hidden"><PoolGrid refs={deckRefs} cardMap={cardMap} deck={deck} poolCounts={poolCounts} onAdd={addToDeck} onRemove={removeFromDeck} loading={loading} /></div>}
        </div>
      )}

      {/* STATS TAB */}
      {tab === 'stats' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {deckTotal > 0 && (
            <div className="flex border-b border-line shrink-0">
              {[['pool', 'Full Pool'], ['deck', 'Deck']].map(([id, label]) => (
                <button key={id} onClick={() => setStatsScope(id)}
                  className={`flex-1 py-2 text-sm transition-colors ${statsScope === id ? 'text-accent border-b-2 border-accent2' : 'text-faint hover:text-ink2'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <DraftStats pickedRefs={statsScope === 'deck' && deckTotal > 0 ? deckRefs : allRefs} cardMap={cardMap} />
          </div>
        </div>
      )}

      {/* Other players footer */}
      {roomState.players.length > 1 && (
        <div className="border-t border-line bg-surface px-4 py-2 flex flex-wrap gap-2 shrink-0">
          {roomState.players.map((player, i) => {
            const packs = roomState.sealedPacks?.[String(i)] ?? []
            const count = packs.flat().length
            return (
              <div key={player.id} className="flex items-center gap-1.5 text-xs bg-surface2 rounded-lg px-3 py-1.5">
                <span className={player.id === me.id ? 'text-accent font-medium' : 'text-ink2'}>{player.name}</span>
                <span className="text-faint">{count} cards</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
