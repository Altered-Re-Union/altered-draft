import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getRoom, updateRoom, subscribeToRoom } from '../lib/roomStore.js'
import { fetchSet, SETS, apiSetCode, fetchUniques, fetchRandomUniques, isUniqueRef, needsCardApi } from '../lib/cardData.js'
import { SET_ASSETS } from '../lib/assets.js'
import { COMMUNITY_CUBES, setsForCube, SPOTLIGHT } from '../lib/cubes.js'
import CubePreviewModal from '../components/CubePreviewModal.jsx'
import { generateAllPacks, generatePacksFromPool, generateChaosPacks, generateCubeRecipePacks, generateStructuredPacks, generateCubeDraftPacks, dealHeroSlots } from '../lib/packGenerator.js'
import { buildDraftState } from '../lib/draftLogic.js'
import { parseDecklist } from '../lib/cubeParser.js'
import { resolveCubeRefs } from '../lib/cubeResolve.js'
import { filterBanned } from '../lib/banlist.js'
import { listDecks, getDeck, deckCardsToRefs } from '../lib/decks.js'
import { useAuth } from '../auth/AuthProvider.jsx'
import { useLang } from '../lib/i18n/i18n.jsx'
import SetSelector from '../components/SetSelector.jsx'
import MultiSetSelector from '../components/MultiSetSelector.jsx'
import SettingsFields from '../components/SettingsFields.jsx'
import { DRAFT_FORMATS } from '../lib/draftFormats.js'
import TopNav from '../components/TopNav.jsx'

// Lobby wizard, step 1: how to play. Modes are the draft formats plus Sealed; player-count
// badges come from the format metadata. Booster Draft is the classic pick-and-pass format.
// Display name/blurb come from the i18n dict (lobby.modes.<id>) keyed by `id`, not from
// these English fallback fields — kept here only for id/players/available metadata.
const MODES = [
  ...DRAFT_FORMATS,
  { id: 'sealed', name: 'Sealed', players: '1+', available: true,
    blurb: 'Open your boosters and build a deck from your own pool. No passing; play at your own pace.' },
]
const MODE_BY_ID = Object.fromEntries(MODES.map(m => [m.id, m]))
// The two everyday modes show first; the alternate draft formats hide behind a toggle.
const PRIMARY_MODE_IDS = ['booster', 'sealed']
const OTHER_MODE_IDS = ['rochester', 'rotisserie', 'winston']

// Target pool size per mode, as boosters per player (~13 cards each). The mode sets how many
// cards a game wants; the card source then hits it — Presets generate it automatically, the
// Boosters source asks the host for that many, cubes generate up to it. Winston pools and
// splits 2 ways, so 6/player = 12 boosters total ≈ 72 cards each.
const BOOSTERS_PER_PLAYER = { booster: 4, rochester: 4, rotisserie: 4, winston: 6, sealed: 7 }
const boostersPerPlayer = m => BOOSTERS_PER_PLAYER[m] ?? 4

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Free-hero pool: one ref per distinct hero available in a set of loaded card objects
// (deduped by name+faction, unique heroes excluded). Cube paths pass their curated hero
// ref list instead. Used to seed every player's pool with a copy of each available hero.
function uniqueHeroRefs(cards) {
  const seen = new Set(), out = []
  for (const c of cards) {
    if (c.cardType !== 'HERO' || c.rarity === 'U') continue
    const key = `${c.name}__${c.faction}`
    if (seen.has(key)) continue
    seen.add(key); out.push(c.reference)
  }
  return out
}

// Resolve how heroes are handled for set/pool-based draft branches from the Heroes control:
//  'free'  → seed one of each into every pool (freeHeroPool); none drafted.
//  'draft' → snake-draft them in-app when there are at least as many as players; too few →
//            seed them instead (graceful fallback, same plumbing as 'free').
//  'packs' → heroes already live in the generated packs; nothing extra.
// (Cube branches that load heroes separately handle this inline.)
function resolveDraftHeroes(heroRefs, playerCount, heroMode) {
  const uniq = [...new Set(heroRefs)]
  if (heroMode === 'free') return { heroPool: null, freeHeroPool: uniq }
  if (heroMode === 'draft') {
    return uniq.length >= playerCount
      ? { heroPool: shuffle(uniq), freeHeroPool: [] }
      : { heroPool: null, freeHeroPool: uniq }
  }
  // 'split' (Winston only): hand the whole hero list to the engine, which deals each seat
  // its own half (one per faction). No global seeding, no in-app snake.
  if (heroMode === 'split') return { heroPool: shuffle(uniq), freeHeroPool: [] }
  return { heroPool: null, freeHeroPool: [] }
}

export default function Lobby() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const { t, tc } = useLang()

  const [roomState, setRoomState] = useState(null)
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(false)
  const [startError, setStartError] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  // Config. The lobby is a 3-step wizard: pick a MODE (how to play) → a card pool → settings.
  // `mode` unifies the old draft/sealed toggle + draft-format selector into one choice.
  const [mode, setMode] = useState('booster') // 'booster'|'rochester'|'rotisserie'|'winston'|'sealed'
  const [wizardStep, setWizardStep] = useState(1) // 1 = mode, 2 = cards, 3 = settings
  const [showOtherModes, setShowOtherModes] = useState(false) // expand alternate draft formats
  const isSealed = mode === 'sealed'
  const draftMode = isSealed ? 'sealed' : 'draft'      // derived, kept for the build logic below
  const draftFormat = isSealed ? 'booster' : mode      // sealed ignores format
  const bpp = boostersPerPlayer(mode)                  // target boosters per player for this mode
  const [configTab, setConfigTab] = useState('presets') // 'presets' | 'cubes' | 'advanced'
  const [selectedPreset, setSelectedPreset] = useState(null) // set code
  const [selectedCube, setSelectedCube] = useState(null) // cube id
  const [previewCube, setPreviewCube] = useState(null)  // cube being previewed
  // Pasted personal cube: parsed + resolved into { name, cards:[refs], heroes:[refs], unresolved:[refs] }.
  // Carried inline in room state as config.customCube (no cubeId, no storage).
  const [customCube, setCustomCube] = useState(null)
  const [customCubeText, setCustomCubeText] = useState('')
  const [customCubeName, setCustomCubeName] = useState('')
  const [parsingCube, setParsingCube] = useState(false)
  const [parseMsg, setParseMsg] = useState('')
  // Load-a-cube-from-Re:Union-decks (Cubes tab)
  const [myDecks, setMyDecks] = useState(null) // null = not loaded yet; [] = loaded, empty
  const [loadingDecks, setLoadingDecks] = useState(false)
  const [decksMsg, setDecksMsg] = useState('')
  const [deckSearch, setDeckSearch] = useState('')   // name filter for the deck picker
  const [deckFormat, setDeckFormat] = useState('all') // format filter ('all' | standard | sandbox | …)
  const [selectedDeckIds, setSelectedDeckIds] = useState([]) // decks ticked to merge into one cube
  const [selectedSets, setSelectedSets] = useState({}) // sealed Multi-Set: start empty (host picks)
  const [multiSetMix, setMultiSetMix] = useState({ CORE: 4 }) // per-player pack counts (sum = 4) for the Multi-Set draft tab
  const [equalPacks, setEqualPacks] = useState(true) // ON = same single-set boosters for all; OFF = random bag
  // Winston pools all packs into one shared deck, so "same packs for everyone" is meaningless —
  // force the whole-bag distribution and hide the toggle for it. (Declared after equalPacks.)
  const effectiveEqualPacks = mode === 'winston' ? false : equalPacks
  const [lang, setLang] = useState('EN')
  // One control for how players get their hero:
  //  'packs' → hero cards appear in boosters (draft/open them)
  //  'free'  → none in packs; pick any hero from the full roster at deckbuild (Results/Sealed)
  const [heroMode, setHeroMode] = useState('packs')
  const includeHeroes = heroMode === 'packs'
  const freeHero = heroMode === 'free'
  const [timerEnabled, setTimerEnabled] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(60)
  const [showCustomPool, setShowCustomPool] = useState(false)
  const [customPoolText, setCustomPoolText] = useState('')
  const [addUniques, setAddUniques] = useState(false)
  const [excludeBanlist, setExcludeBanlist] = useState(false) // sealed only: drop Equinox-suspended cards from the pool
  const [heroCount, setHeroCount] = useState(3)   // heroes per player when Heroes = Draft
  const [heroPoolSize, setHeroPoolSize] = useState(0) // # of distinct heroes available (for the max)

  // Keep the card-source tab and hero choice valid when the mode changes. (Multi-Set is
  // draft-only; Advanced is the sealed equivalent. 'draft'/'split' heroes need a pick phase;
  // 'split' is Winston-only.)
  useEffect(() => {
    if (isSealed && configTab === 'multiset') setConfigTab('advanced')
    if (!isSealed && configTab === 'advanced') setConfigTab('multiset')
    if (isSealed && (heroMode === 'draft' || heroMode === 'split')) setHeroMode('packs')
    if (!isSealed && mode !== 'winston' && heroMode === 'split') setHeroMode('packs')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const joinUrl = `${window.location.origin}/?join=${code}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(joinUrl)}&bgcolor=111827&color=f59e0b`

  useEffect(() => {
    const stored = localStorage.getItem(`player_${code}`)
    if (!stored) { navigate('/'); return }
    setMe(JSON.parse(stored))
  }, [code, navigate])

  useEffect(() => {
    getRoom(code)
      .then(({ data, error }) => {
        if (error || !data) { navigate('/'); return }
        setRoomState(data.state)
        if (['drafting', 'heroDraft', 'rochester', 'rotisserie', 'winston'].includes(data.state.phase)) navigate(`/room/${code}/draft`)
        else if (data.state.phase === 'sealed') navigate(`/room/${code}/sealed`)
        else if (data.state.phase === 'done') navigate(`/room/${code}/results`)
      })
  }, [code, navigate])

  useEffect(() => {
    return subscribeToRoom(code, state => {
      setRoomState(state)
      if (['drafting', 'heroDraft', 'rochester', 'rotisserie', 'winston'].includes(state.phase)) navigate(`/room/${code}/draft`)
      else if (state.phase === 'sealed') navigate(`/room/${code}/sealed`)
    })
  }, [code, navigate])

  async function copyLink() {
    await navigator.clipboard.writeText(joinUrl).catch(() => {})
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  // Resolve which sets/packs to use based on active config tab
  function resolveConfig(playerCount) {
    if (configTab === 'presets') {
      if (!selectedPreset) return null
      // 4 packs of the selected set per player
      return { [selectedPreset]: playerCount }
    }
    return selectedSets
  }

  // Parse a pasted decklist and resolve it against card data: split heroes out
  // (cardType HERO), flag refs that don't resolve, keep duplicate copies. Uniques
  // resolve from the bundled snapshot only.
  async function handleParseCube() {
    setParseMsg('')
    const { refs } = parseDecklist(customCubeText)
    if (!refs.length) {
      setParseMsg(t('lobby.noRefsFound'))
      return
    }
    setParsingCube(true)
    try {
      // resolveCubeRefs canonicalizes alt-art/promo printings, fetches sets + uniques,
      // and splits heroes — shared with the load-from-Re:Union-decks flow below.
      const { cards, heroes, unresolved } = await resolveCubeRefs(refs, lang)
      if (!cards.length) {
        setParseMsg(t('lobby.noDraftableResolved'))
        setParsingCube(false); return
      }
      setCustomCube({ name: customCubeName.trim() || t('lobby.customPool'), cards, heroes, unresolved, source: 'paste' })
      setSelectedCube(null) // custom + built-in cubes are mutually exclusive
    } catch (e) {
      setParseMsg(t('lobby.couldNotLoadCardData', { msg: e.message }))
    }
    setParsingCube(false)
  }

  // Load the signed-in user's Re:Union decks (Cubes tab).
  async function handleLoadDecks() {
    setDecksMsg(''); setLoadingDecks(true)
    try {
      const decks = await listDecks()
      setMyDecks(decks)
      if (!decks.length) setDecksMsg(t('lobby.noDecksFound'))
    } catch (e) { setDecksMsg(e.message) }
    setLoadingDecks(false)
  }

  const deckKey = d => d.id ?? d.uuid ?? d.name
  function toggleDeck(id) {
    setSelectedDeckIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id])
  }

  // Merge the chosen Re:Union deck(s) into ONE custom cube (same shape as a pasted
  // cube). Combining several decks stacks copies into a bigger multiset pool — useful
  // since a single ~40-card deck is too small to draft with a full table.
  async function handleLoadSelectedDecks() {
    const chosen = (myDecks ?? []).filter(d => selectedDeckIds.includes(deckKey(d)))
    if (!chosen.length) return
    setDecksMsg(''); setLoadingDecks(true)
    try {
      const lists = await Promise.all(chosen.map(d => getDeck(d.id ?? d.uuid).then(deckCardsToRefs)))
      const allRefs = lists.flat()
      if (!allRefs.length) { setDecksMsg(t('lobby.decksHaveNoCards')); setLoadingDecks(false); return }
      const { cards, heroes, unresolved } = await resolveCubeRefs(allRefs, lang)
      if (!cards.length) { setDecksMsg(t('lobby.noDraftableFromDecks')); setLoadingDecks(false); return }
      const name = chosen.length === 1
        ? (chosen[0].name || t('lobby.reunionDeckFallback'))
        : `${chosen.length} decks (${chosen.map(d => d.name || t('lobby.untitled')).slice(0, 3).join(', ')}${chosen.length > 3 ? '…' : ''})`
      setCustomCube({ name, cards, heroes, unresolved, source: 'reunion' })
      setSelectedCube(null) // custom + built-in cubes are mutually exclusive
    } catch (e) { setDecksMsg(e.message) }
    setLoadingDecks(false)
  }

  // "Add random uniques" mode: ~1 in 6 boosters gets a real unique in its last slot.
  const UNIQUE_RATE = 1 / 6
  // The live random-unique fetch (`random=1` over millions of rows) is ~1.5s, so we PREFETCH
  // it the moment the toggle is on and the settings modal is open — by the time the host
  // clicks Start it's already done (or in flight, so Start just awaits the same promise
  // instead of starting a fresh request). Cached by set-codes + language.
  const uniquePoolsRef = useRef({ key: null, promise: null })
  async function fetchUniquePools(setCodes) {
    // Fetch a generous random sample per set: the query costs ~the same at any size, and a
    // bigger sample means more variety (and headroom well beyond the ≤7 uniques a pool needs).
    const entries = await Promise.all(setCodes.map(async s => [s, await fetchRandomUniques(s, 200, lang)]))
    return Object.fromEntries(entries)
  }
  // Returns the prefetched pool when the set selection hasn't changed; otherwise kicks off
  // (and memoizes) a fresh fetch. Always resolves to a { setCode: uniques[] } map.
  function getUniquePools(setCodes) {
    const key = [...setCodes].sort().join(',') + '|' + lang
    if (uniquePoolsRef.current.key !== key || !uniquePoolsRef.current.promise) {
      uniquePoolsRef.current = { key, promise: fetchUniquePools(setCodes) }
    }
    return uniquePoolsRef.current.promise
  }
  // The set codes the current tab will draft from — used to prefetch the unique pool.
  // Returns [] for cubes (they manage their own uniques) so no prefetch fires.
  function activeUniqueSetCodes() {
    if (configTab === 'cubes') return []
    if (draftMode === 'draft' && customPoolText.trim()) {
      return [...new Set(customPoolText.trim().split(/\s+/).filter(r => r.startsWith('ALT_')).map(r => r.split('_')[1]).filter(Boolean))]
    }
    if (configTab === 'multiset') return Object.keys(multiSetMix).filter(s => multiSetMix[s] > 0)
    if (configTab === 'advanced') return Object.keys(selectedSets).filter(s => selectedSets[s] > 0)
    if (configTab === 'presets') return selectedPreset ? [selectedPreset] : []
    return []
  }

  // Warm the unique pool once the host reaches the settings step (so Start stays snappy).
  useEffect(() => {
    if (wizardStep !== 3 || !addUniques) return
    const codes = activeUniqueSetCodes()
    if (codes.length) getUniquePools(codes) // fire-and-forget; result memoized in the ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardStep, addUniques, configTab, draftMode, selectedPreset, selectedSets, multiSetMix, customPoolText, lang])

  // How many distinct heroes the current pool offers — bounds the "heroes per player" max
  // when Heroes = Draft. Cube hero lists are known immediately; sets need their data.
  async function loadHeroPoolSize() {
    if (customCube) return new Set(customCube.heroes ?? []).size
    if (configTab === 'cubes' && selectedCube) {
      const cube = COMMUNITY_CUBES.find(c => c.id === selectedCube)
      if (cube?.heroes?.length) return new Set(cube.heroes).size
      if (cube) {
        const codes = [...new Set(setsForCube(cube.refs))]
        const cards = (await Promise.all(codes.map(s => fetchSet(s, lang).catch(() => [])))).flat()
        const refSet = new Set(cube.refs)
        return uniqueHeroRefs(cards.filter(c => refSet.has(c.reference))).length
      }
      return 0
    }
    const codes = activeUniqueSetCodes()
    if (!codes.length) return 0
    const cards = (await Promise.all(codes.map(s => fetchSet(s, lang).catch(() => [])))).flat()
    return uniqueHeroRefs(cards).length
  }
  useEffect(() => {
    if (heroMode !== 'draft') return
    let cancelled = false
    loadHeroPoolSize().then(n => { if (!cancelled) setHeroPoolSize(n) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroMode, configTab, selectedCube, customCube, selectedPreset, selectedSets, multiSetMix, customPoolText, lang])
  // Clamp the chosen count down if the (now-known) pool can't support it.
  const maxHeroes = Math.max(1, Math.floor(heroPoolSize / (roomState?.players.length || 1)))
  useEffect(() => {
    if (heroPoolSize > 0 && heroCount > maxHeroes) setHeroCount(maxHeroes)
  }, [heroPoolSize, maxHeroes, heroCount])

  const handleStart = async () => {
    if (!roomState) return
    if (draftMode === 'draft' && roomState.players.length < 2) { setStartError(t('lobby.errNeed2Players')); return }
    if (draftMode === 'draft' && draftFormat === 'winston' && roomState.players.length !== 2) {
      setStartError(t('lobby.errWinston2Players')); return
    }
    setLoading(true)
    setStartError('')

    try {
      const shuffledPlayers = shuffle(roomState.players)
      const playerCount = shuffledPlayers.length
      const SEALED_PACKS = 7
      // When free-hero is on, no heroes go into packs/boosters (players free-pick later).
      const packHeroes = includeHeroes && !freeHero

      // Sealed mode — each player gets a set of boosters (array of arrays)
      if (draftMode === 'sealed') {
        const SEALED_PACKS = 7

        // Pasted personal cube — sealed. Heroes STAY in the pool (sealed has no draft
        // phase) unless free-hero is on, in which case they're picked at deckbuild time.
        if (configTab === 'cubes' && customCube) {
          // Free-hero: heroes leave the booster pool and are instead seeded (one of each)
          // into every player's pool. Pool cards = non-hero cards in that case.
          const freeHeroPool = freeHero ? [...new Set(customCube.heroes)] : []
          const poolRefs = [...customCube.cards, ...(freeHero ? [] : customCube.heroes)]
          // Always load hero sets/data so the free-hero copies render in the pool.
          const dataRefs = [...customCube.cards, ...customCube.heroes]
          const rawCodes = [...new Set(setsForCube(dataRefs))]
          const results = await Promise.all(rawCodes.map(s => fetchSet(s, lang).catch(() => [])))
          const apiCodes = [...new Set(rawCodes.map(apiSetCode))]
          const byRef = new Map(results.flat().map(c => [c.reference, c]))
          const uniqueCards = await fetchUniques(dataRefs.filter(isUniqueRef), lang)
          for (const c of uniqueCards) byRef.set(c.reference, c)
          let pool = poolRefs.map(r => byRef.get(r)).filter(Boolean)
          if (excludeBanlist) pool = filterBanned(pool)
          if (pool.length < SEALED_PACKS) {
            setStartError(t('lobby.errCubeTooSmallSealed', { n: SEALED_PACKS })); setLoading(false); return
          }
          const sealedPacks = {}
          for (let i = 0; i < playerCount; i++) sealedPacks[String(i)] = generateCubeDraftPacks(pool, SEALED_PACKS)
          const state = {
            config: { sets: apiCodes, playerCount, lang, freeHero, includeHeroes, freeHeroPool, excludeBanlist, mode: 'sealed', customCube: { name: customCube.name, cards: customCube.cards, heroes: customCube.heroes } },
            players: shuffledPlayers, phase: 'sealed', sealedPacks, version: 0,
          }
          const { error: upErr } = await updateRoom(code, state)
          if (upErr) { setStartError(t('lobby.errCouldNotStart', { msg: upErr.message })); setLoading(false); return }
          return
        }

        // Cube sealed — curated pool; boosters drawn from the whole cube
        if (configTab === 'cubes' && selectedCube) {
          const cube = COMMUNITY_CUBES.find(c => c.id === selectedCube)
          if (!cube) { setStartError(t('lobby.errCubeNotFound')); setLoading(false); return }
          // Include hero refs so their sets load (they fill each booster's slot 0 below).
          const rawCodes = [...new Set(setsForCube([...cube.refs, ...(cube.heroes ?? [])]))]
          const results = await Promise.all(rawCodes.map(s => fetchSet(s, lang).catch(() => [])))
          const apiCodes = [...new Set(rawCodes.map(apiSetCode))]
          const byRef = new Map(results.flat().map(c => [c.reference, c]))
          // Refs fetchSet doesn't stock (uniques + promo/alt-art prints like
          // "Sofia, First Outpost") are fetched from the cards API by reference — heroes
          // included so promo heroes resolve for the free-hero pool.
          const extraCards = await fetchUniques([...cube.refs, ...(cube.heroes ?? [])].filter(needsCardApi), lang)
          for (const c of extraCards) byRef.set(c.reference, c)
          let allCards = cube.refs.map(r => byRef.get(r)).filter(Boolean)
          if (excludeBanlist) allCards = filterBanned(allCards)
          if (!allCards.length) { setStartError(t('lobby.errCouldNotLoadCube')); setLoading(false); return }
          // Hero-draft cubes keep heroes in a separate pool (not in refs). Sealed has no
          // hero-draft phase, so deal one hero into each booster's first slot instead —
          // unless free-hero, where every player's pool is seeded with one of each hero.
          const cubeHeroRefs = [...new Set(cube.heroes ?? [])].filter(r => byRef.has(r))
          const heroRefs = (cube.heroDraft && !freeHero) ? cubeHeroRefs : []
          const freeHeroPool = freeHero ? cubeHeroRefs : []
          const sealedPacks = {}
          for (let i = 0; i < playerCount; i++) {
            sealedPacks[String(i)] = dealHeroSlots(
              cube.booster
                ? generateCubeRecipePacks(allCards, SEALED_PACKS, cube.booster)
                : generateAllPacks(allCards, 1, SEALED_PACKS, { includeHeroes: packHeroes }),
              heroRefs)
          }
          const state = {
            config: { sets: apiCodes, playerCount, lang, freeHero, includeHeroes, freeHeroPool, excludeBanlist, cubeId: cube.id, mode: 'sealed' },
            players: shuffledPlayers, phase: 'sealed', sealedPacks, version: 0,
          }
          {
            const { error: upErr } = await updateRoom(code, state)
            if (upErr) { setStartError(t('lobby.errCouldNotStart', { msg: upErr.message })); setLoading(false); return }
          }
          return
        }

        // Presets / advanced — single-set boosters (a booster never mixes sets).
        // Preset = 7 boosters of the one set; advanced = per-set booster counts.
        const mix = configTab === 'presets' && selectedPreset
          ? { [selectedPreset]: SEALED_PACKS }
          : Object.fromEntries(Object.entries(selectedSets).filter(([, n]) => n > 0))
        const setCodes = Object.keys(mix)
        if (!setCodes.length) { setStartError(t('lobby.errSelectSet')); setLoading(false); return }
        const fetched = await Promise.all(setCodes.map(async s => [s, await fetchSet(s, lang).catch(() => [])]))
        const cardsBySet = Object.fromEntries(
          excludeBanlist ? fetched.map(([s, c]) => [s, filterBanned(c)]) : fetched
        )
        if (!Object.values(cardsBySet).some(c => c.length)) { setStartError(t('lobby.errNoCardsLoaded')); setLoading(false); return }
        const apiCodes = [...new Set(setCodes.map(apiSetCode))]
        const freeHeroPool = freeHero ? uniqueHeroRefs(Object.values(cardsBySet).flat()) : []
        const rawUniquesBySet = addUniques ? await getUniquePools(setCodes) : {}
        const uniquesBySet = excludeBanlist
          ? Object.fromEntries(Object.entries(rawUniquesBySet).map(([s, c]) => [s, filterBanned(c)]))
          : rawUniquesBySet
        const sealedPacks = {}
        for (let i = 0; i < playerCount; i++) {
          sealedPacks[String(i)] = generateChaosPacks(cardsBySet, mix, { includeHeroes: packHeroes, uniquesBySet, randomUniqueRate: addUniques ? UNIQUE_RATE : 0 })
        }
        const state = {
          config: { sets: apiCodes, playerCount, lang, freeHero, includeHeroes, freeHeroPool, addUniques, excludeBanlist, mode: 'sealed', packMix: mix },
          players: shuffledPlayers, phase: 'sealed', sealedPacks, version: 0,
        }
        {
          const { error: upErr } = await updateRoom(code, state)
          if (upErr) { setStartError(t('lobby.errCouldNotStart', { msg: upErr.message })); setLoading(false); return }
        }
        return
      }

      // Pasted personal cube — draft. Keeps duplicate copies (multiset, equal packs).
      // Heroes are drafted in-app via the shared-pool snake when there are at least as
      // many as players; otherwise they fold into the card packs so none are lost.
      if (configTab === 'cubes' && customCube) {
        const allRefs = [...customCube.cards, ...customCube.heroes]
        const rawCodes = [...new Set(setsForCube(allRefs))]
        const results = await Promise.all(rawCodes.map(s => fetchSet(s, lang).catch(() => [])))
        const apiCodes = [...new Set(rawCodes.map(apiSetCode))]
        const byRef = new Map(results.flat().map(c => [c.reference, c]))
        const uniqueCards = await fetchUniques(allRefs.filter(isUniqueRef), lang)
        for (const c of uniqueCards) byRef.set(c.reference, c)

        const heroUnique = [...new Set(customCube.heroes)]
        // Heroes control: 'draft' → snake-draft when there are enough; 'split' (Winston) →
        // engine deals each seat its own heroes; 'free' (or 'draft' with too few) → seed one
        // of each into every pool; 'packs' → fold into card packs.
        const useHeroDraft = heroMode === 'draft' && heroUnique.length >= playerCount
        const useSplit = heroMode === 'split' && draftFormat === 'winston' && heroUnique.length > 0
        const seedHeroes = freeHero || (heroMode === 'draft' && !useHeroDraft)
        const cardRefs = (useHeroDraft || useSplit || seedHeroes) ? customCube.cards : [...customCube.cards, ...customCube.heroes]
        const cardPool = cardRefs.map(r => byRef.get(r)).filter(Boolean)
        const totalPacks = playerCount * bpp
        if (cardPool.length < totalPacks) {
          setStartError(t('lobby.errCubeTooSmallPlayers', { players: playerCount, needed: totalPacks, have: cardPool.length }))
          setLoading(false); return
        }
        const packs = generateCubeDraftPacks(cardPool, totalPacks)
        const heroPool = (useHeroDraft || useSplit) ? shuffle(heroUnique) : null
        const freeHeroPool = seedHeroes ? heroUnique : []
        const state = buildDraftState(
          { sets: apiCodes, playerCount, lang, freeHero, includeHeroes: false, freeHeroPool, heroMode, heroCount, draftFormat, timerEnabled, timerSeconds, customCube: { name: customCube.name, cards: customCube.cards, heroes: customCube.heroes } },
          shuffledPlayers, packs, heroPool
        )
        const { error: upErr } = await updateRoom(code, state)
        if (upErr) { setStartError(t('lobby.errCouldNotStart', { msg: upErr.message })); setLoading(false); return }
        return
      }

      // Cube mode — fetch card data and apply booster rules
      if (configTab === 'cubes' && selectedCube) {
        const cube = COMMUNITY_CUBES.find(c => c.id === selectedCube)
        if (!cube) { setStartError(t('lobby.errCubeNotFound')); setLoading(false); return }
        const maxPlayers = cube.maxPlayers ?? 4
        if (cube.heroDraft && (playerCount < 2 || playerCount > maxPlayers)) {
          setStartError(t('lobby.errCubeSupportsPlayers', { n: maxPlayers })); setLoading(false); return
        }
        // Include the hero refs so their sets load too (heroes are drafted in-app).
        const setCodes = [...new Set(setsForCube([...cube.refs, ...(cube.heroes ?? [])]))]
        const results = await Promise.all(setCodes.map(s => fetchSet(s, lang).catch(() => [])))
        const apiCodes = [...new Set(setCodes.map(apiSetCode))]
        let packs
        // Free-hero pool: heroDraft cubes use their curated hero list; other cubes use
        // the HERO cards within the pool. Seeded (one of each) into every player's pool.
        let freeHeroPool = []
        let cubeHeroPool = null // snake-draft pool for non-heroDraft cubes when heroMode='draft'
        if (cube.heroDraft) {
          // Multi-copy cube: preserve duplicate refs (mapping each to its card object),
          // deal equal packs. Heroes are not in these packs — they're drafted in-app
          // from the shared hero pool (see heroPool below).
          const byRef = new Map(results.flat().map(c => [c.reference, c]))
          // Uniques + promo/alt-art prints aren't in set data — fetch them and merge
          // (heroes included so promo heroes resolve for the free-hero pool).
          const uniqueCards = await fetchUniques([...cube.refs, ...(cube.heroes ?? [])].filter(needsCardApi), lang)
          for (const c of uniqueCards) byRef.set(c.reference, c)
          const allCards = cube.refs.map(r => byRef.get(r)).filter(Boolean)
          if (!allCards.length) { setStartError(t('lobby.errCouldNotLoadCube')); setLoading(false); return }
          // Winston/Rotisserie flatten every booster into ONE shared pool, so the per-booster
          // recipe (which recycles cards across boosters to hit its 3C/8R/1U quota) would inject
          // duplicates. For those formats deal the cube's multiset without recycling instead.
          const flattenPool = draftFormat === 'winston' || draftFormat === 'rotisserie'
          packs = flattenPool
            ? generateCubeDraftPacks(allCards, playerCount * bpp)
            : cube.booster
              ? generateCubeRecipePacks(allCards, playerCount * bpp, cube.booster)
              : generateAllPacks(allCards, playerCount, bpp, { includeHeroes: false, cubeMode: true })
          if (freeHero) freeHeroPool = [...new Set(cube.heroes ?? [])].filter(r => byRef.has(r))
        } else {
          const cubeRefSet = new Set(cube.refs)
          const allCards = results.flat().filter(c => cubeRefSet.has(c.reference))
          if (!allCards.length) { setStartError(t('lobby.errCouldNotLoadCube')); setLoading(false); return }
          packs = generateAllPacks(allCards, playerCount, bpp, { includeHeroes: packHeroes, cubeMode: true })
          // 'free'/'draft' on a non-heroDraft cube use the HERO cards within the pool.
          const hh = resolveDraftHeroes(uniqueHeroRefs(allCards), playerCount, heroMode)
          freeHeroPool = hh.freeHeroPool
          cubeHeroPool = hh.heroPool
        }
        // Hero-draft cubes draft heroes in-app from one shared pool (all the cube's heroes),
        // snake-drafted one-per-player after each card round until each has min(3, …) heroes —
        // unless 'free' (seeded). Non-heroDraft cubes draft only when heroMode='draft'.
        const heroPool = cube.heroDraft
          ? ((heroMode !== 'free' && cube.heroes?.length) ? shuffle(cube.heroes) : null)
          : cubeHeroPool
        const state = buildDraftState(
          { sets: apiCodes, playerCount, lang, freeHero, cubeId: cube.id, includeHeroes, freeHeroPool, heroMode, heroCount, draftFormat, timerEnabled, timerSeconds },
          shuffledPlayers, packs, heroPool
        )
        {
          const { error: upErr } = await updateRoom(code, state)
          if (upErr) { setStartError(t('lobby.errCouldNotStart', { msg: upErr.message })); setLoading(false); return }
        }
        return
      }

      // Custom pool mode — same booster rules
      if (customPoolText.trim()) {
        const refs = customPoolText.trim().split(/\s+/).filter(r => r.startsWith('ALT_'))
        if (!refs.length) { setStartError(t('lobby.errNoValidRefs')); setLoading(false); return }
        const rawCodes = [...new Set(refs.map(r => r.split('_')[1]).filter(Boolean))]
        const results = await Promise.all(rawCodes.map(s => fetchSet(s, lang).catch(() => [])))
        const refSet = new Set(refs)
        const allCards = results.flat().filter(c => refSet.has(c.reference))
        const uniquePool = addUniques ? Object.values(await getUniquePools(rawCodes)).flat() : []
        const packs = allCards.length
          ? generateAllPacks(allCards, playerCount, bpp, { includeHeroes: packHeroes, uniquePool, randomUniqueRate: addUniques ? UNIQUE_RATE : 0 })
          : generatePacksFromPool(refs, playerCount, bpp) // fallback if fetch fails
        const apiCodes = [...new Set(rawCodes.map(apiSetCode))]
        const { heroPool, freeHeroPool } = resolveDraftHeroes(uniqueHeroRefs(allCards), playerCount, heroMode)
        const state = buildDraftState(
          { sets: apiCodes, playerCount, lang, freeHero, customPool: true, includeHeroes, freeHeroPool, addUniques, heroMode, heroCount, draftFormat, timerEnabled, timerSeconds },
          shuffledPlayers, packs, heroPool
        )
        {
          const { error: upErr } = await updateRoom(code, state)
          if (upErr) { setStartError(t('lobby.errCouldNotStart', { msg: upErr.message })); setLoading(false); return }
        }
        return
      }

      // Multi-Set draft — single-set boosters. The "same packs" toggle picks the
      // distribution: ON  = per-player counts (sum 4); every player drafts the same
      // single-set boosters (one set per round). OFF = the WHOLE bag (sum players × 4),
      // shuffled and dealt at random.
      if (configTab === 'multiset') {
        const mix = Object.fromEntries(Object.entries(multiSetMix).filter(([, n]) => n > 0))
        const setCodes = Object.keys(mix)
        if (!setCodes.length) { setStartError(t('lobby.errSelectAtLeastOneSet')); setLoading(false); return }
        const total = Object.values(mix).reduce((a, b) => a + b, 0)
        const target = effectiveEqualPacks ? bpp : playerCount * bpp
        if (total !== target) {
          setStartError(effectiveEqualPacks
            ? t('lobby.errPacksPerPlayer', { bpp, total })
            : t('lobby.errBagNeedsExactly', { target, players: playerCount, bpp, total }))
          setLoading(false); return
        }
        const fetched = await Promise.all(setCodes.map(async s => [s, await fetchSet(s, lang).catch(() => [])]))
        const cardsBySet = Object.fromEntries(fetched)
        if (!Object.values(cardsBySet).some(c => c.length)) { setStartError(t('lobby.errNoCardsLoadedCheck')); setLoading(false); return }
        const uniquesBySet = addUniques ? await getUniquePools(setCodes) : {}
        const uniqueOpts = { uniquesBySet, randomUniqueRate: addUniques ? UNIQUE_RATE : 0 }
        const packs = effectiveEqualPacks
          ? generateStructuredPacks(cardsBySet, mix, playerCount, { includeHeroes: packHeroes, ...uniqueOpts })
          : generateChaosPacks(cardsBySet, mix, { includeHeroes: packHeroes, ...uniqueOpts })
        const apiCodes = [...new Set(setCodes.map(apiSetCode))]
        const { heroPool, freeHeroPool } = resolveDraftHeroes(uniqueHeroRefs(Object.values(cardsBySet).flat()), playerCount, heroMode)
        const state = buildDraftState(
          { sets: apiCodes, playerCount, lang, freeHero, includeHeroes, freeHeroPool, addUniques, heroMode, heroCount, draftFormat, timerEnabled, timerSeconds, multiSetMix: mix, equalPacks: effectiveEqualPacks },
          shuffledPlayers, packs, heroPool
        )
        {
          const { error: upErr } = await updateRoom(code, state)
          if (upErr) { setStartError(t('lobby.errCouldNotStart', { msg: upErr.message })); setLoading(false); return }
        }
        return
      }

      // Preset draft — 4 packs of the one selected set per player
      const setsToUse = resolveConfig(playerCount)
      if (!setsToUse || !Object.keys(setsToUse).filter(k => setsToUse[k] > 0).length) {
        setStartError(t('lobby.errSelectSetToDraft'))
        setLoading(false)
        return
      }

      const setCodes = Object.keys(setsToUse).filter(k => setsToUse[k] > 0)
      const results = await Promise.all(setCodes.map(s => fetchSet(s, lang)))
      const allCards = results.flat()
      if (!allCards.length) { setStartError(t('lobby.errNoCardsLoadedCheck')); setLoading(false); return }

      const uniquePool = addUniques ? Object.values(await getUniquePools(setCodes)).flat() : []
      const packs = generateAllPacks(allCards, playerCount, bpp, { includeHeroes: packHeroes, uniquePool, randomUniqueRate: addUniques ? UNIQUE_RATE : 0 })
      const { heroPool, freeHeroPool } = resolveDraftHeroes(uniqueHeroRefs(allCards), playerCount, heroMode)
      const state = buildDraftState(
        { sets: setCodes, playerCount, lang, freeHero, includeHeroes, freeHeroPool, addUniques, heroMode, heroCount, draftFormat, timerEnabled, timerSeconds },
        shuffledPlayers, packs, heroPool
      )
      const { error: upErr } = await updateRoom(code, state)
      if (upErr) { setStartError(t('lobby.errCouldNotStart', { msg: upErr.message })); setLoading(false); return }
    } catch (err) {
      setStartError(t('lobby.errStartingDraft', { msg: err.message }))
      setLoading(false)
    }
  }

  if (!roomState || !me) {
    return <div className="min-h-screen flex items-center justify-center text-muted">{t('lobby.loadingRoom')}</div>
  }

  const isHost = me.isHost

  // Step 2 → 3 gate: a usable card pool is selected for the current source tab. A pasted
  // custom pool (handleStart checks it first) counts on its own.
  const poolTarget = effectiveEqualPacks ? bpp : roomState.players.length * bpp
  const poolReady = !!customPoolText.trim()
    || (configTab === 'presets' && !!selectedPreset)
    || (configTab === 'cubes' && (!!selectedCube || !!customCube))
    || (configTab === 'advanced' && Object.values(selectedSets).some(n => n > 0))
    || (configTab === 'multiset' && Object.values(multiSetMix).reduce((a, b) => a + (b || 0), 0) === poolTarget)

  // Short recap of the chosen card source, shown in the wizard header so the host can see
  // their earlier picks while on a later step.
  const cardSummary =
    (draftMode === 'draft' && customPoolText.trim()) ? t('lobby.customPool')
    : configTab === 'cubes' ? (customCube?.name ?? COMMUNITY_CUBES.find(c => c.id === selectedCube)?.name ?? null)
    : configTab === 'presets' ? (SETS.find(s => s.code === selectedPreset)?.name ?? null)
    : (configTab === 'multiset' || configTab === 'advanced') ? t('lobby.tabMultiSet')
    : null

  // Wizard step labels + tab labels — computed here (not module-level) since they need t().
  const wizardStepLabels = [t('lobby.stepHowToPlay'), t('lobby.stepCards'), t('lobby.stepSettings')]
  const tabLabels = { presets: t('lobby.tabPresets'), cubes: t('lobby.tabCubes'), advanced: t('lobby.tabMultiSet'), multiset: t('lobby.tabMultiSet') }

  // Describes a loaded cube's card/hero/unresolved counts as ready-to-render label
  // fragments (see the paste + Re:Union confirmation blocks below).
  function describeLoadedCube(cube) {
    return {
      cards: tc('lobby.cardCount', cube.cards.length),
      heroesPart: cube.heroes.length > 0 ? tc('lobby.heroesPart', cube.heroes.length) : '',
      heroDraftPart: cube.heroes.length > 0
        ? (new Set(cube.heroes).size >= roomState.players.length ? t('lobby.heroesDraftedInApp') : t('lobby.tooFewHeroesFallback'))
        : '',
      unresolvedPart: cube.unresolved.length > 0 ? t('lobby.unresolvedPart', { n: cube.unresolved.length }) : '',
    }
  }
  const loadedDesc = customCube ? describeLoadedCube(customCube) : null

  // Keep the alternate formats expanded if one of them is the current pick.
  const otherModesExpanded = showOtherModes || OTHER_MODE_IDS.includes(mode)
  const modeButton = m => {
    const active = mode === m.id
    const needs2 = m.players === '2' && roomState.players.length !== 2
    return (
      <button key={m.id} type="button" onClick={() => setMode(m.id)}
        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
          active ? 'border-accent bg-accent/5' : 'border-line bg-surface2 hover:bg-surface3'}`}>
        <div className="flex items-center gap-2">
          <span className={`w-4 h-4 rounded-full border shrink-0 flex items-center justify-center ${active ? 'border-accent' : 'border-faint'}`}>
            {active && <span className="w-2 h-2 rounded-full bg-accent" />}
          </span>
          <span className={`text-sm font-semibold ${active ? 'text-ink' : 'text-ink2'}`}>{t(`lobby.modes.${m.id}.name`)}</span>
          <span className="text-[10px] uppercase tracking-wide text-faint border border-line rounded px-1 py-0.5">{t('lobby.playersSuffix', { n: m.players })}</span>
          {active && needs2 && <span className="ml-auto text-[10px] uppercase tracking-wide text-accent2">{t('lobby.needsExactly2')}</span>}
        </div>
        <p className="text-xs text-faint mt-1.5 leading-relaxed pl-6">{t(`lobby.modes.${m.id}.blurb`)}</p>
      </button>
    )
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="flex-1 w-full flex flex-col items-center px-4 py-8">
      <div className="max-w-2xl w-full space-y-6">

        {/* Room code + share */}
        <div className="bg-surface rounded-xl p-6">
          <div className="flex gap-6 items-center">
            <div className="flex-1">
              <p className="text-xs text-faint uppercase tracking-widest mb-1">{t('lobby.roomCode')}</p>
              <p className="text-4xl sm:text-5xl font-mono font-bold tracking-widest text-accent">{code}</p>
              <p className="text-sm text-faint mt-2">{t('lobby.shareCode')}</p>
              <div className="flex gap-2 mt-3">
                <input readOnly value={joinUrl}
                  className="flex-1 bg-surface2 border border-line rounded-lg px-3 py-1.5 text-xs text-muted font-mono min-w-0" />
                <button onClick={copyLink}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                    linkCopied ? 'bg-green-600 text-white' : 'bg-surface3 hover:bg-surface3 text-ink2'}`}>
                  {linkCopied ? t('lobby.copied') : t('lobby.copy')}
                </button>
              </div>
            </div>
            <img src={qrUrl} alt={t('lobby.qrCodeAlt')} className="hidden sm:block w-[120px] h-[120px] rounded-lg shrink-0" />
          </div>
        </div>

        {/* Players list */}
        <div className="bg-surface rounded-xl p-6">
          <h2 className="font-semibold mb-3 text-ink2">{t('lobby.players', { n: roomState.players.length })}</h2>
          <ul className="space-y-2">
            {roomState.players.map((p, i) => (
              <li key={p.id} className="flex items-center gap-3 text-sm">
                <span className="w-7 h-7 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold">
                  {i + 1}
                </span>
                <span className="font-medium">{p.name}</span>
                {i === 0 && <span className="text-xs text-accent ml-auto">{t('lobby.host')}</span>}
                {p.id === me.id && <span className="text-xs text-faint ml-1">{t('lobby.you')}</span>}
              </li>
            ))}
          </ul>
          {roomState.players.length < 2 && (
            <p className="text-xs text-faint mt-3">
              {isHost && draftMode === 'sealed'
                ? t('lobby.startSealedSoloHint')
                : t('lobby.waitingForPlayers')}
            </p>
          )}
        </div>

        {/* Draft config — host only */}
        {isHost && (
          <div className="bg-surface rounded-xl overflow-hidden">
            {/* Wizard progress: How to play → Cards → Settings */}
            <div className="flex border-b border-line">
              {wizardStepLabels.map((label, i) => {
                const n = i + 1, active = wizardStep === n, done = wizardStep > n
                return (
                  <div key={label}
                    className={`flex-1 py-3 px-2 text-center text-xs sm:text-sm font-medium border-b-2 ${
                      active ? 'border-accent text-accent' : 'border-transparent ' + (done ? 'text-ink2' : 'text-faint')}`}>
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] mr-1.5 ${
                      active ? 'bg-accent text-on-accent' : done ? 'bg-surface3 text-ink' : 'bg-surface2 text-faint'}`}>{done ? '✓' : n}</span>
                    <span className="hidden sm:inline">{label}</span>
                  </div>
                )
              })}
            </div>

            {/* Recap of earlier picks, so the host sees their mode/cards on later steps */}
            {wizardStep > 1 && (
              <div className="px-6 py-2 border-b border-line bg-surface2/40 text-xs flex flex-wrap items-center gap-x-4 gap-y-0.5">
                <span><span className="text-faint">{t('lobby.recapMode')}</span> <span className="text-ink2 font-medium">{t(`lobby.modes.${mode}.name`)}</span></span>
                {wizardStep > 2 && cardSummary && (
                  <span><span className="text-faint">{t('lobby.recapCards')}</span> <span className="text-ink2 font-medium">{cardSummary}</span></span>
                )}
              </div>
            )}

            <div className="p-6 space-y-5">
              {/* STEP 1 — how to play (the mode). Booster Draft + Sealed up front; the
                  alternate formats behind an "Other draft options" toggle. */}
              {wizardStep === 1 && (
                <div className="space-y-2">
                  {PRIMARY_MODE_IDS.map(id => modeButton(MODE_BY_ID[id]))}
                  <button type="button" onClick={() => setShowOtherModes(v => !v)}
                    className="w-full flex items-center gap-1.5 px-3 py-2 text-sm text-muted hover:text-ink transition-colors">
                    <span className="text-xs">{otherModesExpanded ? '▼' : '▶'}</span>
                    {t('lobby.otherDraftOptions')}
                  </button>
                  {otherModesExpanded && OTHER_MODE_IDS.map(id => modeButton(MODE_BY_ID[id]))}
                </div>
              )}

              {/* STEP 2 — what cards (the pool) */}
              {wizardStep === 2 && (<>
              {/* Card-source tabs */}
              <div className="flex border-b border-line -mx-6 -mt-6 mb-1">
                {(draftMode === 'draft' ? ['presets', 'cubes', 'multiset'] : ['presets', 'cubes', 'advanced']).map(tabId => (
                  <button key={tabId} onClick={() => setConfigTab(tabId)}
                    className={`flex-1 py-3 text-sm font-medium transition-colors ${
                      configTab === tabId
                        ? 'text-accent border-b-2 border-accent2 bg-surface'
                        : 'text-faint hover:text-ink2 bg-surface2/50'}`}>
                    {tabLabels[tabId] ?? tabId}
                  </button>
                ))}
              </div>
              {/* PRESETS TAB */}
              {configTab === 'presets' && (
                <div>
                  <p className="text-sm text-muted mb-3">
                    {isSealed
                      ? t('lobby.presetsHintSealed')
                      : mode === 'winston'
                        ? t('lobby.presetsHintWinston', { n: bpp * roomState.players.length })
                        : t('lobby.presetsHintDraft', { n: bpp })}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {SETS.filter(s => !s.hidden).map(set => {
                      const selected = selectedPreset === set.code
                      const assets = SET_ASSETS[set.code]
                      const logoUrl = assets?.logo
                      const iconUrl = assets?.icon
                      return (
                        <button
                          key={set.code}
                          onClick={() => setSelectedPreset(selected ? null : set.code)}
                          className={`relative flex flex-col items-center justify-center rounded-xl border-2 p-3 h-32 transition-all overflow-hidden gap-1 ${
                            selected
                              ? 'border-accent shadow-lg shadow-accent/20'
                              : 'border-line hover:border-line'}`}
                          style={{ backgroundColor: set.color + 'cc' }}
                        >
                          {logoUrl ? (
                            <img src={logoUrl} alt={set.name} className="h-14 w-full object-contain"
                              onError={e => { e.currentTarget.style.display = 'none' }} />
                          ) : iconUrl ? (
                            <img src={iconUrl} alt={set.name} className="h-10 object-contain"
                              onError={e => { e.currentTarget.style.display = 'none' }} />
                          ) : null}
                          <span className="text-xs text-ink text-center leading-tight font-medium px-1">{set.name}</span>
                          {selected && (
                            <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center text-xs text-on-accent font-bold">✓</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* CUBES TAB */}
              {configTab === 'cubes' && (
                <div className="space-y-3">
                  {/* Cube of the Month spotlight */}
                  {(() => {
                    const featured = SPOTLIGHT.cubeId ? COMMUNITY_CUBES.find(c => c.id === SPOTLIGHT.cubeId) : null
                    return (
                      <div className="rounded-xl border border-accent/40 bg-accent/5 p-4">
                        <p className="text-xs uppercase tracking-widest text-accent font-semibold mb-1">🏆 {SPOTLIGHT.title}</p>
                        {featured ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="font-display text-base text-ink">{featured.name}</p>
                                <p className="text-xs text-faint">{t('lobby.byAuthorCards', { author: featured.author, cards: tc('lobby.cardCount', featured.cardCount) })}</p>
                              </div>
                              <span className="w-2.5 h-2.5 rounded-full bg-accent shrink-0" />
                            </div>
                            {(SPOTLIGHT.blurb || featured.description) && (
                              <p className="text-xs text-ink2 leading-relaxed">{SPOTLIGHT.blurb || featured.description}</p>
                            )}
                            <div className="flex items-center gap-3 pt-1">
                              <button onClick={() => { setSelectedCube(featured.id); setCustomCube(null) }}
                                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent hover:bg-accent2 text-on-accent transition-colors">
                                {t('lobby.useThisCube')}
                              </button>
                              <button onClick={() => setPreviewCube(featured)} className="text-xs text-accent hover:text-accent2 transition-colors">{t('lobby.previewArrow')}</button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-muted">{t('lobby.spotlightComingSoon')}</p>
                        )}
                      </div>
                    )
                  })()}
                  <p className="text-sm text-muted">{t('lobby.communityCubesHint')}</p>
                  {COMMUNITY_CUBES.map(cube => {
                    const selected = selectedCube === cube.id
                    return (
                      <div key={cube.id}
                        className={`rounded-xl border-2 transition-all ${
                          selected ? 'border-accent bg-accent/5' : 'border-line bg-surface2'}`}>
                        <button onClick={() => { setSelectedCube(selected ? null : cube.id); setCustomCube(null) }}
                          className="w-full text-left p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-sm text-ink">{cube.name}</p>
                              <p className="text-xs text-faint mt-0.5">{t('lobby.byAuthorCards', { author: cube.author, cards: tc('lobby.cardCount', cube.cardCount) })}</p>
                              <p className="text-xs text-muted mt-1.5 leading-relaxed">{cube.description}</p>
                            </div>
                            {selected && (
                              <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-xs text-on-accent font-bold shrink-0">✓</span>
                            )}
                          </div>
                        </button>
                        <div className="px-4 pb-3">
                          <button onClick={() => setPreviewCube(cube)}
                            className="text-xs text-accent hover:text-accent2 transition-colors">
                            {t('lobby.previewCubeArrow')}
                          </button>
                        </div>
                      </div>
                    )
                  })}

                  {/* Load from your Re:Union decks */}
                  <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${
                    customCube?.source === 'reunion' ? 'border-accent bg-accent/5' : 'border-dashed border-line bg-surface2/40'}`}>
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-sm text-ink">{t('lobby.loadFromReunion')}</p>
                      {customCube?.source === 'reunion' && (
                        <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-xs text-on-accent font-bold shrink-0">✓</span>
                      )}
                    </div>
                    {!user ? (
                      <div className="space-y-2">
                        <p className="text-xs text-faint leading-relaxed">{t('lobby.connectReunionHint')}</p>
                        <button onClick={() => login()}
                          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface3 hover:bg-surface3 text-ink transition-colors">
                          {t('reunion.connect')}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <button onClick={handleLoadDecks} disabled={loadingDecks}
                            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface3 hover:bg-surface3 disabled:opacity-40 text-ink transition-colors">
                            {loadingDecks ? t('lobby.loadingEllipsis') : myDecks ? t('lobby.refreshDecks') : t('lobby.loadMyDecks')}
                          </button>
                          <span className="text-xs text-faint">{t('lobby.asPseudo', { pseudo: user.pseudo })}</span>
                        </div>
                        {myDecks && myDecks.length > 0 && (() => {
                          // Filter client-side by name + format. The list API has no card
                          // count, so a deck-size filter isn't possible here — name/format
                          // (the user's stated fallback) is what the API exposes.
                          const formats = [...new Set(myDecks.map(d => d.format).filter(Boolean))]
                          const q = deckSearch.trim().toLowerCase()
                          const shown = myDecks.filter(d =>
                            (deckFormat === 'all' || d.format === deckFormat) &&
                            (!q || (d.name ?? '').toLowerCase().includes(q)))
                          return (
                            <div className="space-y-2">
                              <input value={deckSearch} onChange={e => setDeckSearch(e.target.value)}
                                placeholder={tc('lobby.searchDecksPlaceholder', myDecks.length)}
                                className="w-full bg-surface2 border border-line rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
                              {formats.length > 1 && (
                                <div className="flex flex-wrap gap-1">
                                  {['all', ...formats].map(f => (
                                    <button key={f} onClick={() => setDeckFormat(f)}
                                      className={`px-2 py-0.5 rounded text-xs capitalize transition-colors ${
                                        deckFormat === f ? 'bg-accent text-on-accent font-bold' : 'bg-surface2 text-muted hover:text-ink'}`}>
                                      {f === 'all' ? t('lobby.filterAll') : f.replace('_', ' ')}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                                {shown.map((d, i) => {
                                  const checked = selectedDeckIds.includes(deckKey(d))
                                  return (
                                    <button key={deckKey(d) ?? i} onClick={() => toggleDeck(deckKey(d))}
                                      className={`w-full flex items-center gap-2 text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                                        checked ? 'bg-accent/20 text-accent2' : 'bg-surface2 hover:bg-surface3 text-ink'}`}>
                                      <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center text-[10px] ${
                                        checked ? 'bg-accent border-accent text-on-accent' : 'border-line'}`}>{checked ? '✓' : ''}</span>
                                      <span className="truncate flex-1">{d.name || t('lobby.untitledDeck')}</span>
                                      {d.format && <span className="text-[10px] uppercase tracking-wide text-faint shrink-0">{d.format.replace('_', ' ')}</span>}
                                    </button>
                                  )
                                })}
                                {!shown.length && <p className="text-xs text-faint px-1 py-2">{t('lobby.noDecksMatch')}</p>}
                              </div>
                              <div className="flex items-center gap-3">
                                <button onClick={handleLoadSelectedDecks} disabled={loadingDecks || !selectedDeckIds.length}
                                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent hover:bg-accent2 disabled:opacity-40 text-on-accent transition-colors">
                                  {loadingDecks ? t('lobby.loadingEllipsis') : selectedDeckIds.length === 0 ? t('lobby.loadDecksAsCubeZero') : tc('lobby.loadDecksAsCube', selectedDeckIds.length)}
                                </button>
                                {selectedDeckIds.length > 0 && (
                                  <button onClick={() => setSelectedDeckIds([])} className="text-xs text-faint hover:text-ink2 transition-colors">{t('lobby.clearSelection')}</button>
                                )}
                              </div>
                              <p className="text-[11px] text-faint">{t('lobby.tickDecksHint')}</p>
                            </div>
                          )
                        })()}
                        {customCube?.source === 'reunion' && loadedDesc && (
                          <div className="text-xs space-y-1.5">
                            <p className="text-green-400">
                              {t('lobby.loadedCubeNameOne', { name: customCube.name, cards: loadedDesc.cards, heroesPart: loadedDesc.heroesPart, unresolvedPart: loadedDesc.unresolvedPart })}
                            </p>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setPreviewCube({ name: customCube.name, author: 'Re:Union', cardCount: customCube.cards.length + customCube.heroes.length, refs: [...customCube.cards, ...customCube.heroes] })}
                                className="text-accent hover:text-accent2 transition-colors">{t('lobby.previewCubeArrow')}</button>
                              <button onClick={() => setCustomCube(null)} className="text-faint hover:text-ink2 transition-colors">{t('lobby.clear')}</button>
                            </div>
                          </div>
                        )}
                        {decksMsg && <p className="text-xs text-accent">{decksMsg}</p>}
                      </div>
                    )}
                  </div>

                  {/* Paste your own cube */}
                  <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${
                    customCube?.source === 'paste' ? 'border-accent bg-accent/5' : 'border-dashed border-line bg-surface2/40'}`}>
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-sm text-ink">{t('lobby.pasteYourCube')}</p>
                      {customCube?.source === 'paste' && (
                        <span className="w-5 h-5 rounded-full bg-accent flex items-center justify-center text-xs text-on-accent font-bold shrink-0">✓</span>
                      )}
                    </div>
                    <p className="text-xs text-faint leading-relaxed">{t('lobby.pasteHint')}</p>
                    <input value={customCubeName} onChange={e => setCustomCubeName(e.target.value)}
                      placeholder={t('lobby.cubeNamePlaceholder')}
                      className="w-full bg-surface2 border border-line rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-accent" />
                    <textarea value={customCubeText} onChange={e => setCustomCubeText(e.target.value)} rows={6}
                      placeholder={"1 ALT_CORE_B_YZ_03_C\n3 ALT_CORE_B_MU_06_R2\n..."}
                      className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-accent resize-none" />
                    <div className="flex items-center gap-3">
                      <button onClick={handleParseCube} disabled={parsingCube || !customCubeText.trim()}
                        className="px-3 py-1.5 rounded-lg text-sm font-medium bg-surface3 hover:bg-surface3 disabled:opacity-40 text-ink transition-colors">
                        {parsingCube ? t('lobby.parsing') : customCube?.source === 'paste' ? t('lobby.reparse') : t('lobby.parseAndPreview')}
                      </button>
                      {customCube?.source === 'paste' && (
                        <>
                          <button onClick={() => setPreviewCube({ name: customCube.name, author: 'You', cardCount: customCube.cards.length + customCube.heroes.length, refs: [...customCube.cards, ...customCube.heroes] })}
                            className="text-xs text-accent hover:text-accent2 transition-colors">
                            {t('lobby.previewArrow')}
                          </button>
                          <button onClick={() => { setCustomCube(null); setParseMsg('') }}
                            className="text-xs text-faint hover:text-ink2 transition-colors ml-auto">
                            {t('lobby.clear')}
                          </button>
                        </>
                      )}
                    </div>
                    {parseMsg && <p className="text-xs text-red-400">{parseMsg}</p>}
                    {customCube?.source === 'paste' && loadedDesc && (
                      <div className="text-xs space-y-1">
                        <p className="text-green-400">
                          {tc('lobby.loadedCards', customCube.cards.length, { cards: loadedDesc.cards, heroesPart: loadedDesc.heroesPart, heroDraftPart: loadedDesc.heroDraftPart })}
                        </p>
                        {customCube.unresolved.length > 0 && (
                          <p className="text-accent">
                            {tc('lobby.unresolvedWarning', customCube.unresolved.length)}{' '}
                            <span className="font-mono break-all text-accent2">
                              {customCube.unresolved.slice(0, 8).join(', ')}{customCube.unresolved.length > 8 ? ` … (+${customCube.unresolved.length - 8})` : ''}
                            </span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ADVANCED TAB */}
              {configTab === 'advanced' && (
                <div className="space-y-5">
                  <SetSelector selectedSets={selectedSets} onChange={setSelectedSets} disabled={loading} />

                  <div>
                    <button onClick={() => setShowCustomPool(!showCustomPool)}
                      className="text-sm text-muted hover:text-ink transition-colors flex items-center gap-1">
                      <span className="text-xs">{showCustomPool ? '▼' : '▶'}</span>
                      {t('lobby.customCardPool')}
                    </button>
                    {showCustomPool && (
                      <div className="mt-3">
                        <p className="text-xs text-faint mb-2">
                          {t('lobby.customPoolHint')}
                        </p>
                        <textarea
                          value={customPoolText}
                          onChange={e => setCustomPoolText(e.target.value)}
                          rows={6}
                          placeholder={"ALT_CORE_B_AX_02_C\nALT_CORE_B_BR_03_R1\n..."}
                          className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-accent resize-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* MULTI-SET TAB (draft only) */}
              {configTab === 'multiset' && (
                <div className="space-y-5">
                  <MultiSetSelector
                    mix={multiSetMix}
                    onChange={setMultiSetMix}
                    equalPacks={effectiveEqualPacks}
                    onEqualChange={setEqualPacks}
                    hideToggle={mode === 'winston'}
                    target={poolTarget}
                    disabled={loading}
                  />

                  <div>
                    <button onClick={() => setShowCustomPool(!showCustomPool)}
                      className="text-sm text-muted hover:text-ink transition-colors flex items-center gap-1">
                      <span className="text-xs">{showCustomPool ? '▼' : '▶'}</span>
                      {t('lobby.customCardPool')}
                    </button>
                    {showCustomPool && (
                      <div className="mt-3">
                        <p className="text-xs text-faint mb-2">
                          {t('lobby.customPoolHint')}
                        </p>
                        <textarea
                          value={customPoolText}
                          onChange={e => setCustomPoolText(e.target.value)}
                          rows={6}
                          placeholder={"ALT_CORE_B_AX_02_C\nALT_CORE_B_BR_03_R1\n..."}
                          className="w-full bg-surface2 border border-line rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-accent resize-none"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              </>)}

              {/* STEP 3 — settings */}
              {wizardStep === 3 && (
                <SettingsFields
                  mode={draftMode} draftFormat={draftFormat}
                  lang={lang} setLang={setLang}
                  heroMode={heroMode} setHeroMode={setHeroMode}
                  heroCount={heroCount} setHeroCount={setHeroCount} maxHeroes={maxHeroes} heroPoolSize={heroPoolSize}
                  timerEnabled={timerEnabled} setTimerEnabled={setTimerEnabled}
                  timerSeconds={timerSeconds} setTimerSeconds={setTimerSeconds}
                  addUniques={addUniques} setAddUniques={setAddUniques}
                  showUniques={configTab !== 'cubes'}
                  excludeBanlist={excludeBanlist} setExcludeBanlist={setExcludeBanlist}
                  showBanlist={isSealed}
                />
              )}

              {startError && <p className="text-red-400 text-sm">{startError}</p>}
            </div>

            {/* Wizard nav: Back · Next / Start */}
            <div className="flex items-center gap-3 px-6 py-4 border-t border-line">
              {wizardStep > 1 && (
                <button onClick={() => { setStartError(''); setWizardStep(s => s - 1) }} disabled={loading}
                  className="px-4 py-2 rounded-lg bg-surface2 hover:bg-surface3 disabled:opacity-40 text-ink2 text-sm font-medium transition-colors">
                  {t('lobby.back')}
                </button>
              )}
              {wizardStep < 3 ? (
                <button onClick={() => { setStartError(''); setWizardStep(s => s + 1) }}
                  disabled={wizardStep === 2 && !poolReady}
                  className="flex-1 py-2.5 bg-accent hover:bg-accent2 disabled:opacity-40 text-on-accent font-bold rounded-lg transition-colors">
                  {t('lobby.next')}
                </button>
              ) : (
                <button onClick={handleStart}
                  disabled={loading
                    || (draftMode === 'draft' && roomState.players.length < 2)
                    || (draftFormat === 'winston' && roomState.players.length !== 2)}
                  className="flex-1 py-2.5 bg-accent hover:bg-accent2 disabled:opacity-40 text-on-accent font-bold rounded-lg transition-colors">
                  {loading ? t('lobby.generatingPacks') : isSealed ? t('lobby.startSealed') : t('lobby.startDraft')}
                </button>
              )}
            </div>
          </div>
        )}

        {!isHost && (
          <div className="bg-surface rounded-xl p-6 text-center text-muted text-sm">
            {t('lobby.waitingForHost')}
          </div>
        )}
      </div>
      </div>

      {previewCube && (
        <CubePreviewModal cube={previewCube} onClose={() => setPreviewCube(null)} />
      )}
    </div>
  )
}