// Pins the browser-side harness: the login fast path and the UI round trip, the renderer
// stub, and the guard fixture that every other spec relies on.
import { test, expect } from '../support/fixtures.js'
import { loginViaUi } from '../support/auth.js'
import { clear, pending } from '../support/guards.js'
import { t } from '../support/i18n.js'

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('fast-path login lands signed in', async ({ openAs }) => {
  const page = await openAs('alice')
  await page.goto('/tournament')
  await expect(page.getByTitle(t('reunion.signedInTitle'))).toBeVisible()
  await expect(page.getByRole('button', { name: t('reunion.connect') })).toHaveCount(0)
})

test('UI login round trip from Home', async ({ page }) => {
  await page.goto('/')
  await loginViaUi(page, 'bob', { from: '/' })
  await expect(page.getByTitle(t('reunion.signedInTitle'))).toBeVisible()
  expect(await page.evaluate(() => document.cookie)).toContain('reunion_auth=1')
})

test('renderer stub paints a stable face', { tag: ['@j-console'] }, async ({ page }) => {
  await page.goto('/')
  const [length, stable] = await page.evaluate(async () => {
    await customElements.whenDefined('altered-card')
    const el = document.createElement('altered-card')
    el.setAttribute('ref', 'ALT_CYCLONE_B_AX_01_U_1')
    document.body.appendChild(el)
    const canvas = el.querySelector('canvas')
    const url = canvas.toDataURL('image/jpeg', 0.85)
    return [url.length, url === canvas.toDataURL('image/jpeg', 0.85)]
  })
  expect(length).toBeGreaterThan(8000)
  expect(stable).toBe(true)
})

test('guards collect leaks, console errors and 5xx', async ({ page, guardBucket }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await fetch('https://example.invalid/x').catch(() => null)
    console.error('boom')
    await fetch('http://localhost:8091/__control/boom').catch(() => null)
  })
  // Chrome also logs a "Failed to load resource" console error for the aborted request and
  // the 500, so more than three entries land in the bucket.
  await expect.poll(() => pending(guardBucket).join('\n')).toMatch(/^500 GET .*__control\/boom/m)
  const entries = pending(guardBucket).join('\n')
  expect(entries).toMatch(/^leak: https:\/\/example\.invalid\/x/m)
  expect(entries).toMatch(/^console: boom/m)
  clear(guardBucket)
})
