// The fixtures every browser spec uses: `test` and `expect` come from here, not from
// @playwright/test. Every context (the default one and those from openAs) gets the network
// rules and the guards; the guard bucket is asserted after the test.
import { test as base, expect } from '@playwright/test'
import { apiAs, makeSeed } from './api.js'
import { loginAs } from './auth.js'
import { closeDb, query, resetDb } from './db.js'
import { fakesDecks, fakesRequests, fakesReset, fakesRevoke, fakesSession } from './fakes-client.js'
import { assertClean, attachGuards, newBucket, pending } from './guards.js'
import { installNetworkRules } from './network.js'

async function guardContext(context, bucket) {
  await installNetworkRules(context, bucket.leaks)
  attachGuards(context, bucket)
}

export const test = base.extend({
  guardBucket: async ({}, use) => {
    await use(newBucket())
  },

  guard: [async ({ guardBucket }, use, testInfo) => {
    await use()
    const left = pending(guardBucket)
    if (!left.length) return
    if (testInfo.status === testInfo.expectedStatus) assertClean(guardBucket)
    testInfo.annotations.push({ type: 'guard', description: left.join('\n') })
  }, { auto: true }],

  context: async ({ context, guardBucket }, use) => {
    await guardContext(context, guardBucket)
    await use(context)
  },

  openAs: async ({ browser, guardBucket, baseURL, locale, timezoneId, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch }, use) => {
    const contexts = []
    await use(async who => {
      const context = await browser.newContext({ baseURL, locale, timezoneId, viewport, userAgent, deviceScaleFactor, isMobile, hasTouch })
      contexts.push(context)
      await guardContext(context, guardBucket)
      if (who) await loginAs(context, who)
      return context.newPage()
    })
    for (const context of contexts) await context.close()
  },

  fakes: async ({}, use) => {
    await use({ reset: fakesReset, revoke: fakesRevoke, session: fakesSession, decks: fakesDecks, requests: fakesRequests })
  },

  db: [async ({}, use) => {
    await use({ query, resetDb })
    await closeDb()
  }, { scope: 'worker' }],

  api: async ({ request }, use) => {
    await use(who => apiAs(request, who))
  },

  seed: async ({ request }, use) => {
    await use(makeSeed(request))
  },
})

export { expect }
