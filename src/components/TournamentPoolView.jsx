import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchSet, fetchUniques, isUniqueRef } from '../lib/cardData.js'
import { createDeck, updateDeck, toDeckCards, getDeck, deckCardsToRefs } from '../lib/decks.js'
import { syncPoolDeck } from '../lib/tournamentApi.js'
import { buildRandomDeck } from '../lib/randomDeck.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import PoolGrid from './PoolGrid.jsx'
import PackReveal from './PackReveal.jsx'
import TopNav from './TopNav.jsx'
import Footer from './Footer.jsx'

const SYNC_THROTTLE_MS = 2000
const RESET_COOLDOWN_MS = 30 * 60 * 1000 // mirrors poolStore.js RESET_COOLDOWN_MS

// Remaining reset cooldown from the pool's last reset time (null/absent → 0, resettable now).
function cooldownFromResetAt(resetAt) {
  if (!resetAt) return 0
  return Math.max(0, new Date(resetAt).getTime() + RESET_COOLDOWN_MS - Date.now())
}

// mm:ss for the live cooldown display.
function formatCooldown(ms) {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// localStorage key that gates the first-open reveal. Includes resetAt so a fresh pool (after
// a reset) replays the opening, while re-visiting the same pool does not.
function revealKey(pool) {
  return `pool_reveal_seen:${pool.id}:${pool.resetAt ?? ''}`
}

/**
 * Shared full-pool view + deck editor for all three tournament sealed flows (normal,
 * preparation, and a specific bound tournament pool) — see ROADMAP.md "Set 6 preview".
 * `load()` fetches the pool (creating it server-side if needed); `reset` (optional) is
 * only wired for the normal-mode page. As soon as the deck goes from empty to non-empty,
 * a deck is created in the background via decks-api and kept in sync on every
 * add/remove, throttled to one call per 2s.
 */
export default function TournamentPoolView({ title, load, reset }) {
  const { t } = useLang()
  const [pool, setPool] = useState(null)
  const [cardMap, setCardMap] = useState({})
  const [deck, setDeck] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cooldownMs, setCooldownMs] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [showReveal, setShowReveal] = useState(false) // first-open pack-by-pack overlay

  const poolRef = useRef(null) // avoids clobbering deck state on a resolved-late reload
  const lastSyncAtRef = useRef(0)
  const syncTimerRef = useRef(null)
  const deckRef = useRef(deck)
  deckRef.current = deck
  // Seeding `deck` from a load (or a reset) is not a user edit — it must NOT re-trigger a
  // sync, or a BGA-generated "Random …" deck would lose that name the moment the player
  // merely opens the page, before they've touched anything.
  const skipNextSyncRef = useRef(false)

  const loadPool = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await load()
      poolRef.current = data
      setPool(data)
      setCooldownMs(cooldownFromResetAt(data.resetAt)) // show the cooldown from the start, not just after a rejected click

      const refs = Object.keys(data.cards)
      const map = {}
      const cards = await fetchSet(data.setCode).catch(() => [])
      for (const c of cards) map[c.reference] = c
      const uniqueRefs = refs.filter(r => isUniqueRef(r) && !map[r])
      if (uniqueRefs.length) {
        const uCards = await fetchUniques(uniqueRefs)
        for (const c of uCards) map[c.reference] = c
      }
      setCardMap(map)

      // Seed the local deck editor from whatever's already been synced for this pool.
      // We don't have a per-card deck breakdown server-side (only the summary), so an
      // existing deck's contents come from decks-api directly.
      skipNextSyncRef.current = true
      if (data.deck?.id) {
        try {
          const existingDeck = await getDeck(data.deck.id)
          const counts = {}
          for (const ref of deckCardsToRefs(existingDeck)) counts[ref] = (counts[ref] ?? 0) + 1
          setDeck(counts)
        } catch {
          // Deck may have been deleted server-side (e.g. a prior reset's best-effort
          // delete) — fall back to an empty editor rather than failing the whole load.
          setDeck({})
        }
      } else {
        setDeck({})
      }
    } catch (e) {
      setError(e.message || t('tournamentPoolView.couldNotLoadPool'))
    } finally {
      setLoading(false)
    }
  }, [load, t])

  useEffect(() => { loadPool() }, [loadPool])

  // Tick the reset cooldown down every second while it's active (self-corrects on a 429).
  useEffect(() => {
    if (cooldownMs <= 0) return
    const interval = setInterval(() => setCooldownMs(ms => Math.max(0, ms - 1000)), 1000)
    return () => clearInterval(interval)
  }, [cooldownMs > 0])

  // Show the first-open pack reveal once per pool (skips if already seen, or no boosters).
  useEffect(() => {
    if (!pool?.id || !pool.boosters?.length) return
    try { if (!localStorage.getItem(revealKey(pool))) setShowReveal(true) } catch { /* ignore */ }
  }, [pool?.id, pool?.resetAt])

  function dismissReveal() {
    try { if (pool?.id) localStorage.setItem(revealKey(pool), '1') } catch { /* ignore */ }
    setShowReveal(false)
  }

  async function handleReset() {
    if (!reset) return
    setError('')
    try {
      const result = await reset()
      if (result?.cooldownRemainingMs != null) {
        setCooldownMs(result.cooldownRemainingMs)
        return
      }
      poolRef.current = result
      setPool(result)
      skipNextSyncRef.current = true
      setDeck({})
      await loadPool()
    } catch (e) {
      setError(e.message || t('tournamentPoolView.couldNotResetPool'))
    }
  }

  const scheduleSync = useCallback(() => {
    const currentPool = poolRef.current
    if (!currentPool) return
    const totalInDeck = Object.values(deckRef.current).reduce((a, b) => a + b, 0)
    if (totalInDeck === 0) return // nothing to create/sync yet

    const run = async () => {
      lastSyncAtRef.current = Date.now()
      setSyncing(true)
      try {
        const refs = Object.entries(deckRef.current).flatMap(([ref, qty]) => Array(qty).fill(ref))
        const deckCards = toDeckCards(refs)
        const heroRef = refs.find(r => cardMap[r]?.cardType === 'HERO')
        const deckFactions = new Set(refs.map(r => cardMap[r]?.faction).filter(Boolean))
        const deckHeroCount = refs.filter(r => cardMap[r]?.cardType === 'HERO').length
        const isValid = refs.length >= 30 && deckFactions.size <= 3 && deckHeroCount <= 1
        // "Invalid " is a literal token the BGA-side integration matches on to flag the
        // deck explicitly, instead of failing opaquely on the next decks-api call — do not
        // route it through t()/translate it, same rule as ensureDeck's "Random " prefix.
        const namePrefix = isValid ? '' : 'Invalid '
        const summary = {
          name: `${namePrefix}${currentPool.setCode} sealed · ${new Date().toLocaleDateString()}`,
          deckCards,
          isDraft: !isValid,
          format: 'sealed',
        }
        let deckId = currentPool.deck?.id
        if (deckId) {
          await updateDeck(deckId, summary)
        } else {
          const created = await createDeck(summary)
          deckId = created.id
        }
        const updatedPool = await syncPoolDeck(currentPool.id, {
          deckId,
          name: summary.name,
          heroRef: heroRef ?? null,
          faction: heroRef ? cardMap[heroRef]?.faction : null,
          cardQuantity: refs.length,
        })
        poolRef.current = updatedPool
        setPool(updatedPool)
      } catch (e) {
        setError(e.message || t('tournamentPoolView.couldNotSyncDeck'))
      } finally {
        setSyncing(false)
      }
    }

    const elapsed = Date.now() - lastSyncAtRef.current
    if (elapsed >= SYNC_THROTTLE_MS) {
      run()
    } else if (!syncTimerRef.current) {
      syncTimerRef.current = setTimeout(() => { syncTimerRef.current = null; run() }, SYNC_THROTTLE_MS - elapsed)
    }
  }, [cardMap, t])

  useEffect(() => {
    if (skipNextSyncRef.current) { skipNextSyncRef.current = false; return }
    scheduleSync()
  }, [deck, scheduleSync])
  useEffect(() => () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }, [])

  function handleResetDeck() {
    if (deckTotal === 0) return
    if (!window.confirm(t('tournamentPoolView.resetDeckConfirm'))) return
    setDeck({})
  }

  function handleMakeRandomDeck() {
    if (deckTotal > 0) return
    setDeck(buildRandomDeck(pool?.cards ?? {}, cardMap))
  }

  function addCard(ref) {
    setDeck(d => ({ ...d, [ref]: (d[ref] ?? 0) + 1 }))
  }
  function removeCard(ref) {
    setDeck(d => {
      const qty = (d[ref] ?? 0) - 1
      const next = { ...d }
      if (qty <= 0) delete next[ref]
      else next[ref] = qty
      return next
    })
  }

  if (loading && !pool) {
    return <div className="min-h-screen flex items-center justify-center text-muted">{t('tournamentPoolView.loadingYourPool')}</div>
  }

  const deckTotal = Object.values(deck).reduce((a, b) => a + b, 0)
  const deckRefs = Object.entries(deck).flatMap(([ref, qty]) => Array(qty).fill(ref))
  const deckFactions = new Set(deckRefs.map(r => cardMap[r]?.faction).filter(Boolean))
  const deckHeroCount = deckRefs.filter(r => cardMap[r]?.cardType === 'HERO').length
  const isEnough = deckTotal >= 30
  const isValidFactions = deckFactions.size <= 3
  const isValidHero = deckHeroCount <= 1
  const isValid = isEnough && isValidFactions && isValidHero

  // Boosters (from the API's `boosters`) feed the first-open reveal only; deckbuilding
  // always uses the full pool. Heroes aren't in boosters — they're in the full pool.
  const boosters = pool?.boosters ?? []
  const hasBoosters = boosters.length > 0

  // The guaranteed unique(s) live in the pool but in no real booster (see tournamentPool.js);
  // surface them as the reveal's final "8th booster".
  const boosterFlat = boosters.flat()
  const bonusUniques = Object.keys(pool?.cards ?? {}).filter(r => isUniqueRef(r) && !boosterFlat.includes(r))
  const revealPacks = bonusUniques.length ? [...boosters, bonusUniques] : boosters

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      {showReveal && hasBoosters && (
        <PackReveal
          packs={revealPacks}
          hasBonus={bonusUniques.length > 0}
          cardMap={cardMap}
          deck={deck}
          poolCounts={pool?.cards}
          onAdd={addCard}
          onRemove={removeCard}
          onClose={dismissReveal}
        />
      )}
      <div className="w-full px-4 py-4 flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h1 className="text-xl font-display">{title}</h1>
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 border-line bg-surface2 text-base font-semibold text-muted">
              <span className="w-4 h-4 rounded-full border-2 border-line border-t-accent animate-spin shrink-0" />
              {t('tournamentPoolView.loadingYourDeck')}
            </div>
          ) : (
            <div className={`flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-lg border-2 text-base font-semibold ${
              isValid ? 'border-green-700 bg-green-900/25' : 'border-red-800 bg-red-950/25'}`}>
              <span className={isEnough ? 'text-green-400' : 'text-red-400'}>{isEnough ? '✓' : '✗'} {t('deckValidity.cardsOf30Plus', { n: deckTotal })}</span>
              <span className={isValidFactions ? 'text-green-400' : 'text-red-400'}>{isValidFactions ? '✓' : '✗'} {t('deckValidity.factionsOf3', { n: deckFactions.size })}</span>
              <span className={isValidHero ? (deckHeroCount === 1 ? 'text-green-400' : 'text-faint') : 'text-red-400'}>{isValidHero ? '✓' : '✗'} {t('deckValidity.heroOf1', { n: deckHeroCount })}</span>
              <span className={`font-bold ${isValid ? 'text-green-400' : 'text-red-400'}`}>
                {isValid ? t('deckValidity.valid') : t('deckValidity.notValid')}
              </span>
            </div>
          )}
          {syncing && <span className="text-xs text-faint">{t('tournamentPoolView.syncingDeck')}</span>}
          <div className="ml-auto flex items-center gap-2">
            <button onClick={handleMakeRandomDeck} disabled={loading || deckTotal > 0}
              title={deckTotal > 0 ? t('tournamentPoolView.makeRandomDeckTitleDisabled') : t('tournamentPoolView.makeRandomDeckTitleEnabled')}
              className="text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 disabled:opacity-40 transition-colors">
              {t('tournamentPoolView.makeRandomDeck')}
            </button>
            <button onClick={handleResetDeck} disabled={loading || deckTotal === 0}
              className="text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-red-900 disabled:opacity-40 transition-colors">
              {t('tournamentPoolView.resetDeck')}
            </button>
            {reset && (
              <button onClick={handleReset} disabled={cooldownMs > 0}
                className="text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 disabled:opacity-40 transition-colors">
                {cooldownMs > 0 ? t('tournamentPoolView.resetAvailableIn', { time: formatCooldown(cooldownMs) }) : t('tournamentPoolView.resetPool')}
              </button>
            )}
          </div>
        </div>
        {error && <p className="text-red-400 text-sm mb-2">{error}</p>}

        {/* Deckbuilding is always the full pool — the pack-by-pack experience is the
            first-open reveal overlay, not a persistent tab (avoids a "which tab?" step). */}
        <div className="flex-1 bg-surface rounded-xl border border-line overflow-hidden">
          <PoolGrid
            refs={Object.entries(pool?.cards ?? {}).flatMap(([ref, qty]) => Array(qty).fill(ref))}
            cardMap={cardMap}
            deck={deck}
            poolCounts={pool?.cards}
            onAdd={addCard}
            onRemove={removeCard}
            loading={loading}
          />
        </div>
      </div>
      <Footer />
    </div>
  )
}
