import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useLang } from '../lib/i18n/i18n.jsx'
import { getTournament } from '../lib/tournamentApi.js'
import { fetchSet, apiSetCode, fetchUniques, needsCardApi } from '../lib/cardData.js'
import { setsForCube } from '../lib/cubes.js'
import { FACTION_ICONS } from '../lib/assets.js'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'
import CubeContents from '../components/CubeContents.jsx'
import { ConfigSummary, PlayersLine } from '../components/TournamentBits.jsx'

const ORIGIN_KEYS = { community: 'cubeOriginCommunity', reunion: 'cubeOriginReunion', paste: 'cubeOriginPaste' }

// The cube of a cube-sealed tournament, public (spec §15.5): header, the hero pool, then
// the whole card list over the shared CubeContents.
export default function TournamentCubePage() {
  const { id } = useParams()
  const { t, tc } = useLang()
  const [tournament, setTournament] = useState(null)
  const [error, setError] = useState('')
  const [heroCards, setHeroCards] = useState({})

  useEffect(() => {
    let alive = true
    setError('')
    getTournament(id)
      .then(r => { if (alive) setTournament(r) })
      .catch(e => { if (alive) setError(e.status === 404 ? t('tournaments.notFound') : t('tournaments.errGeneric', { msg: e.message })) })
    return () => { alive = false }
  }, [id, t])

  const src = tournament?.config?.source
  const isCube = src?.type === 'cube'
  // One entry per copy, as CubeContents expects.
  const refs = useMemo(
    () => isCube ? Object.entries(src.cards).flatMap(([ref, qty]) => Array(qty).fill(ref)) : [],
    [isCube, src]
  )
  const heroPool = isCube ? src.heroPool ?? [] : []

  // Resolve the hero names (faction icon + name once loaded).
  useEffect(() => {
    if (!heroPool.length) return
    let alive = true
    const setCodes = [...new Set(setsForCube(heroPool).map(apiSetCode))]
    Promise.all(setCodes.map(s => fetchSet(s, 'EN').catch(() => [])))
      .then(async results => {
        const map = {}
        for (const cards of results) for (const c of cards) map[c.reference] = c
        for (const c of await fetchUniques(heroPool.filter(needsCardApi), 'EN').catch(() => [])) map[c.reference] = c
        if (alive) setHeroCards(map)
      })
    return () => { alive = false }
  }, [heroPool])

  if (tournament && !isCube) return <Navigate to={`/tournament/t/${id}`} replace />

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-5xl w-full mx-auto px-4 py-8 flex-1 space-y-6">
        <Link to={`/tournament/t/${id}`} className="text-sm text-muted hover:text-ink">← {t('tournaments.backToTournament')}</Link>
        {error && <p role="alert" className="text-danger text-sm">{error}</p>}
        {!tournament && !error && <p className="text-muted text-sm">…</p>}
        {isCube && (
          <>
            <header data-testid="cube-page" className="space-y-1">
              <h1 className="text-2xl font-display">{t('tournaments.cubePageOf', { name: tournament.name })}</h1>
              <p className="text-lg">{src.name}</p>
              {ORIGIN_KEYS[src.origin] && <p className="text-sm text-faint">{t(`tournaments.${ORIGIN_KEYS[src.origin]}`)}</p>}
              <ConfigSummary config={tournament.config} t={t} tc={tc} className="text-sm text-muted" />
              <div className="text-sm text-muted"><PlayersLine tournament={tournament} t={t} tc={tc} /></div>
            </header>

            <section data-testid="cube-page-heroes" className="space-y-2">
              <h2 className="font-bold">{t('tournaments.cubePageHeroesTitle', { n: heroPool.length })}</h2>
              <p className="text-sm text-muted">{t(tournament.config.heroes === 'free' ? 'tournaments.cubePageHeroesFree' : 'tournaments.cubePageHeroesPacks')}</p>
              <ul className="flex flex-wrap gap-2">
                {heroPool.map(ref => {
                  const card = heroCards[ref]
                  const faction = card?.faction
                  return (
                    <li key={ref} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-line bg-surface2 text-ink2">
                      {faction && FACTION_ICONS[faction] && <img src={FACTION_ICONS[faction]} alt={faction} className="w-3.5 h-3.5 object-contain" />}
                      {card?.name ?? ref}
                    </li>
                  )
                })}
              </ul>
            </section>

            <div className="bg-surface rounded-2xl border border-line h-[75vh] flex flex-col overflow-hidden">
              <CubeContents refs={refs} />
            </div>
          </>
        )}
      </div>
      <Footer />
    </div>
  )
}
