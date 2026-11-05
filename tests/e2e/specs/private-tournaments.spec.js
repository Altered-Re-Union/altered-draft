// Acceptance page "Private tournaments and the share box — V4" (acceptance-private-tournaments.html):
// the Visibility radios, who sees a private tournament in the hub lists, the duplicate-link
// check that leaks no name, the visibility toggle on a tournament with pools, the share box
// (link, copy and its fallback, native share, local QR code in both themes, none when
// detached), the Lobby's local QR code, FR and 375 px. "Private cup" is BGA id 123500,
// "Public control" 123501, "Toggle cup" 123503, "Squat cup" 123504.
import { test, expect } from '../support/fixtures.js'
import { privateTournamentBody } from '../support/api.js'
import { APP_URL } from '../support/env.js'
import { expectNoHorizontalScroll } from '../support/guards.js'
import { t, tFr } from '../support/i18n.js'
import { openMenu, tournamentLink } from '../support/pages.js'
import { startsWith } from '../support/text.js'

const bga = id => `https://boardgamearena.com/tournament?id=${id}`
const RAW_KEY = /\b(tournaments|tournamentPages|tournamentPoolView|packReveal|settingsFields|topNav|reunion|common)\.[A-Za-z.]+\b/

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const tile = (page, name) => page.getByRole('button', { name })
const submit = page => page.getByRole('button', { name: t('tournaments.submitCreate') })
const save = page => page.getByRole('button', { name: t('tournaments.submitSave') })
const problems = page => page.getByTestId('form-problems')
const radio = (page, v) => page.getByTestId(`visibility-${v}`)
const pill = scope => scope.getByTestId('tournament-private')
const shareBox = page => page.getByTestId('share-box')
const shareCopy = page => page.getByTestId('share-copy')
const shareUrl = page => page.getByTestId('share-url')
const tab = (page, key) => page.getByRole('tab', { name: startsWith(t(`tournaments.${key}`)) })
const tournamentUrl = id => `${APP_URL}/tournament/t/${id}`

async function tabCount(page, key) {
  const text = await tab(page, key).innerText()
  return Number(/(\d+)\s*$/.exec(text)?.[1])
}

async function openTournament(page, id, name = 'Private cup') {
  await page.goto(`/tournament/t/${id}`)
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

// The share box is checked against a page without navigator.share, whatever the headless
// browser exposes (pv-g-native covers the button with a stub).
async function withoutNativeShare(page) {
  await page.addInitScript(() => { delete Navigator.prototype.share })
}

async function expectBlackOnWhite(qr) {
  await expect(qr.locator('rect[fill="#fff"]')).toHaveCount(1)
  await expect(qr.locator('path[fill="#000"]')).toHaveCount(1)
  expect(await qr.locator('path').getAttribute('d')).toMatch(/\S/)
  const fills = await qr.evaluate(svg => [getComputedStyle(svg.querySelector('rect')).fill, getComputedStyle(svg.querySelector('path')).fill])
  expect(fills).toEqual(['rgb(255, 255, 255)', 'rgb(0, 0, 0)'])
}

async function editVisibility(page, id, v) {
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(radio(page, v)).toBeEnabled()
  await radio(page, v).check()
  await expect(save(page)).toBeEnabled()
  await save(page).click()
  await page.waitForURL(new RegExp(`/tournament/t/${id}$`))
  await expect(page.getByTestId('tournament-status')).toBeVisible()
}

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('form: the Visibility radios, Public by default, both hints', { tag: ['@pv-a-radio'] }, async ({ openAs }) => {
  const page = await openAs('alice')
  await page.goto('/tournament/new')
  await expect(page.getByRole('heading', { name: t('tournaments.createTitle') })).toBeVisible()
  await expect(page.locator('#tn-visibility legend')).toHaveText(t('tournaments.visibilityLabel'))
  await expect(radio(page, 'public')).toBeChecked()
  await expect(radio(page, 'private')).not.toBeChecked()
  await expect(page.getByText(t('tournaments.visibilityPublicHint'))).toBeVisible()
  await expect(page.getByText(t('tournaments.visibilityPrivateHint'))).toBeVisible()
  await expect(page.getByRole('radio', { name: t('tournaments.visibilityPrivate') })).toBeVisible()

  // The blank form already lists its missing fields: the choice adds no problem of its own.
  const before = await problems(page).textContent()
  await radio(page, 'private').click()
  await expect(radio(page, 'private')).toBeChecked()
  await expect(radio(page, 'public')).not.toBeChecked()
  await expect(problems(page)).toHaveText(before)
  await expect(problems(page)).not.toContainText(t('tournaments.visibilityLabel'))
})

test('create "Private cup": stored private, the pill after the status, in My created tournaments', { tag: ['@pv-b-create', '@pv-b-created-tab'] }, async ({ openAs, api }) => {
  const page = await openAs('alice')
  await page.goto('/tournament/new')
  await field(page, 'nameLabel').fill('Private cup')
  await field(page, 'bgaUrlLabel').fill(bga(123500))
  await radio(page, 'private').check()
  await tile(page, 'Skybound Odyssey').click()
  await expect(submit(page)).toBeEnabled()
  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop()

  const { status, body } = await api('alice').get(`/api/tournaments/${id}`)
  expect(status).toBe(200)
  expect(body.visibility).toBe('private')

  // The status pill, then right after it the Private pill.
  const header = page.locator('header').filter({ has: page.getByTestId('tournament-status') })
  await expect(pill(header)).toHaveText(t('tournaments.privateBadge'))
  await expect(pill(header)).toHaveAttribute('title', t('tournaments.privateBadgeTitle'))
  await expect(header.getByTestId('tournament-status').locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-testid', 'tournament-private')

  const panel = await openMenu(page, '?tab=created')
  await expect(pill(tournamentLink(panel, 'Private cup'))).toBeVisible()
})

test('lists: organizer and moderator see it with the pill, stranger and anonymous do not', {
  tag: ['@pv-c-organizer', '@pv-c-moderator', '@pv-c-stranger', '@pv-c-anon', '@pv-c-public-control'],
}, async ({ openAs, seed, api }) => {
  await seed.tournament('alice', privateTournamentBody())
  const control = await seed.tournament('alice', { name: 'Public control', bgaUrl: bga(123501) })
  expect(control.visibility).toBe('public')

  for (const who of ['alice', 'bob']) {
    const page = await openAs(who)
    const panel = await openMenu(page, '?tab=upcoming')
    await expect(pill(tournamentLink(panel, 'Private cup')), who).toBeVisible()
    await expect(tournamentLink(panel, 'Public control'), who).toBeVisible()
    await expect(pill(tournamentLink(panel, 'Public control')), who).toHaveCount(0)
    expect(await tabCount(page, 'tabUpcoming'), who).toBe(2)
  }
  for (const who of ['carol', null]) {
    const page = await openAs(who)
    const panel = await openMenu(page, '?tab=upcoming')
    await expect(tournamentLink(panel, 'Public control'), who ?? 'anon').toBeVisible()
    await expect(pill(tournamentLink(panel, 'Public control')), who ?? 'anon').toHaveCount(0)
    await expect(tournamentLink(panel, 'Private cup'), who ?? 'anon').toHaveCount(0)
    expect(await tabCount(page, 'tabUpcoming'), who ?? 'anon').toBe(1)
    if (who) {
      await expect(page.getByTestId('my-ongoing')).toHaveCount(0)
      const pools = await openMenu(page, '?tab=pools')
      await expect(pools).not.toContainText('Private cup')
    }
  }
})

test('the link: carol opens it, prepares her pool, then sees it listed', { tag: ['@pv-d-url', '@pv-d-pool'] }, async ({ openAs, seed }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody())
  const page = await openAs('carol')
  await openTournament(page, id)
  await expect(pill(page.locator('header'))).toBeVisible()
  await expect(page.getByRole('button', { name: t('tournaments.step2Button') })).toBeEnabled()

  await seed.pool('carol', id)
  let panel = await openMenu(page, '?tab=upcoming')
  await expect(pill(tournamentLink(panel, 'Private cup'))).toBeVisible()
  expect(await tabCount(page, 'tabUpcoming')).toBe(1)

  panel = await openMenu(page, '?tab=pools')
  await expect(tournamentLink(panel, 'Private cup')).toBeVisible()
  await expect(pill(panel)).toHaveCount(1)
})

test('once started: in carol’s My ongoing tournaments, with the pill', { tag: ['@pv-d-ongoing'] }, async ({ openAs, seed, db }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody())
  await seed.pool('carol', id)
  await db.query(`UPDATE tournaments SET starts_at = now() - interval '1 hour' WHERE id = $1`, [id])

  const page = await openAs('carol')
  const panel = await openMenu(page, '?tab=ongoing')
  const mine = page.getByTestId('my-ongoing')
  await expect(mine.getByRole('link', { name: 'Private cup', exact: true })).toBeVisible()
  await expect(pill(mine)).toBeVisible()
  // Logged in, an Ongoing card carries a "Hide" button: its link is stretched over the card
  // (a link can't hold a button), so the pill sits next to the link, in the card itself.
  await expect(pill(tournamentLink(panel, 'Private cup').locator('..'))).toBeVisible()

  const anon = await openAs(null)
  const anonPanel = await openMenu(anon, '?tab=ongoing')
  await expect(tournamentLink(anonPanel, 'Private cup')).toHaveCount(0)
})

test('duplicate link: refused for a stranger without the name, free for the organizer', { tag: ['@pv-e-stranger', '@pv-e-owner'] }, async ({ openAs, seed, api }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody())

  const carol = await openAs('carol')
  await carol.goto('/tournament/new')
  await field(carol, 'nameLabel').fill('Stranger attempt')
  await field(carol, 'bgaUrlLabel').fill(bga(123500))
  await expect(problems(carol)).toContainText(t('tournaments.errBgaTaken'))
  await expect(submit(carol)).toBeDisabled()
  expect(await carol.locator('body').innerText()).not.toContain('Private cup')

  for (const who of ['carol', null]) {
    const res = await api(who).get('/api/tournaments?bgaId=123500')
    expect(res.status, who ?? 'anon').toBe(200)
    expect(res.body, who ?? 'anon').toEqual({ tournaments: [{ visibility: 'private' }], legacy: null })
  }

  const alice = await openAs('alice')
  const checked = alice.waitForResponse(res => res.url().includes('/api/tournaments?bgaId=123500'))
  await alice.goto(`/tournament/t/${id}/edit`)
  await expect(field(alice, 'bgaUrlLabel')).toHaveValue(bga(123500))
  await checked
  await expect(radio(alice, 'private')).toBeChecked()
  await expect(problems(alice)).toHaveCount(0)
  await expect(save(alice)).toBeEnabled()
})

test('visibility toggle on a tournament with pools', { tag: ['@pv-f-public', '@pv-f-private'] }, async ({ openAs, seed }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody({ name: 'Toggle cup', bgaUrl: bga(123503) }))
  await seed.pool('carol', id)
  const alice = await openAs('alice')
  const anon = await openAs(null)
  const carol = await openAs('carol')

  await expect(tournamentLink(await openMenu(anon, '?tab=upcoming'), 'Toggle cup')).toHaveCount(0)

  await editVisibility(alice, id, 'public')
  await expect(pill(alice.locator('header'))).toHaveCount(0)
  let panel = await openMenu(anon, '?tab=upcoming')
  await expect(tournamentLink(panel, 'Toggle cup')).toBeVisible()
  await expect(pill(tournamentLink(panel, 'Toggle cup'))).toHaveCount(0)

  await editVisibility(alice, id, 'private')
  await expect(pill(alice.locator('header'))).toBeVisible()
  panel = await openMenu(anon, '?tab=upcoming')
  await expect(tournamentLink(panel, 'Toggle cup')).toHaveCount(0)
  panel = await openMenu(carol, '?tab=upcoming')
  await expect(pill(tournamentLink(panel, 'Toggle cup'))).toBeVisible()
})

test('share box: hint, link, copy, QR black on white in both themes', { tag: ['@pv-g-box', '@pv-g-copy', '@pv-g-qr'] }, async ({ page, seed, api }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody())
  const control = await seed.tournament('alice', { name: 'Public control', bgaUrl: bga(123501) })
  await withoutNativeShare(page)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP_URL })

  await openTournament(page, id)
  const box = shareBox(page)
  await expect(box).toBeVisible()
  await expect(box.getByRole('heading', { name: t('tournaments.shareTitle') })).toBeVisible()
  await expect(box).toContainText(t('tournaments.sharePrivateHint'))
  await expect(shareUrl(page)).toHaveValue(tournamentUrl(id))
  await expect(shareUrl(page)).toHaveAttribute('readonly', '')

  await shareCopy(page).click()
  await expect(shareCopy(page)).toHaveText(t('tournaments.shareCopied'))
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(tournamentUrl(id))
  await expect(shareCopy(page)).toHaveText(t('tournaments.shareCopy'), { timeout: 3_000 })
  await expect(page.getByTestId('share-native')).toHaveCount(0)

  const qr = page.getByTestId('share-qr')
  await expect(qr).toBeVisible()
  expect(await qr.evaluate(el => el.tagName.toLowerCase())).toBe('svg')
  await expectBlackOnWhite(qr)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.getByRole('button', { name: t('theme.toggle') }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(theme)
  await expectBlackOnWhite(qr)

  await openTournament(page, control.id, 'Public control')
  await expect(shareBox(page)).toContainText(t('tournaments.shareHint'))
  expect((await api('alice').patch(`/api/tournaments/${control.id}`, { action: 'cancel' })).status).toBe(200)
  await page.reload()
  await expect(page.getByTestId('tournament-status')).toHaveText(t('tournaments.statusCancelled'))
  await expect(shareBox(page)).toBeVisible()
  await expect(shareBox(page)).not.toContainText(t('tournaments.shareHint'))
  await expect(shareBox(page)).not.toContainText(t('tournaments.sharePrivateHint'))
})

test('share box: "Share…" hands the title and the link to navigator.share', { tag: ['@pv-g-native'] }, async ({ page, seed }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody())
  await page.addInitScript(() => {
    window.__shared = []
    navigator.share = d => { window.__shared.push(d); return Promise.resolve() }
  })
  await openTournament(page, id)
  await expect(page.getByTestId('share-native')).toHaveText(t('tournaments.shareNative'))
  await page.getByTestId('share-native').click()
  await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1)
  expect(await page.evaluate(() => window.__shared[0])).toEqual({ title: 'Private cup', url: tournamentUrl(id) })
})

test('share box: copy refused, the link is selected instead', { tag: ['@pv-g-copy-fallback'] }, async ({ page, seed }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody())
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
    document.execCommand = () => false
  })
  await openTournament(page, id)
  await shareCopy(page).click()
  await expect(shareUrl(page)).toBeFocused()
  expect(await shareUrl(page).evaluate(el => el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0)).toBe(true)
  await expect(shareCopy(page)).toHaveText(t('tournaments.shareCopy'))
})

test('a detached tournament has no share box', { tag: ['@pv-g-detached'] }, async ({ openAs, seed, api }) => {
  const { id } = await seed.tournament('carol', { name: 'Squat cup', bgaUrl: bga(123504) })
  const carol = await openAs('carol')
  await openTournament(carol, id, 'Squat cup')
  await expect(shareBox(carol)).toBeVisible()

  expect((await api('bob').patch(`/api/tournaments/${id}`, { action: 'detach' })).status).toBe(200)
  for (const who of ['bob', 'carol', null]) {
    const page = await openAs(who)
    await openTournament(page, id, 'Squat cup')
    await expect(page.getByText(t('tournaments.detachedNotice')), who ?? 'anon').toBeVisible()
    await expect(shareBox(page), who ?? 'anon').toHaveCount(0)
  }
})

test('Lobby: the room QR code is a local SVG', { tag: ['@pv-h-lobby-qr'] }, async ({ page }) => {
  // The network rules fail the test on any request to api.qrserver.com.
  await page.goto('/')
  await page.getByRole('button', { name: t('home.createRoom') }).click()
  await page.getByPlaceholder(t('home.displayNamePlaceholderAlice')).fill('alice')
  await page.getByRole('button', { name: t('home.createRoomBtn') }).click()
  await page.waitForURL(/\/room\/[A-Z0-9]+$/)
  const qr = page.getByTestId('qr-code')
  await expect(qr).toBeVisible()
  expect(await qr.evaluate(el => el.tagName.toLowerCase())).toBe('svg')
  await expect(qr).toHaveAttribute('aria-label', t('lobby.qrCodeAlt'))
  expect(await qr.locator('path').getAttribute('d')).toMatch(/\S/)
  await expect(page.locator('img[src*="qrserver"]')).toHaveCount(0)
})

test('375 px: stacked radios, share box without the QR, no horizontal scroll', { tag: ['@pv-i-mobile', '@mobile'] }, async ({ openAs, seed }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody())
  const page = await openAs('alice')
  await page.goto('/tournament/new')
  await expect(radio(page, 'public')).toBeVisible()
  const pub = await page.locator('label').filter({ has: radio(page, 'public') }).boundingBox()
  const priv = await page.locator('label').filter({ has: radio(page, 'private') }).boundingBox()
  expect(priv.y).toBeGreaterThanOrEqual(pub.y + pub.height)
  expect(Math.abs(priv.x - pub.x)).toBeLessThan(2)
  await expectNoHorizontalScroll(page)

  await openMenu(page, '?tab=upcoming')
  await expectNoHorizontalScroll(page)

  await openTournament(page, id)
  await expect(shareBox(page)).toBeVisible()
  await expect(shareUrl(page)).toBeVisible()
  await expect(page.getByTestId('share-qr')).toBeHidden()
  await expectNoHorizontalScroll(page)
})

test('French UI: visibility, private pill and share box, no raw key', { tag: ['@pv-i-fr'] }, async ({ openAs, seed }) => {
  const { id } = await seed.tournament('alice', privateTournamentBody())
  const page = await openAs('alice')
  await openMenu(page)
  await page.getByRole('combobox', { name: t('lang.select') }).selectOption('fr')

  await page.goto('/tournament/new')
  await expect(page.getByText(tFr('tournaments.visibilityLabel'), { exact: true })).toBeVisible()
  await expect(page.getByText(tFr('tournaments.visibilityPrivateHint'))).toBeVisible()
  await page.waitForLoadState('networkidle')
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY)

  await openTournament(page, id)
  await expect(shareBox(page).getByRole('heading', { name: tFr('tournaments.shareTitle') })).toBeVisible()
  await expect(pill(page.locator('header'))).toHaveText(tFr('tournaments.privateBadge'))
  await expect(shareBox(page)).toContainText(tFr('tournaments.sharePrivateHint'))
  await page.waitForLoadState('networkidle')
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY)

  const panel = await openMenu(page)
  // tournamentLink knows the English status labels only: the French card is matched by its start.
  await expect(pill(panel.getByRole('link', { name: startsWith('Private cup') }))).toHaveText(tFr('tournaments.privateBadge'))
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY)
})
