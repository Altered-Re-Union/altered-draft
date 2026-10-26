// Recette group B — creating a tournament: the form, its live checks, the session that
// expires mid-form and the open-tournaments cap.
import { test, expect } from '../support/fixtures.js'
import { loginViaUi } from '../support/auth.js'
import { tournamentBody } from '../support/api.js'
import { localDateTime } from '../support/dates.js'
import { KEYCLOAK_ISSUER } from '../support/env.js'
import { expectNoHorizontalScroll } from '../support/guards.js'
import { t } from '../support/i18n.js'
import { escapeRegExp as escape, startsWith } from '../support/text.js'

const BGA_URL = 'https://fr.boardgamearena.com/tournament/?id=123456'
const CANON = 'https://boardgamearena.com/tournament?id=123456'
const bga = id => `https://boardgamearena.com/tournament?id=${id}`

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const tile = (page, name) => page.getByRole('button', { name })
const submit = page => page.getByRole('button', { name: t('tournaments.submitCreate') })
const problems = page => page.getByTestId('form-problems')
const stepper = (page, which) => page.getByTestId(which === 'in' ? 'uniques-in-boosters' : 'uniques-guaranteed')

async function openForm(openAs) {
  const page = await openAs('alice')
  await page.goto('/tournament/new')
  await expect(page.getByRole('heading', { name: t('tournaments.createTitle') })).toBeVisible()
  return page
}

async function fillValid(page, { name = 'Test cup', bgaUrl, set = 'Skybound Odyssey' }) {
  await field(page, 'nameLabel').fill(name)
  await field(page, 'bgaUrlLabel').fill(bgaUrl)
  await tile(page, set).click()
}

async function createAndOpen(page) {
  await expect(submit(page)).toBeEnabled()
  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
}

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('logged out: the form asks to connect, then comes back', { tag: ['@b-logged-out'] }, async ({ page }) => {
  await page.goto('/tournament/new')
  await expect(page.getByRole('button', { name: t('reunion.connect') }).first()).toBeVisible()
  await loginViaUi(page, 'alice', { from: '/tournament/new' })
  await expect(page.getByRole('heading', { name: t('tournaments.createTitle') })).toBeVisible()
})

test('happy path: defaults, then create', { tag: ['@b-happy'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Test cup')
  await field(page, 'descriptionLabel').fill('Line one\nLine two')
  await field(page, 'bgaUrlLabel').fill(BGA_URL)
  await expect(page.getByText(t('tournaments.bgaIdDetected', { id: '123456' }))).toBeVisible()
  await expect(page.getByText(t('tournaments.bgaUrlHint'))).toBeVisible()
  await expect(field(page, 'startsAtLabel')).toHaveValue(localDateTime(1, '20:00'))
  await expect(field(page, 'endsAtLabel')).toHaveValue('')
  await expect(page.getByText(t('tournaments.timezoneNote', { tz: 'Europe/Paris' }))).toBeVisible()

  await tile(page, 'Skybound Odyssey').click()
  await expect(tile(page, 'Skybound Odyssey')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(t('settingsFields.cardLanguage'))).toHaveCount(0)
  await expect(page.getByRole('button', { name: startsWith(t('settingsFields.inPacks')) })).toHaveAttribute('aria-pressed', 'true')
  await expect(stepper(page, 'in')).toContainText('1')
  await expect(stepper(page, 'out')).toContainText('1')

  await createAndOpen(page)
  const { body } = await api(null).get('/api/tournaments')
  expect(body.tournaments).toHaveLength(1)
  expect(body.tournaments[0]).toMatchObject({ name: 'Test cup', bgaTournamentId: '123456', bgaUrl: CANON, status: 'upcoming' })
})

test('BGA links: accepted and refused shapes', { tag: ['@b-links'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  const input = field(page, 'bgaUrlLabel')
  const detected = page.getByText(t('tournaments.bgaIdDetected', { id: '5' }))
  const invalid = page.getByRole('alert').filter({ hasText: t('tournaments.errBgaUrl') })
  const cases = [
    ['HTTPS://BOARDGAMEARENA.COM/tournament/?id=5&x=1', true],
    ['http://boardgamearena.com/tournament?id=5', false],
    ['https://boardgamearena.com/tournamentlist?id=5', false],
    ['https://boardgamearena.com.evil.io/tournament?id=5', false],
    ['https://boardgamearena.com/tournament?id=abc', false],
  ]
  for (const [value, ok] of cases) {
    await input.fill(value)
    await input.blur()
    await expect(ok ? detected : invalid, value).toBeVisible()
    await expect(ok ? invalid : detected, value).toHaveCount(0)
  }
})

test('a BGA link already declared is refused', { tag: ['@b-dup'] }, async ({ openAs, seed }) => {
  await seed.tournament('alice')
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Other cup')
  await field(page, 'bgaUrlLabel').fill(BGA_URL)
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errBgaTaken') })).toBeVisible()
  const line = `${t('tournaments.bgaUrlLabel')} — ${t('tournaments.errBgaTaken')}`
  await expect(problems(page)).toContainText(line)
  await expect(submit(page)).toBeDisabled()
  await expect(submit(page).locator('xpath=..')).toHaveAttribute('title', new RegExp(escape(t('tournaments.errBgaTaken'))))

  await page.mouse.wheel(0, 2000)
  const box = await problems(page).boundingBox()
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height)

  await problems(page).getByRole('button', { name: line }).click()
  await expect(field(page, 'bgaUrlLabel')).toBeFocused()
})

test('a start in the past blocks the submit', { tag: ['@b-past'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await fillValid(page, { bgaUrl: bga(123457) })
  await expect(submit(page)).toBeEnabled()

  let posts = 0
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/api/tournaments')) posts++ })
  await field(page, 'startsAtLabel').fill(localDateTime(-1))
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errStartsAt') })).toBeVisible()
  await expect(problems(page)).toContainText(t('tournaments.errStartsAt'))
  await expect(submit(page)).toBeDisabled()
  await field(page, 'nameLabel').press('Enter')
  expect(posts).toBe(0)

  await field(page, 'startsAtLabel').fill(localDateTime(1))
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errStartsAt') })).toHaveCount(0)
  await expect(submit(page)).toBeEnabled()
})

test('Enter in a field jumps to the first problem', { tag: ['@b-past'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await fillValid(page, { bgaUrl: bga(123457) })
  await field(page, 'startsAtLabel').fill(localDateTime(-1))
  await field(page, 'nameLabel').press('Enter')
  await expect(field(page, 'startsAtLabel')).toBeFocused()
})

test('end before start, short name, problems shown before and after touching', { tag: ['@b-end-before'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  // Untouched form: every problem listed, none in red yet.
  for (const label of ['nameLabel', 'bgaUrlLabel', 'sectionCards']) {
    const line = problems(page).getByRole('button', { name: startsWith(`• ${t(`tournaments.${label}`)}`) })
    await expect(line).toBeVisible()
    await expect(line).not.toHaveClass(/text-danger/)
  }

  await field(page, 'endsAtLabel').fill(localDateTime(1, '19:00'))
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errEndsAt') })).toBeVisible()
  await expect(problems(page).getByRole('button', { name: startsWith(`• ${t('tournaments.endsAtLabel')}`) })).toBeVisible()

  await field(page, 'nameLabel').fill('ab')
  await field(page, 'nameLabel').blur()
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errName') })).toBeVisible()
  await expect(problems(page).getByRole('button', { name: startsWith(`• ${t('tournaments.nameLabel')}`) })).toHaveClass(/text-danger/)
})

test('end before start, at 375 px', { tag: ['@b-end-before', '@mobile', '@j-mobile'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await field(page, 'endsAtLabel').fill(localDateTime(1, '19:00'))
  await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errEndsAt') })).toBeVisible()
  const box = await problems(page).boundingBox()
  const viewport = page.viewportSize()
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  await expectNoHorizontalScroll(page)
})

test('a set without unique data disables the uniques', { tag: ['@b-nej'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await fillValid(page, { bgaUrl: bga(123458), set: 'Neverending Journey' })
  await expect(page.getByText(t('tournaments.uniquesUnsupported'))).toBeVisible()
  for (const which of ['in', 'out']) {
    await expect(stepper(page, which)).toContainText('0')
    await expect(stepper(page, which).getByRole('button', { name: '+' })).toBeDisabled()
  }
  await createAndOpen(page)
  const { body } = await api(null).get('/api/tournaments')
  expect(body.tournaments[0].config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null })
})

test('even factions needs two uniques', { tag: ['@b-even'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await fillValid(page, { bgaUrl: bga(123459) })
  const even = page.getByLabel(t('tournaments.evenFactions'))
  await even.check()
  await stepper(page, 'out').getByRole('button', { name: '−' }).click()
  await expect(even).not.toBeChecked()
  await expect(even).toBeDisabled()
  await stepper(page, 'out').getByRole('button', { name: '+' }).click()
  await expect(even).not.toBeChecked()
  await expect(even).toBeEnabled()
  await stepper(page, 'out').getByRole('button', { name: '−' }).click()
  await createAndOpen(page)
  const { body } = await api(null).get('/api/tournaments')
  expect(body.tournaments[0].config.uniques).toMatchObject({ inBoosters: 1, guaranteed: 0, evenFactions: false })
})

test('free hero choice and ban list show in the summary', { tag: ['@b-options'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await fillValid(page, { bgaUrl: bga(123460) })
  await page.getByRole('button', { name: startsWith(t('settingsFields.freeChoice')) }).click()
  await page.getByLabel(t('settingsFields.excludeBanlist')).check()
  await createAndOpen(page)
  const summary = page.getByTestId('tournament-summary')
  await expect(summary).toContainText(t('tournaments.summaryHeroesFree'))
  await expect(summary).toContainText(t('tournaments.summaryBanlist'))
})

test('an expired session keeps what was typed through the reconnect', { tag: ['@b-session-expired'] }, async ({ openAs, fakes }) => {
  const page = await openForm(openAs)
  await fillValid(page, { name: 'Expired session cup', bgaUrl: bga(555777) })
  await expect(submit(page)).toBeEnabled()
  await fakes.revoke('alice')
  await submit(page).click()

  await expect(page.getByText(t('tournaments.errSessionExpired'))).toBeVisible()
  const reconnect = page.getByRole('button', { name: t('tournaments.reconnectKeep') })
  await expect(reconnect).toBeVisible()
  await expect(page.getByText(t('tournaments.errGeneric', { msg: '' }).trim())).toHaveCount(0)

  await reconnect.click()
  await page.waitForURL(url => url.href.startsWith(`${KEYCLOAK_ISSUER}/protocol/openid-connect/auth`))
  await page.getByRole('link', { name: 'alice', exact: true }).click()
  await page.waitForURL(/\/tournament\/new$/)
  await expect(field(page, 'nameLabel')).toHaveValue('Expired session cup')
  await expect(field(page, 'bgaUrlLabel')).toHaveValue(bga(555777))
  await expect(tile(page, 'Skybound Odyssey')).toHaveAttribute('aria-pressed', 'true')
  await expect(submit(page)).toBeEnabled()
})

test('ten open tournaments per organizer', { tag: ['@b-cap'] }, async ({ api }) => {
  const alice = api('alice')
  for (let i = 1; i <= 10; i++) {
    const res = await alice.post('/api/tournaments', tournamentBody({ name: `Cap ${i}`, bgaUrl: bga(900000 + i) }))
    expect(res.status, `alice #${i}`).toBe(201)
  }
  const eleventh = await alice.post('/api/tournaments', tournamentBody({ name: 'Cap 11', bgaUrl: bga(900011) }))
  expect(eleventh.status).toBe(429)
  expect(eleventh.body).toEqual({ error: 'too_many_open_tournaments' })

  const bob = api('bob')
  for (let i = 1; i <= 11; i++) {
    const res = await bob.post('/api/tournaments', tournamentBody({ name: `Cap ${i}`, bgaUrl: bga(910000 + i) }))
    expect(res.status, `bob #${i}`).toBe(201)
  }
})
