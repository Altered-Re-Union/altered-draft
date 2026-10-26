// Page helpers shared by several specs.
import { expect } from '@playwright/test'
import { t } from './i18n.js'
import { escapeRegExp } from './text.js'

const STATUS_LABELS = ['statusUpcoming', 'statusOngoing', 'statusEnded', 'statusCancelled', 'statusDetached'].map(k => t(`tournaments.${k}`))

// A tournament card of the menu, by tournament name. Public cards are one link whose name is
// the whole card ("Test cup Upcoming Starts …"); cards with a "Change my deck" button carry
// an aria-label that is exactly the title. Matches both, never "Test cup renamed" for "Test cup".
export function tournamentLink(scope, name) {
  return scope.getByRole('link', { name: new RegExp(`^${escapeRegExp(name)}(?: (?:${STATUS_LABELS.map(escapeRegExp).join('|')})\\b.*)?$`) })
}

// The first-open pack reveal shows once per pool and browser (TournamentPoolView.jsx's
// revealKey in localStorage). Specs that are not about it mark it seen before the page loads.
export async function markRevealSeen(page, pool) {
  await page.addInitScript(key => localStorage.setItem(key, '1'), `pool_reveal_seen:${pool.id}:${pool.resetAt ?? ''}`)
}

// `who`'s pool page for a declared tournament, reveal skipped, waiting for the title.
export async function openPoolPage({ openAs, seed }, who, tournamentId, title = 'Test cup') {
  const pool = await seed.pool(who, tournamentId)
  const page = await openAs(who)
  await markRevealSeen(page, pool)
  await page.goto(`/tournament/t/${tournamentId}/pool`)
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
  return page
}
