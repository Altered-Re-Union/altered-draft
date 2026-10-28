// Acceptance step j-fr (partial): the French UI shows no raw i18n key and the expected French copy
// on the tournament pages. "No English leftovers" stays a human check.
import { test, expect } from '../support/fixtures.js'
import { t, tFr } from '../support/i18n.js'
import { HUB_PATH, markRevealSeen } from '../support/pages.js'

const RAW_KEY = /\b(tournaments|tournamentPages|tournamentPoolView|packReveal|settingsFields|topNav|reunion|common)\.[A-Za-z.]+\b/

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('French UI: no raw keys, French copy on every tournament page', { tag: ['@j-fr'] }, async ({ openAs, seed }) => {
  const { id } = await seed.tournament('alice')
  const pool = await seed.pool('alice', id)
  const page = await openAs('alice')
  await markRevealSeen(page, pool)
  await page.goto(HUB_PATH)
  await page.getByRole('combobox', { name: t('lang.select') }).selectOption('fr')

  const pages = [
    [HUB_PATH, tFr('tournaments.tabUpcoming')],
    ['/tournament/beta', tFr('tournaments.tabUpcoming')],
    ['/tournament/new', tFr('tournaments.createTitle')],
    [`/tournament/t/${id}`, tFr('tournaments.step2ButtonExisting')],
    [`/tournament/t/${id}/pool`, tFr('tournaments.backToTournament')],
  ]
  for (const [path, sample] of pages) {
    await page.goto(path)
    await expect(page.getByText(sample, { exact: false }).first(), path).toBeVisible()
    await page.waitForLoadState('networkidle')
    expect(await page.locator('body').innerText(), path).not.toMatch(RAW_KEY)
  }
})
