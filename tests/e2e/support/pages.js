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

// Where the tournaments hub lives. During the beta it is hidden at /tournament/beta while
// /tournament keeps the legacy menu (acceptance step h-beta); the unmasking PR moves it back.
export const HUB_PATH = '/tournament/beta'

// The hub's own pages come back to the hub (after a delete, the "← Tournaments" link).
export const waitForHub = page => page.waitForURL(new RegExp(`${escapeRegExp(HUB_PATH)}$`))

// The tournaments hub on a given tab, once its lists are in: the tab panel renders at once
// with "Loading…" while the session check and the list requests run, so an absence check
// made earlier would pass on an empty panel.
export async function openMenu(page, query = '') {
  await page.goto(`${HUB_PATH}${query}`)
  const panel = page.getByRole('tabpanel')
  await expect(panel).toBeVisible()
  await expect(panel.getByText(t('tournaments.loading'))).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  return panel
}
