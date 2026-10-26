// Acceptance group L — v1.1, the faction of the uniques: the form's faction chips, the stored
// config and its summary, the pool's uniques (real faction through the range data), the API
// guards, and the faction reset when a played format is imposed.
import { test, expect } from '../support/fixtures.js'
import { tournamentBody } from '../support/api.js'
import { FAKES_URL } from '../support/env.js'
import { expectNoHorizontalScroll } from '../support/guards.js'
import { t, tc } from '../support/i18n.js'
import { escapeRegExp } from '../support/text.js'

const FACTIONS = ['Axiom', 'Bravos', 'Lyra', 'Muna', 'Ordis', 'Yzmir']
const bga = id => `https://boardgamearena.com/tournament?id=${id}`
const AXIOM_CUP = {
  name: 'Axiom cup',
  bgaUrl: bga(123470),
  config: { source: { type: 'set', setCode: 'CYCLONE' }, heroes: 'packs', uniques: { inBoosters: 2, guaranteed: 2, evenFactions: false, faction: 'AX' }, excludeBanlist: false },
}
const SUMMARY_END = `${tc('tournaments.summaryUniquesIn', 2)} · ${tc('tournaments.summaryUniquesOut', 2)} · ${t('tournaments.summaryFaction', { faction: 'Axiom' })}`

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const chips = page => page.getByRole('radiogroup', { name: t('tournaments.uniquesFaction') })
const chip = (page, name) => chips(page).getByRole('radio', { name, exact: true })
const even = page => page.getByLabel(t('tournaments.evenFactions'))
const stepperButton = (page, which, sign) => page.getByTestId(which === 'in' ? 'uniques-in-boosters' : 'uniques-guaranteed').getByRole('button', { name: sign })

async function openForm(openAs) {
  const page = await openAs('alice')
  await page.goto('/tournament/new')
  await page.getByRole('button', { name: 'Skybound Odyssey' }).click()
  return page
}

async function expectAxiomSummary(summary) {
  await expect(summary).toHaveText(new RegExp(`${escapeRegExp(SUMMARY_END)}$`))
  await expect(summary.locator('img')).toHaveCount(1)
  await expect(summary).not.toContainText(t('tournaments.summaryEven'))
}

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('form: the faction chips and how they interact', { tag: ['@l-form'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  const radios = chips(page).getByRole('radio')
  await expect(radios).toHaveCount(7)
  await expect(radios.nth(0)).toHaveText(t('tournaments.uniquesFactionAll'))
  await expect(radios.nth(0)).toHaveAttribute('aria-checked', 'true')
  for (const [i, name] of FACTIONS.entries()) {
    await expect(radios.nth(i + 1)).toHaveText(name)
    await expect(radios.nth(i + 1).locator('img')).toHaveCount(1)
  }
  await expect(page.getByText(t('tournaments.uniquesFactionHint'))).toBeVisible()

  await even(page).check()
  await chip(page, 'Axiom').click()
  await expect(chip(page, 'Axiom')).toHaveAttribute('aria-checked', 'true')
  await expect(even(page)).not.toBeChecked()
  await expect(even(page)).toBeDisabled()
  await chip(page, t('tournaments.uniquesFactionAll')).click()
  await expect(even(page)).toBeEnabled()
  await expect(even(page)).not.toBeChecked()

  await chip(page, 'Bravos').click()
  await stepperButton(page, 'in', '−').click()
  await stepperButton(page, 'out', '−').click()
  for (const radio of await radios.all()) await expect(radio).toBeDisabled()
  await expect(chip(page, t('tournaments.uniquesFactionAll'))).toHaveAttribute('aria-checked', 'true')
  await stepperButton(page, 'in', '+').click()
  await expect(chip(page, t('tournaments.uniquesFactionAll'))).toHaveAttribute('aria-checked', 'true')

  await page.getByRole('button', { name: 'Neverending Journey' }).click()
  for (const radio of await radios.all()) await expect(radio).toBeDisabled()
})

test('create "Axiom cup": stored config and summary', { tag: ['@l-create'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Axiom cup')
  await field(page, 'bgaUrlLabel').fill(bga(123470))
  await stepperButton(page, 'in', '+').click()
  await stepperButton(page, 'out', '+').click()
  await chip(page, 'Axiom').click()
  await page.getByRole('button', { name: t('tournaments.submitCreate') }).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  await expectAxiomSummary(page.getByTestId('tournament-summary'))
  const { body } = await api(null).get('/api/tournaments')
  expect(body.tournaments.find(tn => tn.bgaTournamentId === '123470').config.uniques)
    .toEqual({ inBoosters: 2, guaranteed: 2, evenFactions: false, faction: 'AX' })
})

test('menu: the card carries the faction, in both themes', { tag: ['@l-menu'] }, async ({ openAs, seed }) => {
  await seed.tournament('alice', AXIOM_CUP)
  const page = await openAs('alice')
  await page.goto('/tournament')
  const summary = page.getByRole('tabpanel').getByTestId('tournament-summary')
  await expectAxiomSummary(summary)
  const before = await page.locator('html').getAttribute('data-theme')
  await page.getByRole('button', { name: t('theme.toggle') }).click()
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', before ?? '')
  await expect(summary).toBeVisible()
})

test('menu card at 375 px', { tag: ['@l-menu', '@mobile', '@j-mobile'] }, async ({ openAs, seed }) => {
  await seed.tournament('alice', AXIOM_CUP)
  const page = await openAs('alice')
  await page.goto('/tournament')
  const summary = page.getByRole('tabpanel').getByTestId('tournament-summary')
  await expectAxiomSummary(summary)
  await expectNoHorizontalScroll(page)
  const box = await summary.boundingBox()
  const icon = await summary.locator('img').boundingBox()
  expect(icon.x).toBeGreaterThanOrEqual(box.x)
  expect(icon.x + icon.width).toBeLessThanOrEqual(box.x + box.width)
  expect(icon.y).toBeGreaterThanOrEqual(box.y)
  expect(icon.y + icon.height).toBeLessThanOrEqual(box.y + box.height)
})

test('the pool only holds Axiom uniques', { tag: ['@l-pool'] }, async ({ openAs, seed, request }) => {
  const { id } = await seed.tournament('alice', AXIOM_CUP)
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}`)
  await page.getByRole('button', { name: t('tournaments.step2Button') }).click()
  await expect(page.getByText(t('packReveal.boosterOf', { n: 1, total: 8 })).first()).toBeVisible()
  for (let n = 2; n <= 8; n++) {
    // The auto-opened card zoom overlays the reveal's nav.
    await page.getByRole('button', { name: t('packReveal.nextBooster') }).dispatchEvent('click')
    await expect(page.getByText(t('packReveal.boosterOf', { n, total: 8 })).first()).toBeVisible()
  }
  await expect(page.getByText(t('packReveal.guaranteedUnique')).first()).toBeVisible()

  const pool = await seed.pool('alice', id)
  expect(pool.boosters.flat().filter(r => r.includes('_U_'))).toHaveLength(2)
  const uniques = Object.keys(pool.cards).filter(r => r.includes('_U_'))
  expect(uniques).toHaveLength(4)
  for (const ref of uniques) {
    const { member } = await (await request.get(`${FAKES_URL}/cards/api/cards?reference=${ref}`)).json()
    expect(member[0]?.faction.code, ref).toBe('AX')
  }
})

test('API: an unknown faction is refused', { tag: ['@l-api-invalid'] }, async ({ api }) => {
  const res = await api('alice').post('/api/tournaments', {
    name: 'Bad faction', bgaUrl: bga(123471), startsAt: tournamentBody().startsAt,
    config: { source: { type: 'set', setCode: 'CYCLONE' }, heroes: 'packs', uniques: { inBoosters: 1, guaranteed: 0, faction: 'XX' } },
  })
  expect(res.status).toBe(400)
  expect(res.body.config).toContain('uniques.faction')
  expect((await api(null).get('/api/tournaments')).body.tournaments.map(tn => tn.name)).not.toContain('Bad faction')
})

test('API: a faction without any unique is reset to null', { tag: ['@l-api-no-unique'] }, async ({ api }) => {
  const res = await api('alice').post('/api/tournaments', {
    name: 'No unique faction', bgaUrl: bga(123472), startsAt: tournamentBody().startsAt,
    config: { source: { type: 'set', setCode: 'CYCLONE' }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 0, faction: 'BR' } },
  })
  expect(res.status).toBe(201)
  expect(res.body.config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null })
  expect([200, 204]).toContain((await api('alice').delete(`/api/tournaments/${res.body.id}`)).status)
})

test('an imposed played format puts the faction back to "All"', { tag: ['@l-imposed'] }, async ({ openAs, seed }) => {
  await seed.bgaDecklist('carol', { tournamentId: '474749', tournamentName: 'BGA name', gameId: 'g-474749' })
  const page = await openForm(openAs)
  await chip(page, 'Axiom').click()
  await field(page, 'bgaUrlLabel').fill(bga(474749))
  await expect(page.getByRole('status')).toHaveText(tc('tournaments.legacyImposed', 1))
  await expect(page.getByRole('button', { name: 'Roots of Corruption' })).toHaveAttribute('aria-pressed', 'true')
  await expect(chip(page, t('tournaments.uniquesFactionAll'))).toHaveAttribute('aria-checked', 'true')
  for (const radio of await chips(page).getByRole('radio').all()) await expect(radio).toBeDisabled()
})
