import { useState, useEffect } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider.jsx'
import { fetchBoundPools, listTournaments, listMyTournaments } from '../lib/tournamentApi.js'
import { useLang } from '../lib/i18n/i18n.jsx'
import TopNav from '../components/TopNav.jsx'
import Footer from '../components/Footer.jsx'
import { StatusPill, formatDateTime, ConfigSummary } from '../components/TournamentBits.jsx'
import { groupCreatedTournaments } from '../lib/tournamentRules.js'

const BGA_TOURNAMENT_LIST_URL = 'https://boardgamearena.com/tournamentlist?d&type=&players_per_match_min=0&players_per_match_max=0&status=future&gamecateg=3&game=1909&full=true&tournament_i_registered=0&time=0&prestige=0&order=recommended'

const TABS = ['upcoming', 'ongoing', 'pools', 'created']
const TAB_LABEL = { upcoming: 'tournaments.tabUpcoming', ongoing: 'tournaments.tabOngoing', pools: 'tournaments.tabPools', created: 'tournaments.tabCreated' }
const TAB_HINT = { upcoming: 'tournaments.tabUpcomingHint', ongoing: 'tournaments.tabOngoingHint', pools: 'tournaments.tabPoolsHint', created: 'tournaments.tabCreatedHint' }

const cardCls = 'relative block bg-surface border border-line hover:border-accent/60 rounded-lg px-4 py-3 transition-colors'
const ctaCls = 'relative z-10 shrink-0 text-xs px-3 py-1.5 rounded bg-surface2 hover:bg-surface3 transition-colors'

// A public tournament card: the whole card opens the tournament page.
function TournamentCard({ tn, t, tc }) {
  const v = tn.viewer
  return (
    <Link to={`/tournament/t/${tn.id}`} className={cardCls}>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="font-semibold">{tn.name}</p>
        <StatusPill status={tn.status} t={t} />
        {v?.hasPool && <span className="text-xs text-ok">✓ {t('tournaments.youHavePool')}</span>}
      </div>
      <p className="text-sm text-ink2">{t('tournaments.startsAt', { date: formatDateTime(tn.startsAt) })}</p>
      <ConfigSummary config={tn.config} t={t} tc={tc} className="text-xs text-muted" />
      <p className="text-xs text-faint">
        {t('tournaments.organizedBy', { name: tn.organizer.name })} · {tc('tournaments.poolsPrepared', tn.poolCount ?? 0)}
        {v?.deck ? ` · ${t('tournaments.yourDeck', { name: v.deck.name, n: v.deck.cardQuantity ?? 0 })}` : ''}
      </p>
    </Link>
  )
}

// A card that opens a page as a whole AND carries its own "Change my deck" button: the
// card link is stretched over the card (a link can't contain another link). It is a real,
// focusable link labelled with the card's title, so a screen reader gets two clear links.
function CardWithDeckCta({ to, deckTo, label, t, children }) {
  return (
    <div className={`${cardCls} flex items-center justify-between gap-3`}>
      <Link to={to} aria-label={label} className="absolute inset-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" />
      <div className="min-w-0">{children}</div>
      <Link to={deckTo} className={ctaCls}>{t('tournamentPages.changeMyDeck')}</Link>
    </div>
  )
}

function deckLine(deck, t, tc) {
  return deck ? `${deck.name} · ${tc('tournamentPages.cardsInDeck', deck.cardQuantity ?? 0)}` : t('tournamentPages.noDeckStartedYet')
}

const GROUP_TITLE = {
  ongoing: 'tournaments.groupOngoing', upcoming: 'tournaments.groupUpcoming',
  ended: 'tournaments.groupEnded', cancelled: 'tournaments.groupCancelled', detached: 'tournaments.groupDetached',
}

// "My created tournaments": active groups shown, the archive (ended / cancelled / detached)
// folded in a <details> — out of the way, one click away, no tabs inside the tab.
function CreatedTournaments({ list, t, tc }) {
  const { active, archive, archiveCount } = groupCreatedTournaments(list)
  const groupBlock = g => (
    <div key={g.status} className="space-y-2">
      <h3 className="text-sm font-semibold text-ink2">{t(GROUP_TITLE[g.status])} <span className="text-faint font-normal tabular-nums">{g.items.length}</span></h3>
      {g.items.map(tn => <TournamentCard key={tn.id} tn={tn} t={t} tc={tc} />)}
    </div>
  )
  return (
    <div className="space-y-5">
      {active.length ? active.map(groupBlock) : <p className="text-muted text-sm">{t('tournaments.noCreatedActive')}</p>}
      {archiveCount > 0 && (
        <details className="group border-t border-line pt-4">
          <summary className="cursor-pointer select-none text-sm font-semibold text-ink2 hover:text-ink list-none flex items-center gap-2">
            <span className="transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
            {t('tournaments.createdArchive', { n: archiveCount })}
          </summary>
          <div className="space-y-5 mt-4">{archive.map(groupBlock)}</div>
        </details>
      )}
    </div>
  )
}

function ConnectBox({ t, login }) {
  return (
    <div className="bg-surface rounded-xl p-6 text-center space-y-3">
      <p className="text-muted text-sm">{t('home.bgaConnectRequired')}</p>
      <button onClick={() => login('/tournament')}
        className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors">
        {t('reunion.connect')}
      </button>
    </div>
  )
}

// /tournament — the tournaments hub (spec §8): "my ongoing tournaments" first, then tabs
// for the upcoming / ongoing public lists, the player's pools and the tournaments they
// created. The active tab lives in the URL (?tab=) so it survives a reload and can be shared.
export default function TournamentMenu() {
  const navigate = useNavigate()
  const { user, login, loading: authLoading } = useAuth()
  const { t, tc } = useLang()
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'upcoming'
  const setTab = next => setParams(prev => { const p = new URLSearchParams(prev); p.set('tab', next); return p }, { replace: true })

  const [tournaments, setTournaments] = useState(null)
  const [listError, setListError] = useState('')
  const [pools, setPools] = useState(null)
  const [poolsError, setPoolsError] = useState('')
  const [created, setCreated] = useState(null)
  const [createdError, setCreatedError] = useState('')

  // Public list; re-fetched when the session changes so the viewer flags appear.
  useEffect(() => {
    if (authLoading) return
    listTournaments('open')
      .then(data => setTournaments(data.tournaments))
      .catch(e => setListError(e.message || t('tournaments.couldNotLoad')))
  }, [user, authLoading, t])

  useEffect(() => {
    if (!user) return
    fetchBoundPools()
      .then(data => setPools(data.pools))
      .catch(e => setPoolsError(e.message || t('tournamentPages.couldNotLoadTournaments')))
    listMyTournaments()
      .then(data => setCreated(data.tournaments))
      .catch(e => setCreatedError(e.message || t('tournaments.couldNotLoad')))
  }, [user, t])

  const upcoming = tournaments?.filter(tn => tn.status === 'upcoming') ?? []
  const ongoing = tournaments?.filter(tn => tn.status === 'ongoing') ?? []
  const myOngoing = ongoing.filter(tn => tn.viewer?.hasPool)
  const counts = { upcoming: tournaments && upcoming.length, ongoing: tournaments && ongoing.length, pools: pools?.length, created: created?.length }

  const listState = (items, error, emptyKey) => {
    if (error) return <p className="text-danger text-sm">{error}</p>
    if (!items) return <p className="text-muted text-sm">{t('tournaments.loading')}</p>
    if (!items.length) return <p className="text-muted text-sm">{t(emptyKey)}</p>
    return null
  }

  return (
    <div className="min-h-screen flex flex-col">
      <TopNav />
      <div className="max-w-3xl w-full mx-auto px-4 py-8 flex-1 space-y-8">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-display">{t('tournamentPages.menuTitle')}</h1>
          <button onClick={() => user ? navigate('/tournament/new') : login('/tournament/new')}
            className="bg-accent hover:bg-accent2 text-on-accent font-semibold py-2 px-4 rounded-lg transition-colors text-sm">
            {t('tournaments.createButton')}
          </button>
        </div>

        <div className="bg-surface2 border border-line rounded-lg p-3 text-sm text-muted">
          <p>
            {t('tournamentPages.registerNoticePrefix')}{' '}
            <a href={BGA_TOURNAMENT_LIST_URL} target="_blank" rel="noopener noreferrer" className="text-accent-ink hover:underline">
              {t('tournamentPages.registerNoticeLinkLabel')}
            </a>
          </p>
          <p className="mt-1">{t('tournamentPages.registerNoticeSchedule')}</p>
        </div>

        {/* My ongoing tournaments: what a player in the middle of a tournament needs first */}
        {user && myOngoing.length > 0 && (
          <section data-testid="my-ongoing" className="space-y-2">
            <h2 className="font-semibold text-lg">{t('tournaments.myOngoingTitle')}</h2>
            <p className="text-xs text-faint">{t('tournaments.myOngoingHint')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {myOngoing.map(tn => (
                <CardWithDeckCta key={tn.id} to={`/tournament/t/${tn.id}`} deckTo={`/tournament/t/${tn.id}/pool`} label={tn.name} t={t}>
                  <p className="font-semibold text-sm truncate">{tn.name}</p>
                  <p className="text-xs text-ink2">{t('tournaments.startsAt', { date: formatDateTime(tn.startsAt) })}</p>
                  <p className="text-xs text-faint truncate">
                    {tn.viewer?.deck ? t('tournaments.yourDeck', { name: tn.viewer.deck.name, n: tn.viewer.deck.cardQuantity ?? 0 }) : t('tournamentPages.noDeckStartedYet')}
                  </p>
                </CardWithDeckCta>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4">
          <div role="tablist" aria-label={t('tournamentPages.menuTitle')} className="flex gap-1 border-b border-line overflow-x-auto overflow-y-hidden scrollbar-gold">
            {TABS.map(key => (
              <button key={key} type="button" role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`}
                onClick={() => setTab(key)}
                className={`shrink-0 whitespace-nowrap px-3 py-2 text-sm border-b-2 transition-colors ${tab === key ? 'border-accent text-ink font-semibold' : 'border-transparent text-muted hover:text-ink'}`}>
                {t(TAB_LABEL[key])}
                {counts[key] != null && counts[key] !== false && <span className="ml-1.5 text-xs text-faint tabular-nums">{counts[key]}</span>}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-2">
            <p className="text-xs text-faint">{t(TAB_HINT[tab])}</p>

            {tab === 'upcoming' && (listState(tournaments && upcoming, listError, 'tournaments.noUpcoming')
              ?? upcoming.map(tn => <TournamentCard key={tn.id} tn={tn} t={t} tc={tc} />))}

            {tab === 'ongoing' && (listState(tournaments && ongoing, listError, 'tournaments.noOngoing')
              ?? ongoing.map(tn => <TournamentCard key={tn.id} tn={tn} t={t} tc={tc} />))}

            {tab === 'pools' && (!user && !authLoading ? <ConnectBox t={t} login={login} /> : (
              <>
                {listState(user ? pools : null, poolsError, 'tournamentPages.noOngoingTournaments')
                  ?? pools.map(p => (
                    // A declared tournament has a page; a pool bound to an undeclared BGA
                    // tournament doesn't, so its card opens the pool itself.
                    <CardWithDeckCta key={p.id} t={t} label={p.tournamentName || t('tournamentPages.sealedPoolFallback', { set: p.setCode })}
                      to={p.tournament ? `/tournament/t/${p.tournament.id}` : `/tournament/pools/${p.id}`}
                      deckTo={p.tournament ? `/tournament/t/${p.tournament.id}/pool` : `/tournament/pools/${p.id}`}>
                      <p className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                        {p.tournamentName || t('tournamentPages.sealedPoolFallback', { set: p.setCode })}
                        {p.tournament && <StatusPill status={p.tournament.status} t={t} />}
                      </p>
                      <p className="text-xs text-faint">
                        {p.tournament
                          ? t('tournaments.startsAt', { date: formatDateTime(p.tournament.startsAt) })
                          : t('tournamentPages.boundAt', { date: p.boundAt ? new Date(p.boundAt).toLocaleString() : '—' })}
                        {' · '}{deckLine(p.deck, t, tc)}
                      </p>
                    </CardWithDeckCta>
                  ))}
                <div className="border-t border-line pt-4 mt-4 space-y-2">
                  <h3 className="font-semibold text-sm text-ink2">{t('tournaments.genericPrepTitle')}</h3>
                  <p className="text-xs text-faint">{t('tournaments.genericPrepHint')}</p>
                  <button onClick={() => navigate('/tournament/prep')}
                    className="text-sm px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface3 text-ink transition-colors">
                    {t('tournamentPages.prepareNext')}
                  </button>
                </div>
              </>
            ))}

            {tab === 'created' && (!user && !authLoading ? <ConnectBox t={t} login={login} /> : (
              listState(user ? created : null, createdError, 'tournaments.noCreated')
                ?? <CreatedTournaments list={created} t={t} tc={tc} />
            ))}
          </div>
        </section>
      </div>
      <Footer />
    </div>
  )
}
