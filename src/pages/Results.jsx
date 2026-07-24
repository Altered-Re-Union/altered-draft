import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getRoom } from '../lib/roomStore.js'
import { fetchSet, apiSetCode, fetchUniques, isUniqueRef, needsCardApi, uniqueRefsIn } from '../lib/cardData.js'
import { buildDecklist } from '../lib/exportFormat.js'
import { FACTIONS, FACTION_NAMES, FACTION_COLORS } from '../lib/cardData.js'
import { FACTION_ICONS } from '../lib/assets.js'
import ExportMenu from '../components/ExportMenu.jsx'
import ReunionButton from '../components/ReunionButton.jsx'
import ThemeToggle from '../components/ThemeToggle.jsx'
import DraftStats from '../components/DraftStats.jsx'
import PoolGrid from '../components/PoolGrid.jsx'
import DeckList from '../components/DeckList.jsx'
import { COMMUNITY_CUBES } from '../lib/cubes.js'

export default function Results() {
  const { code } = useParams()
  const navigate = useNavigate()

  const [roomState, setRoomState] = useState(null)
  const [me, setMe] = useState(null)
  const [cardMap, setCardMap] = useState({})
  const [tab, setTab] = useState('picks') // 'picks' | 'deck' | 'stats' | 'players'
  const [statsScope, setStatsScope] = useState('all') // 'all' | 'deck'
  const [deck, setDeck] = useState({})

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
        if (data.state.config.sets?.length) {
          const apiCodes = [...new Set(data.state.config.sets.map(apiSetCode))]
          const maps = {}
          await Promise.all(apiCodes.map(async s => {
            const cards = await fetchSet(s, data.state.config.lang || 'EN').catch(() => [])
            for (const c of cards) maps[c.reference] = c
          }))
          const cube = COMMUNITY_CUBES.find(c => c.id === data.state.config.cubeId)
          const cc = data.state.config.customCube
          // Include the free-hero pool so promo/unique heroes seeded into the pool resolve.
          const freeHeroPool = data.state.config.freeHeroPool ?? []
          const cubeRefs = [...(cube?.refs ?? (cc ? [...(cc.cards ?? []), ...(cc.heroes ?? [])] : [])), ...freeHeroPool]
          if (cubeRefs.length) {
            const uCards = await fetchUniques(cubeRefs.filter(needsCardApi), data.state.config.lang || 'EN')
            for (const c of uCards) maps[c.reference] = c
          }
          // Uniques injected into packs (the "add random uniques" option) land in picks —
          // scan the live state for any …_U_ refs not already loaded and fetch them.
          const liveUniques = uniqueRefsIn(data.state).filter(r => !maps[r])
          if (liveUniques.length) {
            const uCards = await fetchUniques(liveUniques, data.state.config.lang || 'EN')
            for (const c of uCards) maps[c.reference] = c
          }
          setCardMap(maps)
        }
      })
  }, [code, navigate])

  useEffect(() => {
    if (!me) return
    const stored = localStorage.getItem(`draft_deck_${code}_${me.id}`)
    if (stored) setDeck(JSON.parse(stored))
  }, [me, code])

  function saveDeck(next) {
    setDeck(next)
    if (me) localStorage.setItem(`draft_deck_${code}_${me.id}`, JSON.stringify(next))
  }

  if (!roomState || !me) {
    return <div className="min-h-screen flex items-center justify-center text-muted">Loading results…</div>
  }

  const myIndex = roomState.players.findIndex(p => p.id === me.id)
  // In-app hero-draft cubes seed each player's pool with the heroes they drafted
  // (heroes first), so they show up in the pool / deck / export like any other card.
  const myHeroPicks = roomState.heroPicks?.[String(myIndex)] ?? []
  // Free-hero mode: seed every player's pool with one copy of each available hero, so
  // they pick a hero from the pool like any other card (no separate hero picker UI).
  const freeHeroPool = roomState.config?.freeHero ? (roomState.config.freeHeroPool ?? []) : []
  const myPicks = [...myHeroPicks, ...freeHeroPool, ...(roomState.picks[String(myIndex)] ?? [])]

  const poolCounts = {}
  for (const ref of myPicks) poolCounts[ref] = (poolCounts[ref] ?? 0) + 1

  const deckTotal = Object.values(deck).reduce((a, b) => a + b, 0)
  const deckRefs = Object.entries(deck).flatMap(([ref, qty]) => Array(qty).fill(ref))
  // Hero counts toward both card total and faction limit
  const deckFactions = new Set(deckRefs.map(r => cardMap[r]?.faction).filter(Boolean))
  const deckHeroCount = deckRefs.filter(r => cardMap[r]?.cardType === 'HERO').length
  const isEnough = deckRefs.length >= 30
  const isValidFactions = deckFactions.size <= 3
  const isValidHero = deckHeroCount <= 1
  const isValid = isEnough && isValidFactions && isValidHero

  const allDecklist = buildDecklist(myPicks, cardMap)
  const deckDecklist = buildDecklist(deckRefs, cardMap)

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
        <span className="font-mono text-accent font-bold">{code}</span>
        <span className="text-muted text-sm">Draft Complete · {myPicks.length} picks</span>
        <div className="ml-auto flex gap-2 items-center">
          <ReunionButton />
          <ExportMenu poolRefs={myPicks} deckRefs={deckRefs}
            poolDecklist={allDecklist} deckDecklist={deckDecklist} name={code} format="Draft" />
          <a href="https://altered.re/pages/decks" target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 bg-surface2 hover:bg-surface3 text-sm rounded-lg text-ink2 transition-colors">
            altered.re ↗
          </a>
          <ThemeToggle />
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-surface border-b border-line flex shrink-0">
        {[
          { id: 'picks',   label: `Full Pool (${myPicks.length})` },
          { id: 'deck',    label: `Deck (${deckTotal})`, highlight: isValid },
          { id: 'stats',   label: 'Stats' },
          { id: 'players', label: 'Players' },
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

      {/* ALL PICKS — shared PoolGrid with filter/sort/hover/+- */}
      {tab === 'picks' && (
        <PoolGrid refs={myPicks} cardMap={cardMap} deck={deck} poolCounts={poolCounts}
          onAdd={addToDeck} onRemove={removeFromDeck} />
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
            ? <div className="flex-1 flex items-center justify-center text-faint text-sm">No cards in deck yet. Add them from the Full Pool tab.</div>
            : <div className="flex-1 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}><DeckList deck={deck} cardMap={cardMap} onRemove={removeFromDeck} onAdd={addToDeck} poolCounts={poolCounts} /></div>}
        </div>
      )}

      {/* STATS TAB */}
      {tab === 'stats' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {deckTotal > 0 && (
            <div className="flex border-b border-line shrink-0">
              {[['all', 'Full Pool'], ['deck', 'Deck']].map(([id, label]) => (
                <button key={id} onClick={() => setStatsScope(id)}
                  className={`flex-1 py-2 text-sm transition-colors ${statsScope === id ? 'text-accent border-b-2 border-accent2' : 'text-faint hover:text-ink2'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto">
            <DraftStats pickedRefs={statsScope === 'deck' && deckTotal > 0 ? deckRefs : myPicks} cardMap={cardMap} />
          </div>
        </div>
      )}

      {/* PLAYERS TAB */}
      {tab === 'players' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {roomState.players.map((player, i) => {
              const picks = [...(roomState.heroPicks?.[String(i)] ?? []), ...(roomState.picks[String(i)] ?? [])]
              const factionCounts = {}
              for (const ref of picks) {
                const card = cardMap[ref]
                if (!card || card.cardType === 'HERO') continue
                factionCounts[card.faction] = (factionCounts[card.faction] ?? 0) + 1
              }
              return (
                <div key={player.id} className="bg-surface rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-medium">{player.name}</span>
                    {player.id === me.id && <span className="text-xs text-accent">(you)</span>}
                    <span className="ml-auto text-xs text-faint">{picks.length} picks</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {FACTIONS.filter(f => factionCounts[f]).map(f => (
                      <span key={f} className={`text-xs px-2 py-0.5 rounded border inline-flex items-center gap-1 ${FACTION_COLORS[f]}`}>
                        {FACTION_ICONS[f] && <img src={FACTION_ICONS[f]} alt="" className="w-3 h-3 object-contain" />}
                        {FACTION_NAMES[f]} {factionCounts[f]}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
