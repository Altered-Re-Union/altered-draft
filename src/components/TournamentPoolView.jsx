import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchSet, fetchUniques, isUniqueRef } from '../lib/cardData.js'
import { createDeck, updateDeck, toDeckCards } from '../lib/decks.js'
import { syncPoolDeck } from '../lib/tournamentApi.js'
import PoolGrid from './PoolGrid.jsx'
import TopNav from './TopNav.jsx'

const SYNC_THROTTLE_MS = 2000

/**
 * Shared full-pool view + deck editor for all three tournament sealed flows (normal,
 * preparation, and a specific bound tournament pool) — see ROADMAP.md "Set 6 preview".
 * `load()` fetches the pool (creating it server-side if needed); `reset` (optional) is
 * only wired for the normal-mode page. As soon as the deck goes from empty to non-empty,
 * a deck is created in the background via decks-api and kept in sync on every
 * add/remove, throttled to one call per 2s.
 */
export default function TournamentPoolView({ title, load, reset }) {
  const [pool, setPool] = useState(null)
  const [cardMap, setCardMap] = useState({})
  const [deck, setDeck] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cooldownMs, setCooldownMs] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const poolRef = useRef(null) // avoids clobbering deck state on a resolved-late reload
  const lastSyncAtRef = useRef(0)
  const syncTimerRef = useRef(null)
  const deckRef = useRef(deck)
  deckRef.current = deck

  const loadPool = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await load()
      poolRef.current = data
      setPool(data)

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
      setDeck({})
    } catch (e) {
      setError(e.message || 'Could not load your pool.')
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => { loadPool() }, [loadPool])

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
      setDeck({})
      await loadPool()
    } catch (e) {
      setError(e.message || 'Could not reset your pool.')
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
        const summary = {
          name: `${currentPool.setCode} sealed · ${new Date().toLocaleDateString()}`,
          deckCards,
          isDraft: true,
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
        setError(e.message || 'Could not sync your deck.')
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
  }, [cardMap])

  useEffect(() => { scheduleSync() }, [deck, scheduleSync])
  useEffect(() => () => { if (syncTimerRef.current) clearTimeout(syncTimerRef.current) }, [])

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
    return <div className="min-h-screen flex items-center justify-center text-muted">Loading your pool…</div>
  }

  const deckTotal = Object.values(deck).reduce((a, b) => a + b, 0)
  const deckRefs = Object.entries(deck).flatMap(([ref, qty]) => Array(qty).fill(ref))
  const deckFactions = new Set(deckRefs.map(r => cardMap[r]?.faction).filter(Boolean))
  const deckHeroCount = deckRefs.filter(r => cardMap[r]?.cardType === 'HERO').length
  const isValid = deckTotal >= 30 && deckFactions.size <= 3 && deckHeroCount <= 1

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-6xl w-full mx-auto px-4 py-4 flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h1 className="text-xl font-display">{title}</h1>
          <span className="text-xs text-faint">
            {deckTotal}/30+ cards · {deckFactions.size}/3 factions · {deckHeroCount}/1 hero
            {isValid ? ' · ✓ valid' : ''}
          </span>
          {syncing && <span className="text-xs text-faint">Syncing deck…</span>}
          {reset && (
            <button onClick={handleReset} disabled={cooldownMs > 0}
              className="ml-auto text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 disabled:opacity-40 transition-colors">
              {cooldownMs > 0 ? `Reset available in ${Math.ceil(cooldownMs / 60000)}min` : 'Reset pool'}
            </button>
          )}
        </div>
        {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
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
    </div>
  )
}
