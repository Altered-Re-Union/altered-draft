import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../lib/i18n/i18n.jsx'

const registeredKey = id => `tournament_bga_registered:${id}`

function Step({ n, title, desc, done, children }) {
  return (
    <div data-testid={`checklist-step-${n}`} data-done={done ? 'true' : 'false'} className={`flex gap-3 rounded-lg border p-3 ${done ? 'border-ok/40 bg-surface' : 'border-line bg-surface2'}`}>
      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
        done ? 'bg-ok text-surface' : 'bg-accent text-on-accent'}`}>{done ? '✓' : n}</span>
      <div className="flex-1 space-y-1.5">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-faint">{desc}</p>
        <div className="pt-1">{children}</div>
      </div>
    </div>
  )
}

/**
 * The 3-step wizard of a tournament page (spec §3.3): register on BGA (remembered in
 * localStorage, since BGA registration can't be verified) → open the one-shot pool →
 * build the deck. `viewer` is the API's viewer block (null when logged out).
 */
export default function TournamentChecklist({ tournament, viewer, user, onLogin, onOpenPool, opening, openError }) {
  const { t } = useLang()
  const [registered, setRegistered] = useState(false)
  useEffect(() => {
    try { setRegistered(localStorage.getItem(registeredKey(tournament.id)) === '1') } catch { /* ignore */ }
  }, [tournament.id])
  function toggleRegistered(checked) {
    setRegistered(checked)
    try { localStorage.setItem(registeredKey(tournament.id), checked ? '1' : '0') } catch { /* ignore */ }
  }

  const open = tournament.status === 'upcoming' || tournament.status === 'ongoing'
  const hasPool = !!viewer?.hasPool
  const poolHref = `/tournament/t/${tournament.id}/pool`
  const btn = 'inline-block text-sm px-3 py-1.5 rounded-lg bg-accent hover:bg-accent2 text-on-accent font-semibold transition-colors disabled:opacity-40'
  const btn2 = 'inline-block text-sm px-3 py-1.5 rounded-lg bg-surface3 hover:bg-surface3 text-ink transition-colors'

  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-lg">{t('tournaments.checklistTitle')}</h2>

      <Step n={1} title={t('tournaments.step1Title')} desc={t('tournaments.step1Desc')} done={registered}>
        <div className="flex flex-wrap items-center gap-3">
          <a href={tournament.bgaUrl} target="_blank" rel="noopener noreferrer" className={btn}>{t('tournaments.step1Button')} ↗</a>
          <label className="flex items-center gap-2 text-sm text-ink2 cursor-pointer">
            <input type="checkbox" checked={registered} onChange={e => toggleRegistered(e.target.checked)} className="accent-accent w-4 h-4" />
            {t('tournaments.step1Done')}
          </label>
        </div>
      </Step>

      <Step n={2} title={t('tournaments.step2Title')} desc={t('tournaments.step2Desc')} done={hasPool}>
        {!user ? (
          <button type="button" onClick={onLogin} className={btn}>{t('tournaments.connectToPrepare')}</button>
        ) : hasPool ? (
          <Link to={poolHref} className={btn2}>{t('tournaments.step2ButtonExisting')}</Link>
        ) : open ? (
          <button type="button" onClick={onOpenPool} disabled={opening} className={btn}>
            {opening ? t('tournaments.step2Opening') : t('tournaments.step2Button')}
          </button>
        ) : (
          <p className="text-xs text-muted">{t('tournaments.step2Closed')}</p>
        )}
        {openError && <p className="text-xs text-danger mt-1">{openError}</p>}
      </Step>

      <Step n={3} title={t('tournaments.step3Title')} desc={t('tournaments.step3Desc')} done={!!viewer?.deck?.cardQuantity}>
        {hasPool ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link to={poolHref} className={btn2}>{t('tournaments.step3Button')}</Link>
            <span className="text-xs text-muted">
              {viewer.deck ? t('tournaments.yourDeck', { name: viewer.deck.name, n: viewer.deck.cardQuantity ?? 0 }) : t('tournaments.step3NoDeck')}
            </span>
          </div>
        ) : (
          <p className="text-xs text-faint">{t('tournaments.step3NoDeck')}</p>
        )}
      </Step>
    </section>
  )
}
