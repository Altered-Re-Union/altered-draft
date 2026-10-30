// Acceptance group H — the /tournament hub: "my ongoing tournaments", the four tabs and their
// URL, "My pools" (with g-carol-menu), "My created tournaments", and the generic prep path.
import { test, expect, resetStack } from '../support/fixtures.js'
import { withRequestContext } from '../support/api.js'
import { isoDaysFromNow, localDateTime } from '../support/dates.js'
import { KEYCLOAK_ISSUER } from '../support/env.js'
import { acceptNextDialog, expectNoHorizontalScroll } from '../support/guards.js'
import { t, tc } from '../support/i18n.js'
import { HUB_PATH, openMenu, tournamentLink } from '../support/pages.js'
import { escapeRegExp, startsWith } from '../support/text.js'

test.describe.configure({ mode: 'serial' })

const AUTUMN = 'Coupe d’automne — Skybound Odyssey'
const bga = id => `https://boardgamearena.com/tournament?id=${id}`
let testCup
let autumn
let legacyPoolId

const tab = (page, key) => page.getByRole('tab', { name: startsWith(t(`tournaments.${key}`)) })
const panel = page => page.getByRole('tabpanel')
const myOngoing = page => page.getByTestId('my-ongoing')
const changeMyDeck = scope => scope.getByRole('link', { name: t('tournamentPages.changeMyDeck') })

// Card links of the open tab, without the "Change my deck" buttons.
async function cardLinks(page) {
  const links = await panel(page).getByRole('link').all()
  const out = []
  for (const link of links) {
    const name = await link.getAttribute('aria-label') ?? (await link.innerText()).split('\n')[0]
    if (name !== t('tournamentPages.changeMyDeck')) out.push({ name, href: await link.getAttribute('href') })
  }
  return out
}

async function tabCount(page, key) {
  const text = await tab(page, key).innerText()
  return Number(/(\d+)\s*$/.exec(text)?.[1])
}

test.beforeAll(async ({ playwright }) => {
  await resetStack()
  await withRequestContext(playwright.request, async (seed, api) => {
    testCup = await seed.tournament('alice')
    await api('alice').patch(`/api/tournaments/${testCup.id}`, { startsAt: isoDaysFromNow(-1) })
    await seed.pool('carol', testCup.id)
    autumn = await seed.tournament('alice', { name: AUTUMN, bgaUrl: bga(610001) })
    await seed.pool('alice', autumn.id)
    await seed.bgaDecklist('carol', { tournamentId: '610001', tournamentName: 'X', gameId: 'g1' })
    await seed.bgaDecklist('carol', { tournamentId: '424242', tournamentName: 'Legacy cup', gameId: 'g3' })
    legacyPoolId = (await api('carol').get('/api/tournament-bound-pools')).body.pools.find(p => p.tournamentId === '424242').id
    await seed.tournament('bob', { name: 'Bob cup', bgaUrl: bga(620001) })
    const old = await seed.tournament('alice', { name: 'Old cup', bgaUrl: bga(630001) })
    await api('alice').patch(`/api/tournaments/${old.id}`, { action: 'close' })
    const dropped = await seed.tournament('alice', { name: 'Dropped cup', bgaUrl: bga(640001) })
    await api('alice').patch(`/api/tournaments/${dropped.id}`, { action: 'cancel' })
  })
})

test('logged out: public tabs, personal tabs ask to connect', { tag: ['@h-anon'] }, async ({ page }) => {
  await openMenu(page)
  await expect(myOngoing(page)).toHaveCount(0)
  await expect(tab(page, 'tabUpcoming')).toHaveAttribute('aria-selected', 'true')
  await expect(panel(page)).toContainText(t('tournaments.tabUpcomingHint'))
  expect(await tabCount(page, 'tabUpcoming')).toBe(2) // Coupe d’automne and Bob cup
  await tournamentLink(panel(page), AUTUMN).click()
  await page.waitForURL(`**/tournament/t/${autumn.id}`)
  await page.goBack()

  await tab(page, 'tabOngoing').click()
  await expect(panel(page)).toContainText(t('tournaments.tabOngoingHint'))
  await expect(tournamentLink(panel(page), 'Test cup')).toBeVisible()
  for (const key of ['tabPools', 'tabCreated']) {
    await tab(page, key).click()
    await expect(panel(page).getByRole('button', { name: t('reunion.connect') }), key).toBeVisible()
  }
  await page.getByRole('button', { name: t('tournaments.createButton') }).click()
  await page.waitForURL(url => url.href.startsWith(`${KEYCLOAK_ISSUER}/protocol/openid-connect/auth`))
})

test('"my ongoing tournaments": card, back, direct deck button', { tag: ['@h-my-ongoing'] }, async ({ openAs }) => {
  const carol = await openAs('carol')
  await openMenu(carol)
  await myOngoing(carol).getByRole('link', { name: 'Test cup', exact: true }).click()
  await carol.waitForURL(`**/tournament/t/${testCup.id}`)
  await carol.goBack()
  await expect(myOngoing(carol)).toBeVisible()
  await expect(tab(carol, 'tabUpcoming')).toHaveAttribute('aria-selected', 'true')
  await changeMyDeck(myOngoing(carol)).click()
  await carol.waitForURL(`**/tournament/t/${testCup.id}/pool`)

  const bob = await openAs('bob')
  await openMenu(bob)
  await expect(myOngoing(bob)).toHaveCount(0)
})

test('the tab lives in the URL; counters match the cards', { tag: ['@h-tabs-url'] }, async ({ openAs }) => {
  const page = await openAs('carol')
  await openMenu(page)
  await tab(page, 'tabPools').click()
  await expect(page).toHaveURL(/\?tab=pools$/)
  await page.reload()
  await expect(tab(page, 'tabPools')).toHaveAttribute('aria-selected', 'true')
  await openMenu(page, '?tab=created')
  await expect(tab(page, 'tabCreated')).toHaveAttribute('aria-selected', 'true')
  await openMenu(page, '?tab=nope')
  await expect(tab(page, 'tabUpcoming')).toHaveAttribute('aria-selected', 'true')
  for (const key of ['tabUpcoming', 'tabOngoing', 'tabPools', 'tabCreated']) {
    await tab(page, key).click()
    await page.waitForLoadState('networkidle')
    expect((await cardLinks(page)).length, key).toBe(await tabCount(page, key))
  }
})

test('"my pools": declared first, card and deck links', { tag: ['@h-pools'] }, async ({ openAs }) => {
  const page = await openAs('carol')
  await openMenu(page, '?tab=pools')
  await expect(panel(page)).toContainText(t('tournaments.tabPoolsHint'))
  const cards = await cardLinks(page)
  const deckHrefs = await Promise.all((await changeMyDeck(panel(page)).all()).map(l => l.getAttribute('href')))
  // Declared tournaments first (their order between them is not specified), legacy last.
  expect(cards.slice(0, 2).map(c => c.name).sort()).toEqual([AUTUMN, 'Test cup'].sort())
  expect(cards[2]).toEqual({ name: 'Legacy cup', href: `/tournament/pools/${legacyPoolId}` })
  const expected = { 'Test cup': testCup.id, [AUTUMN]: autumn.id }
  cards.slice(0, 2).forEach((card, i) => {
    expect(card.href).toBe(`/tournament/t/${expected[card.name]}`)
    expect(deckHrefs[i]).toBe(`/tournament/t/${expected[card.name]}/pool`)
  })
  expect(deckHrefs[2]).toBe(`/tournament/pools/${legacyPoolId}`)
  await panel(page).getByRole('link', { name: 'Test cup', exact: true }).click()
  await page.waitForURL(`**/tournament/t/${testCup.id}`)
  await openMenu(page, '?tab=pools')
  await panel(page).getByRole('link', { name: 'Legacy cup', exact: true }).click()
  await page.waitForURL(`**/tournament/pools/${legacyPoolId}`)
  await openMenu(page, '?tab=pools')
  await expect(panel(page).getByRole('heading', { name: t('tournaments.genericPrepTitle') })).toBeVisible()
  await panel(page).getByRole('button', { name: t('tournamentPages.prepareNext') }).click()
  await page.waitForURL('**/tournament/prep')
})

test('carol\'s "My pools" card of a BGA-created pool', { tag: ['@g-carol-menu'] }, async ({ openAs }) => {
  const page = await openAs('carol')
  await openMenu(page, '?tab=pools')
  await expect(panel(page).getByTestId('tournament-status')).toHaveCount(2)
  await expect(panel(page)).toContainText(`Random ${AUTUMN} · ${tc('tournamentPages.cardsInDeck', 30)}`)
  const index = (await cardLinks(page)).findIndex(c => c.name === AUTUMN)
  await changeMyDeck(panel(page)).nth(index).click()
  await page.waitForURL(`**/tournament/t/${autumn.id}/pool`)
})

test('"my pools" order: declared before legacy', { tag: ['@h-order'] }, async ({ seed, openAs }) => {
  await seed.bgaDecklist('carol', { tournamentId: '434343', tournamentName: 'Legacy cup 2', gameId: 'g5' })
  const page = await openAs('carol')
  await openMenu(page, '?tab=pools')
  const names = (await cardLinks(page)).map(c => c.name)
  expect(names.slice(0, 2).sort()).toEqual([AUTUMN, 'Test cup'].sort())
  expect(names.slice(2).sort()).toEqual(['Legacy cup', 'Legacy cup 2'])
})

test('"my created tournaments": active first, archive folded', { tag: ['@h-created'] }, async ({ openAs, page, api }) => {
  const alice = await openAs('alice')
  await openMenu(alice, '?tab=created')
  const headings = panel(alice).getByRole('heading', { level: 3 })
  await expect(headings.nth(0)).toHaveText(new RegExp(`^${t('tournaments.groupOngoing')} 1$`))
  await expect(headings.nth(1)).toHaveText(new RegExp(`^${t('tournaments.groupUpcoming')} 1$`))
  const summary = panel(alice).getByText(t('tournaments.createdArchive', { n: 2 }))
  await expect(panel(alice).getByRole('heading', { name: startsWith(t('tournaments.groupEnded')) })).toBeHidden()
  await summary.focus()
  await alice.keyboard.press('Enter')
  await expect(panel(alice).getByRole('heading', { name: startsWith(t('tournaments.groupEnded')) })).toBeVisible()
  await expect(panel(alice).getByRole('heading', { name: startsWith(t('tournaments.groupCancelled')) })).toBeVisible()
  await expect(tournamentLink(panel(alice), 'Bob cup')).toHaveCount(0)

  await alice.goto(`/tournament/t/${autumn.id}`)
  acceptNextDialog(alice)
  await alice.getByTestId('organizer-panel').getByRole('button', { name: t('tournaments.cancel') }).click()
  await expect(alice.getByTestId('tournament-status')).toHaveText(t('tournaments.statusCancelled'))
  await openMenu(alice, '?tab=created')
  await expect(panel(alice).getByRole('heading', { name: startsWith(t('tournaments.groupUpcoming')) })).toHaveCount(0)
  await panel(alice).getByText(t('tournaments.createdArchive', { n: 3 })).click()
  await expect(tournamentLink(panel(alice), AUTUMN)).toBeVisible()
  await openMenu(page)
  await expect(tournamentLink(panel(page), AUTUMN)).toHaveCount(0)
  expect((await api('alice').patch(`/api/tournaments/${autumn.id}`, { action: 'restore' })).status).toBe(200)

  const carol = await openAs('carol')
  await openMenu(carol, '?tab=created')
  await expect(panel(carol)).toContainText(t('tournaments.noCreated'))
})

test('a tournament that starts moves to "ongoing"', { tag: ['@h-ongoing'] }, async ({ openAs }) => {
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${autumn.id}/edit`)
  await page.getByLabel(t('tournaments.startsAtLabel'), { exact: true }).fill(localDateTime(-1))
  await page.getByRole('button', { name: t('tournaments.submitSave') }).click()
  await page.waitForURL(`**/tournament/t/${autumn.id}`)
  await openMenu(page, '?tab=ongoing')
  await expect(tournamentLink(panel(page), AUTUMN)).toBeVisible()
  await expect(myOngoing(page).getByRole('link', { name: AUTUMN, exact: true })).toBeVisible()
  await openMenu(page, '?tab=upcoming')
  await expect(tournamentLink(panel(page), AUTUMN)).toHaveCount(0)
})

test('the menu at 375 px', { tag: ['@h-mobile', '@mobile', '@j-mobile'] }, async ({ openAs, api }) => {
  // This project runs this test alone: make sure carol has two ongoing tournaments.
  await api('alice').patch(`/api/tournaments/${autumn.id}`, { startsAt: isoDaysFromNow(-1) })
  const page = await openAs('carol')
  await openMenu(page)
  const cards = myOngoing(page).getByRole('link', { name: t('tournamentPages.changeMyDeck') })
  await expect(cards).toHaveCount(2)
  const [a, b] = await Promise.all([0, 1].map(i => myOngoing(page).getByRole('link', { name: [ 'Test cup', AUTUMN ][i], exact: true }).boundingBox()))
  expect(a.x).toBe(b.x)
  await expectNoHorizontalScroll(page)
  await cards.first().click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}\/pool$/)
})

test('the generic prep path still works', { tag: ['@h-generic'] }, async ({ openAs }) => {
  const page = await openAs('alice')
  await openMenu(page, '?tab=pools')
  await panel(page).getByRole('button', { name: t('tournamentPages.prepareNext') }).click()
  await page.waitForURL('**/tournament/prep')
  await expect(page.getByRole('heading', { name: t('tournamentPages.prepTitle') })).toBeAttached()
  await expect(page.getByRole('button', { name: t('tournamentPoolView.resetPool') })).toHaveCount(0)
  await expect(page.getByText(t('packReveal.boosterOf', { n: 1, total: 8 })).first()).toBeVisible()
})

// Beta masking: regular users keep the legacy menu on /tournament (Home still leads there),
// the hub only answers on HUB_PATH, and the hub's own pages link back to it.
test('beta: /tournament keeps the legacy menu, the hub lives on its own path', { tag: ['@h-beta'] }, async ({ openAs, page }) => {
  const alice = await openAs('alice')
  await alice.goto('/')
  await alice.getByRole('button', { name: t('home.tournamentsBtn') }).click()
  await alice.waitForURL(/\/tournament$/)
  await expect(alice.getByRole('heading', { name: t('tournamentPages.myOngoingTournaments') })).toBeVisible()
  await expect(alice.getByRole('button', { name: t('tournamentPages.prepareNext') })).toBeVisible()
  await expect(alice.getByRole('tablist')).toHaveCount(0)
  await expect(alice.getByRole('button', { name: t('tournaments.createButton') })).toHaveCount(0)
  await expect(alice.getByRole('link', { name: t('tournamentPages.changeMyDeck') }).first()).toHaveAttribute('href', /^\/tournament\/pools\/[0-9a-f-]{36}$/)

  await openMenu(alice)
  await expect(alice).toHaveURL(new RegExp(`${escapeRegExp(HUB_PATH)}$`))
  await expect(alice.getByRole('tablist')).toBeVisible()
  await expect(alice.getByRole('button', { name: t('tournaments.createButton') })).toBeVisible()
  await alice.goto(`/tournament/t/${testCup.id}`)
  await expect(alice.getByRole('link', { name: `← ${t('tournamentPages.menuTitle')}` })).toHaveAttribute('href', HUB_PATH)

  // Logged out: the legacy menu asks to connect; the hub keeps its public tabs.
  await page.goto('/tournament')
  await expect(page.getByText(t('home.bgaConnectRequired'))).toBeVisible()
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await openMenu(page)
  await expect(page.getByRole('tablist')).toBeVisible()
})
