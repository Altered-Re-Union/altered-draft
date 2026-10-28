// Acceptance group D — a player's pool for a declared tournament: the first-open reveal, the
// deck saved on decks-api, the pool kept across reloads, and one deck only under quick edits.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect, resetStack } from '../support/fixtures.js'
import { withRequestContext } from '../support/api.js'
import { ROOT_DIR } from '../support/env.js'
import { HUB_PATH, openPoolPage, tournamentLink } from '../support/pages.js'
import { PERSONAS } from '../support/personas.js'
import { t, tc } from '../support/i18n.js'

test.describe.configure({ mode: 'serial' })

const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'tests/e2e/fixtures/cards/CYCLONE/CYCLONE_EN.json'), 'utf8'))
const BY_REF = new Map(FIXTURE.map(c => [c.reference, c]))

function classify(ref) {
  if (ref.includes('_U_')) return 'unique'
  const card = BY_REF.get(ref)
  if (card?.cardType.reference === 'HERO') return 'hero'
  return card?.rarity.reference === 'COMMON' ? 'common' : 'rare'
}
const uniquesOf = refs => refs.filter(r => r.includes('_U_'))

let id

test.beforeAll(async ({ playwright }) => {
  await resetStack()
  await withRequestContext(playwright.request, async seed => { id = (await seed.tournament('alice')).id })
})

test('opening the pool: 7 boosters and the guaranteed unique', { tag: ['@d-open'] }, async ({ openAs, seed }) => {
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}`)
  await page.getByRole('button', { name: t('tournaments.step2Button') }).click()
  await page.waitForURL(`**/tournament/t/${id}/pool`)
  await expect(page.getByRole('heading', { name: t('packReveal.openingYourPool') })).toBeVisible()
  await expect(page.getByText(t('packReveal.boosterOf', { n: 1, total: 8 })).first()).toBeVisible()
  for (let n = 2; n <= 8; n++) {
    await page.getByRole('button', { name: t('packReveal.nextBooster') }).dispatchEvent('click')
    await expect(page.getByText(t('packReveal.boosterOf', { n, total: 8 })).first()).toBeVisible()
  }
  await expect(page.getByText(t('packReveal.guaranteedUnique')).first()).toBeVisible()
  await page.getByRole('button', { name: t('packReveal.seeFullPool') }).last().dispatchEvent('click')
  await expect(page.getByRole('heading', { name: 'Test cup' })).toBeVisible()
  await expect(page.getByRole('link', { name: t('tournaments.backToTournament') })).toBeVisible()

  const pool = await seed.pool('alice', id)
  expect(pool.boosters).toHaveLength(7)
  for (const booster of pool.boosters) {
    expect(booster).toHaveLength(13)
    const kinds = booster.map(classify)
    expect(kinds.filter(k => k === 'hero')).toHaveLength(1)
    expect(kinds.filter(k => k === 'common')).toHaveLength(9)
    expect(kinds.filter(k => k === 'rare' || k === 'unique')).toHaveLength(3)
  }
  expect(uniquesOf(pool.boosters.flat())).toHaveLength(1)
  expect(uniquesOf(Object.keys(pool.cards))).toHaveLength(2)
})

test('back on the tournament page', { tag: ['@d-back'] }, async ({ openAs, seed }) => {
  const page = await openPoolPage({ openAs, seed }, 'alice', id)
  await page.getByRole('link', { name: t('tournaments.backToTournament') }).click()
  await expect(page.getByTestId('checklist-step-2')).toHaveAttribute('data-done', 'true')
  await expect(page.getByRole('link', { name: t('tournaments.step2ButtonExisting') })).toBeVisible()
  const panel = page.getByTestId('organizer-panel')
  await expect(panel).toContainText(t('tournaments.poolsByOrigin', { page: 1, bga: 0 }))
  await expect(page.getByText(tc('tournaments.poolsPrepared', 1))).toBeVisible()
  const del = panel.getByRole('button', { name: t('tournaments.delete') })
  await expect(del).toBeDisabled()
  await expect(del).toHaveAttribute('title', t('tournaments.deleteBlocked'))
})

test('a random deck is saved on decks-api', { tag: ['@d-deck'] }, async ({ openAs, seed, fakes }) => {
  const page = await openPoolPage({ openAs, seed }, 'alice', id)
  const linked = page.waitForResponse(r => r.url().includes('/api/tournament-pool?id=') && r.request().method() === 'POST')
  await page.getByRole('button', { name: t('tournamentPoolView.makeRandomDeck') }).click()
  expect((await linked).ok()).toBe(true)
  await page.getByRole('link', { name: t('tournaments.backToTournament') }).click()
  await expect(page.getByTestId('checklist-step-3')).toHaveAttribute('data-done', 'true')
  await expect(page.getByText(t('tournaments.yourDeck', { name: 'Test cup', n: 30 }))).toBeVisible()
  const decks = await fakes.decks('alice')
  expect(decks).toHaveLength(1)
  expect(decks[0]).toMatchObject({ format: 'sealed', isDraft: false })
  expect(decks[0].deckCards.reduce((n, c) => n + c.quantity, 0)).toBeGreaterThanOrEqual(30)
})

test('the same pool across reloads and from the menu', { tag: ['@d-same'] }, async ({ openAs, seed, db }) => {
  const before = Object.keys((await seed.pool('alice', id)).cards).sort()
  const page = await openPoolPage({ openAs, seed }, 'alice', id)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Test cup' })).toBeVisible()
  expect(Object.keys((await seed.pool('alice', id)).cards).sort()).toEqual(before)

  await page.goto(HUB_PATH)
  await page.getByRole('tab', { name: t('tournaments.tabPools') }).click()
  await tournamentLink(page, 'Test cup').click()
  await page.waitForURL(`**/tournament/t/${id}`)
  await page.goBack()
  await page.getByRole('link', { name: t('tournamentPages.changeMyDeck') }).first().click()
  await page.waitForURL(`**/tournament/t/${id}/pool`)

  const { rows } = await db.query('SELECT sub, created_by, tournament_id, tournament_name FROM sealed_pools WHERE tournament_ref IS NOT NULL')
  expect(rows).toEqual([{ sub: PERSONAS.alice.sub, created_by: 'page', tournament_id: '123456', tournament_name: 'Test cup' }])
})

test('another player gets another pool', { tag: ['@d-bob'] }, async ({ openAs, seed }) => {
  const page = await openAs('bob')
  await page.goto(`/tournament/t/${id}`)
  await page.getByRole('button', { name: t('tournaments.step2Button') }).click()
  await page.waitForURL(`**/tournament/t/${id}/pool`)
  const bob = Object.keys((await seed.pool('bob', id)).cards).sort()
  const alice = Object.keys((await seed.pool('alice', id)).cards).sort()
  expect(bob).not.toEqual(alice)
  const alicePage = await openAs('alice')
  await alicePage.goto(`/tournament/t/${id}`)
  await expect(alicePage.getByText(tc('tournaments.poolsPrepared', 2))).toBeVisible()
})

test('quick edits right after Make random deck create one deck only', { tag: ['@d-one-deck'] }, async ({ openAs, fakes, seed }) => {
  const page = await openPoolPage({ openAs, seed }, 'bob', id)
  await page.getByRole('button', { name: t('tournamentPoolView.makeRandomDeck') }).click()
  // Three quick edits on whichever cards can take them (a card already at its pool count
  // has its + disabled).
  const plus = page.getByRole('button', { name: '+', exact: true, disabled: false }).first()
  const minus = page.getByRole('button', { name: '−', exact: true, disabled: false }).first()
  await plus.click()
  await minus.click()
  await plus.click()
  // The product throttles the deck sync to one call per 2 s: wait past it.
  await page.waitForTimeout(5000)
  const decks = await fakes.decks('bob')
  expect(decks).toHaveLength(1)
  const posts = (await fakes.requests()).filter(r => r.method === 'POST' && r.path === '/api/decks' && r.sub === PERSONAS.bob.sub)
  expect(posts).toHaveLength(1)
  await page.reload()
  const pool = await seed.pool('bob', id)
  expect(pool.deck.cardQuantity).toBe(decks[0].deckCards.reduce((n, c) => n + c.quantity, 0))
})
