// Cross-cutting guards (recette j-console, applied to every test): console errors, page
// errors, HTTP >= 500 and non-localhost leaks, collected across every page of a context.
// The fixture fails the test on anything not in ALLOWED_NOISE — adding to it is a reviewed
// change. Plus a few page helpers.
import { expect } from '@playwright/test'

export const ALLOWED_NOISE = [
  // Chrome logs every 4xx fetch as a console error. 4xx answers are normal flows here (a
  // session that expired, a tournament not found, a BGA link already declared); 5xx are
  // caught separately, from the responses themselves.
  /^console: Failed to load resource: the server responded with a status of 4\d\d /,
]

export function newBucket() {
  return { consoleErrors: [], pageErrors: [], serverErrors: [], leaks: [] }
}

export function attachGuards(context, bucket) {
  const watchPage = page => {
    page.on('console', msg => {
      if (msg.type() === 'error') bucket.consoleErrors.push(`console: ${msg.text()} (${page.url()})`)
    })
    page.on('pageerror', err => bucket.pageErrors.push(`pageerror: ${err.message} (${page.url()})`))
  }
  context.pages().forEach(watchPage)
  context.on('page', watchPage)
  context.on('response', res => {
    if (res.status() >= 500) bucket.serverErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`)
  })
}

export function pending(bucket) {
  const all = [...bucket.consoleErrors, ...bucket.pageErrors, ...bucket.serverErrors, ...bucket.leaks.map(url => `leak: ${url}`)]
  return all.filter(entry => !ALLOWED_NOISE.some(re => re.test(entry)))
}

export function assertClean(bucket) {
  const left = pending(bucket)
  if (left.length) throw new Error(`guard: ${left.length} unexpected event(s)\n  ${left.join('\n  ')}`)
}

export function clear(bucket) {
  for (const key of Object.keys(bucket)) bucket[key].length = 0
}

export async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, 'horizontal page scroll').toBeLessThanOrEqual(0)
}

export function acceptNextDialog(page) {
  page.once('dialog', dialog => dialog.accept())
}

export function captureNextDialog(page) {
  return new Promise(resolve => {
    page.once('dialog', async dialog => {
      resolve(dialog.message())
      await dialog.dismiss()
    })
  })
}
