// Acceptance group A — the room Lobby still works after the tournament changes (shared set
// grid, settings fields).
import { test, expect } from '../support/fixtures.js'
import { t } from '../support/i18n.js'
import { startsWith } from '../support/text.js'

const tile = (page, name) => page.getByRole('button', { name })
const next = page => page.getByRole('button', { name: t('lobby.next'), exact: true })
const back = page => page.getByRole('button', { name: t('lobby.back'), exact: true })
const mode = (page, id) => page.getByRole('button', { name: startsWith(t(`lobby.modes.${id}.name`)) })

async function createRoom(page) {
  await page.goto('/')
  await page.getByRole('button', { name: t('home.createRoom') }).click()
  await page.getByPlaceholder(t('home.displayNamePlaceholderAlice')).fill('alice')
  await page.getByRole('button', { name: t('home.createRoomBtn') }).click()
  await page.waitForURL(/\/room\/[A-Z0-9]+$/)
}

async function toSealedSettings(page) {
  await createRoom(page)
  await mode(page, 'sealed').click()
  await next(page).click()
  await tile(page, 'Skybound Odyssey').click()
  await next(page).click()
}

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('set grid: select, deselect, Next', { tag: ['@a-grid'] }, async ({ page }) => {
  await createRoom(page)
  await mode(page, 'sealed').click()
  await next(page).click()
  await expect(page.getByRole('button', { name: t('lobby.tabPresets') })).toBeVisible()
  await expect(tile(page, 'Skybound Odyssey')).toBeVisible()
  await expect(tile(page, 'Beyond the Gates KS')).toHaveCount(0)
  await expect(next(page)).toBeDisabled()
  await tile(page, 'Skybound Odyssey').click()
  await expect(tile(page, 'Skybound Odyssey')).toHaveAttribute('aria-pressed', 'true')
  await expect(next(page)).toBeEnabled()
  await tile(page, 'Skybound Odyssey').click()
  await expect(tile(page, 'Skybound Odyssey')).toHaveAttribute('aria-pressed', 'false')
  await expect(next(page)).toBeDisabled()
})

test('card language row, in sealed then in draft', { tag: ['@a-lang'] }, async ({ page }) => {
  await toSealedSettings(page)
  await expect(page.getByText(t('settingsFields.cardLanguage'))).toBeVisible()
  for (const lang of ['EN', 'FR', 'ES', 'DE', 'IT']) await expect(page.getByRole('button', { name: lang, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(page.getByRole('button', { name: 'FR', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await back(page).click()
  await back(page).click()
  await mode(page, 'booster').click()
  await next(page).click()
  // The set chosen for sealed is kept across the mode change.
  await expect(tile(page, 'Skybound Odyssey')).toHaveAttribute('aria-pressed', 'true')
  await next(page).click()
  await expect(page.getByText(t('settingsFields.cardLanguage'))).toBeVisible()
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('a room sealed still starts', { tag: ['@a-sealed-run'] }, async ({ page }) => {
  await toSealedSettings(page)
  await page.getByRole('button', { name: t('lobby.startSealed') }).click()
  await page.waitForURL(/\/room\/[A-Z0-9]+\/sealed$/)
  await expect.poll(() => page.getByRole('img').count()).toBeGreaterThanOrEqual(13)
})
