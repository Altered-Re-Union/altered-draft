// Recette group C — the tournament page, anonymous and as its organizer.
import { test, expect } from '../support/fixtures.js'
import { t, tc } from '../support/i18n.js'

let id

test.beforeEach(async ({ db, fakes, seed }) => {
  await db.resetDb()
  await fakes.reset()
  id = (await seed.tournament('alice')).id
})

test('anonymous view', { tag: ['@c-anon'] }, async ({ page }) => {
  await page.goto(`/tournament/t/${id}`)
  await expect(page.getByRole('heading', { name: 'Test cup' })).toBeVisible()
  await expect(page.getByTestId('tournament-status')).toHaveText(t('tournaments.statusUpcoming'))
  await expect(page.getByText(t('tournaments.organizedBy', { name: 'alice' }))).toBeVisible()
  await expect(page.getByText(tc('tournaments.poolsPrepared', 0))).toBeVisible()
  await expect(page.getByTestId('tournament-summary')).toHaveText(
    `${t('tournaments.summaryBoosters', { n: 7, set: 'Skybound Odyssey' })} · ${tc('tournaments.summaryUniquesIn', 1)} · ${tc('tournaments.summaryUniquesOut', 1)}`)
  expect(await page.getByText('Line one').innerText()).toContain('Line one\nLine two')
  await expect(page.getByRole('button', { name: t('tournaments.connectToPrepare') })).toBeVisible()
  await expect(page.getByTestId('organizer-panel')).toHaveCount(0)
})

test('step 1: the BGA link and the remembered registration', { tag: ['@c-step1'] }, async ({ page }) => {
  await page.goto(`/tournament/t/${id}`)
  // Attributes only: following the link would leave localhost.
  const link = page.getByRole('link', { name: t('tournaments.step1Button') })
  await expect(link).toHaveAttribute('href', 'https://boardgamearena.com/tournament?id=123456')
  await expect(link).toHaveAttribute('target', '_blank')
  await page.getByLabel(t('tournaments.step1Done')).check()
  await page.reload()
  await expect(page.getByLabel(t('tournaments.step1Done'))).toBeChecked()
  await expect(page.getByTestId('checklist-step-1')).toHaveAttribute('data-done', 'true')
  expect(await page.evaluate(key => localStorage.getItem(key), `tournament_bga_registered:${id}`)).not.toBeNull()
})

test('organizer panel', { tag: ['@c-organizer'] }, async ({ openAs }) => {
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}`)
  const panel = page.getByTestId('organizer-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText(t('tournaments.poolsByOrigin', { page: 0, bga: 0 }))
  await expect(panel.getByRole('link', { name: t('tournaments.edit') })).toBeVisible()
  for (const key of ['cancel', 'close', 'delete']) await expect(panel.getByRole('button', { name: t(`tournaments.${key}`) })).toBeEnabled()
  await expect(panel.getByRole('button', { name: t('tournaments.detach') })).toHaveCount(0)
})

test('unknown tournament: not found, never a server error', { tag: ['@c-404'] }, async ({ page, api }) => {
  for (const unknown of ['00000000-0000-0000-0000-000000000000', 'nope']) {
    await page.goto(`/tournament/t/${unknown}`)
    await expect(page.getByText(t('tournaments.notFound'))).toBeVisible()
    expect((await api(null).get(`/api/tournaments/${unknown}`)).status, unknown).toBe(404)
  }
})
