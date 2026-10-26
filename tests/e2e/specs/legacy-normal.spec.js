// Acceptance group I — the out-of-tournament normal pool, a legacy row (no stored cards) that
// still regenerates, and the freeze script that stores such rows.
import { execFileSync } from 'node:child_process'
import { test, expect, resetStack } from '../support/fixtures.js'
import { APP_ENV, ROOT_DIR } from '../support/env.js'
import { acceptNextDialog } from '../support/guards.js'
import { t } from '../support/i18n.js'
import { markRevealSeen } from '../support/pages.js'
import { PERSONAS } from '../support/personas.js'

test.describe.configure({ mode: 'serial' })

const ALICE = PERSONAS.alice.sub
let after

const normalPoolCards = async api => Object.keys((await api('alice').get('/api/tournament-normal-pool')).body.cards).sort()

async function openNormal(openAs, api) {
  const pool = (await api('alice').get('/api/tournament-normal-pool')).body
  const page = await openAs('alice')
  await markRevealSeen(page, pool)
  await page.goto('/tournament/normal')
  await expect(page.getByRole('heading', { name: t('tournamentPages.normalTitle') })).toBeVisible()
  return page
}

function freeze() {
  return execFileSync('node', ['scripts/freeze-sealed-pools.mjs'], { cwd: ROOT_DIR, env: { ...process.env, ...APP_ENV }, encoding: 'utf8' })
}

test.beforeAll(async () => {
  await resetStack()
})

test('normal mode: pool, reset, cooldown', { tag: ['@i-normal'] }, async ({ openAs, api, db }) => {
  const page = await openNormal(openAs, api)
  const before = await normalPoolCards(api)
  acceptNextDialog(page) // in case the reset asks for a confirmation
  const reset = page.waitForResponse(r => r.url().includes('/api/tournament-normal-pool') && r.request().method() !== 'GET')
  await page.getByRole('button', { name: t('tournamentPoolView.resetPool') }).click()
  expect((await reset).ok()).toBe(true)
  after = await normalPoolCards(api)
  expect(after).not.toEqual(before)
  const prefix = t('tournamentPoolView.resetAvailableIn', { time: '' }).trim()
  await expect(page.getByRole('button', { name: new RegExp(`^${prefix}`) })).toBeVisible()
  const { rows } = await db.query("SELECT created_by, cards IS NOT NULL AS stored, reset_at FROM sealed_pools WHERE kind = 'normal' AND sub = $1", [ALICE])
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ created_by: 'page', stored: true })
  expect(rows[0].reset_at).not.toBeNull()
})

test('a legacy row without stored cards still regenerates the same pool', { tag: ['@i-legacy-row'] }, async ({ openAs, api, db }) => {
  await db.query("UPDATE sealed_pools SET cards = NULL, boosters = NULL WHERE kind = 'normal' AND sub = $1", [ALICE])
  await openNormal(openAs, api)
  expect(await normalPoolCards(api)).toEqual(after)
})

test('the freeze script stores legacy rows, idempotently', { tag: ['@i-freeze'] }, async ({ db, api }) => {
  await db.query("UPDATE sealed_pools SET cards = NULL, boosters = NULL WHERE kind = 'normal' AND sub = $1", [ALICE])
  expect(freeze()).toContain('frozen 1/1 pools (0 failed)')
  expect(freeze()).toContain('frozen 0/0 pools (0 failed)')
  expect(await normalPoolCards(api)).toEqual(after)
})
