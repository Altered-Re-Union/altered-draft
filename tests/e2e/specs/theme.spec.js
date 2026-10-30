// Acceptance step j-theme (partial): the ☀/☾ toggle flips <html data-theme> and the choice persists
// across reloads and pages. A screenshot per page and theme is attached to the report for a
// human glance; contrast stays a human check.
import { test, expect } from '../support/fixtures.js'
import { t } from '../support/i18n.js'
import { HUB_PATH, markRevealSeen } from '../support/pages.js'

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('the theme toggle flips and persists on the tournament pages', { tag: ['@j-theme'] }, async ({ openAs, seed }, testInfo) => {
  const { id } = await seed.tournament('alice')
  const pool = await seed.pool('alice', id)
  const page = await openAs('alice')
  await markRevealSeen(page, pool)
  const html = page.locator('html')
  const shoot = async (name, theme) => testInfo.attach(`${name}-${theme}.png`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })

  for (const [name, path] of [['menu', HUB_PATH], ['form', '/tournament/new'], ['detail', `/tournament/t/${id}`]]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const before = await html.getAttribute('data-theme')
    await shoot(name, before)
    await page.getByRole('button', { name: t('theme.toggle') }).click()
    const after = before === 'light' ? 'dark' : 'light'
    await expect(html).toHaveAttribute('data-theme', after)
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', after)
    await page.waitForLoadState('networkidle')
    await shoot(name, after)
  }
  const last = await html.getAttribute('data-theme')
  await page.goto(`/tournament/t/${id}/pool`)
  await expect(html).toHaveAttribute('data-theme', last)
})
