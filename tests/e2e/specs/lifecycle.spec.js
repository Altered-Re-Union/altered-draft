// Acceptance group E — the organizer edits the tournament and walks it through its lifecycle
// (cancel / restore, close / reopen, delete), and strangers cannot edit it.
import { test, expect, resetStack } from '../support/fixtures.js'
import { withRequestContext } from '../support/api.js'
import { loginViaUi } from '../support/auth.js'
import { isoDaysFromNow, localDateTime } from '../support/dates.js'
import { acceptNextDialog } from '../support/guards.js'
import { t } from '../support/i18n.js'
import { openMenu, openPoolPage, tournamentLink } from '../support/pages.js'

test.describe.configure({ mode: 'serial' })

const BGA_URL = 'https://fr.boardgamearena.com/tournament/?id=123456'
const SET_NAMES = ['Beyond the Gates', 'Trial by Frost', 'Whisper from the Maze', 'Skybound Odyssey', 'Seeds of Unity', 'Roots of Corruption', 'Neverending Journey']

let id
let nejId

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const pill = page => page.getByTestId('tournament-status')
const panel = page => page.getByTestId('organizer-panel')

async function openEdit(openAs, tournamentId = id) {
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${tournamentId}/edit`)
  await expect(page.getByRole('heading', { name: t('tournaments.editTitle') })).toBeVisible()
  return page
}

async function save(page, tournamentId = id) {
  await page.getByRole('button', { name: t('tournaments.submitSave') }).click()
  await page.waitForURL(`**/tournament/t/${tournamentId}`)
}

async function rename(openAs, name) {
  const page = await openEdit(openAs)
  await field(page, 'nameLabel').fill(name)
  await save(page)
  return page
}

async function openDetail(openAs, who, tournamentId = id) {
  const page = await openAs(who)
  await page.goto(`/tournament/t/${tournamentId}`)
  await expect(pill(page)).toBeVisible()
  return page
}

test.beforeAll(async ({ playwright }) => {
  await resetStack()
  await withRequestContext(playwright.request, async seed => {
    id = (await seed.tournament('alice')).id
    await seed.pool('alice', id)
    await seed.pool('bob', id)
    nejId = (await seed.tournament('alice', {
      name: 'NEJ cup',
      bgaUrl: 'https://boardgamearena.com/tournament?id=123458',
      config: { source: { type: 'set', setCode: 'FUGUE' }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null }, excludeBanlist: false },
    })).id
  })
})

test('editing is locked once pools exist', { tag: ['@e-locked'] }, async ({ openAs }) => {
  const page = await openEdit(openAs)
  await expect(page.getByText(t('tournaments.lockedNotice'))).toBeVisible()
  for (const set of SET_NAMES) await expect(page.getByRole('button', { name: set }), set).toBeDisabled()
  await expect(field(page, 'bgaUrlLabel')).toBeDisabled()
  for (const which of ['uniques-in-boosters', 'uniques-guaranteed']) {
    for (const button of await page.getByTestId(which).getByRole('button').all()) await expect(button).toBeDisabled()
  }
  for (const key of ['nameLabel', 'descriptionLabel', 'startsAtLabel', 'endsAtLabel']) await expect(field(page, key), key).toBeEnabled()
})

test('a rename reaches the players\' pools', { tag: ['@e-rename'] }, async ({ openAs, seed }) => {
  await rename(openAs, 'Test cup renamed')
  await openPoolPage({ openAs, seed }, 'alice', id, 'Test cup renamed')
  const bob = await openPoolPage({ openAs, seed }, 'bob', id, 'Test cup renamed')
  await openMenu(bob, '?tab=pools')
  await expect(tournamentLink(bob, 'Test cup renamed')).toBeVisible()
  await rename(openAs, 'Test cup')
})

test('crossed dates are refused', { tag: ['@e-dates'] }, async ({ openAs }) => {
  let page = await openEdit(openAs)
  await field(page, 'endsAtLabel').fill(localDateTime(10))
  await save(page)
  page = await openEdit(openAs)
  await field(page, 'startsAtLabel').fill(localDateTime(1))
  await field(page, 'endsAtLabel').fill(localDateTime(1, '19:00'))
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errEndsAt') })).toBeVisible()
  await expect(page.getByRole('button', { name: t('tournaments.submitSave') })).toBeDisabled()
})

test('a start moved past the stored end says "must be before the end"', { tag: ['@e-dates'] }, async ({ openAs }) => {
  const page = await openEdit(openAs)
  await field(page, 'startsAtLabel').fill(localDateTime(11))
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errStartsAtBeforeEnd') })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errEndsAt') })).toHaveCount(0)
})

test('relinking to a declared BGA tournament is a field error', { tag: ['@e-relink-taken'] }, async ({ openAs }) => {
  const page = await openEdit(openAs, nejId)
  await field(page, 'bgaUrlLabel').fill(BGA_URL)
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errBgaTaken') })).toBeVisible()
  await expect(page.getByText(t('tournaments.errGeneric', { msg: '' }).trim())).toHaveCount(0)
})

test('cancel closes pool creation, editing still works, restore', { tag: ['@e-cancel'] }, async ({ openAs, seed }) => {
  const alice = await openDetail(openAs, 'alice')
  acceptNextDialog(alice)
  await panel(alice).getByRole('button', { name: t('tournaments.cancel') }).click()
  await expect(pill(alice)).toHaveText(t('tournaments.statusCancelled'))

  const carol = await openDetail(openAs, 'carol')
  await expect(carol.getByText(t('tournaments.step2Closed'))).toBeVisible()
  await openPoolPage({ openAs, seed }, 'alice', id)
  await openPoolPage({ openAs, seed }, 'bob', id)

  await rename(openAs, 'Cancelled cup')
  const page = await rename(openAs, 'Test cup')
  await expect(pill(page)).toHaveText(t('tournaments.statusCancelled'))
  await panel(page).getByRole('button', { name: t('tournaments.restore') }).click()
  await expect(pill(page)).toHaveText(t('tournaments.statusUpcoming'))
})

test('close, then reopen', { tag: ['@e-close'] }, async ({ openAs, page }) => {
  const alice = await openDetail(openAs, 'alice')
  await panel(alice).getByRole('button', { name: t('tournaments.close') }).click()
  await expect(pill(alice)).toHaveText(t('tournaments.statusEnded'))
  for (const tab of ['upcoming', 'ongoing']) {
    await openMenu(page, `?tab=${tab}`)
    await expect(tournamentLink(page, 'Test cup'), tab).toHaveCount(0)
  }
  await panel(alice).getByRole('button', { name: t('tournaments.reopen') }).click()
  await expect(pill(alice)).toHaveText(t('tournaments.statusUpcoming'))
})

const PAST = "UPDATE tournaments SET starts_at = now() - interval '3 days', ends_at = now() - interval '1 day' WHERE name = 'Test cup'"

test('reopening a tournament whose end is past', { tag: ['@e-reopen-past'] }, async ({ openAs, db, api }) => {
  await db.query(PAST)
  const page = await openDetail(openAs, 'alice')
  await expect(pill(page)).toHaveText(t('tournaments.statusEnded'))
  await panel(page).getByRole('button', { name: t('tournaments.reopen') }).click()
  await expect(pill(page)).toHaveText(t('tournaments.statusOngoing'))
  expect((await api('alice').get(`/api/tournaments/${id}`)).body.endsAt).toBeNull()
  // Back to upcoming for the next steps.
  expect((await api('alice').patch(`/api/tournaments/${id}`, { startsAt: isoDaysFromNow(1) })).status).toBe(200)
})

test('delete a tournament without pools; not one with pools', { tag: ['@e-delete'] }, async ({ openAs }) => {
  const page = await openDetail(openAs, 'alice', nejId)
  acceptNextDialog(page)
  await panel(page).getByRole('button', { name: t('tournaments.delete') }).click()
  await page.waitForURL(/\/tournament$/)
  await openMenu(page, '?tab=created')
  await expect(tournamentLink(page, 'Test cup')).toBeVisible()
  await expect(tournamentLink(page, 'NEJ cup')).toHaveCount(0)
  await page.goto(`/tournament/t/${id}`)
  await expect(panel(page).getByRole('button', { name: t('tournaments.delete') })).toBeDisabled()
})

test('a stranger never sees the edit form', { tag: ['@e-stranger'] }, async ({ openAs }) => {
  const page = await openAs('carol')
  await page.addInitScript(() => {
    new MutationObserver(() => { if (document.getElementById('tn-name')) window.__sawForm = true })
      .observe(document, { childList: true, subtree: true })
  })
  await page.goto(`/tournament/t/${id}/edit`)
  await page.waitForURL(`**/tournament/t/${id}`)
  await expect(page.getByRole('heading', { name: 'Test cup', exact: true })).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
  expect(await page.evaluate(() => window.__sawForm)).toBeUndefined()
})

test('editing while logged out asks to connect, then comes back', { tag: ['@e-edit-anon'] }, async ({ page }) => {
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(page.getByRole('button', { name: t('reunion.connect') }).first()).toBeVisible()
  expect(page.url()).toMatch(/\/edit$/)
  await loginViaUi(page, 'alice', { from: `/tournament/t/${id}/edit` })
  await expect(field(page, 'nameLabel')).toHaveValue('Test cup')
})
