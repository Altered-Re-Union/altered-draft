// Acceptance group G — the BGA path (the acceptance page's curl blocks), plus the two form checks of the
// "declared after the fact" rule. API calls carry the bearer BGA forwards.
import { test, expect, resetStack } from '../support/fixtures.js'
import { tournamentBody, withRequestContext } from '../support/api.js'
import { t, tc } from '../support/i18n.js'

test.describe.configure({ mode: 'serial' })

const AUTUMN = 'Coupe d’automne — Skybound Odyssey'
let autumn
let testCup

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const names = decklist => decklist['hydra:member'].map(m => m.name)

test.beforeAll(async ({ playwright }) => {
  await resetStack()
  await withRequestContext(playwright.request, async seed => {
    autumn = await seed.tournament('alice', { name: AUTUMN, bgaUrl: 'https://boardgamearena.com/tournament?id=610001' })
    testCup = await seed.tournament('alice')
    await seed.pool('carol', testCup.id)
  })
})

test('the first BGA call of an account creates its pool, named after the declaration', { tag: ['@g-create'] }, async ({ seed }) => {
  const decklist = await seed.bgaDecklist('carol', { tournamentId: '610001', tournamentName: 'X - Stage 1', gameId: 'g1' })
  expect(names(decklist)).toEqual([`Random ${AUTUMN}`])
})

test('the organizer panel counts the pool created by BGA', { tag: ['@g-panel'] }, async ({ api, openAs }) => {
  expect((await api('alice').get(`/api/tournaments/${autumn.id}`)).body.poolsByOrigin).toEqual({ page: 0, legacy: 0, bga: 1 })
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${autumn.id}`)
  await expect(page.getByTestId('organizer-panel')).toContainText(t('tournaments.poolsByOrigin', { page: 0, bga: 1 }))
  await expect(page.getByText(t('tournaments.bgaZeroWarning'))).toHaveCount(0)
})

test('the BGA name never overwrites the altered-draft name', { tag: ['@g-name'] }, async ({ seed, api }) => {
  const decklist = await seed.bgaDecklist('carol', { tournamentId: '610001', tournamentName: 'Autre', gameId: 'g2' })
  expect(names(decklist)).toEqual([`Random ${AUTUMN}`])
  const games = async () => (await api('carol').get('/api/tournament-bound-pools')).body.pools.find(p => p.tournamentId === '610001').gamesPlayed
  expect(await games()).toBe(2)
  await seed.bgaDecklist('carol', { tournamentId: '610001', tournamentName: 'Autre', gameId: 'g2' })
  expect(await games()).toBe(2)
})

test('an undeclared BGA id still binds the generic preparation pool', { tag: ['@g-legacy'] }, async ({ seed, db }) => {
  await seed.bgaDecklist('carol', { tournamentId: '424242', tournamentName: 'Legacy cup', gameId: 'g3' })
  const { rows } = await db.query("SELECT tournament_id, tournament_ref IS NULL AS legacy, tournament_name FROM sealed_pools WHERE tournament_id = '424242'")
  expect(rows).toEqual([{ tournament_id: '424242', legacy: true, tournament_name: 'Legacy cup' }])
})

test('declared after the fact: the played format is imposed', { tag: ['@g-adopt'] }, async ({ seed, openAs, db, api }) => {
  await seed.bgaDecklist('carol', { tournamentId: '474747', tournamentName: 'BGA name', gameId: 'g-474747' })
  const page = await openAs('alice')
  await page.goto('/tournament/new')
  await field(page, 'nameLabel').fill('Declared after the fact')
  await field(page, 'bgaUrlLabel').fill('https://boardgamearena.com/tournament?id=474747')
  await expect(page.getByRole('status')).toHaveText(tc('tournaments.legacyImposed', 1))
  await expect(page.getByRole('button', { name: 'Roots of Corruption' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Skybound Odyssey' })).toBeDisabled()
  await expect(page.getByRole('button', { name: t('settingsFields.freeChoice') })).toBeDisabled()
  for (const button of await page.getByTestId('uniques-guaranteed').getByRole('button').all()) await expect(button).toBeDisabled()

  await page.getByRole('button', { name: t('tournaments.submitCreate') }).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop()
  await expect(page.getByTestId('tournament-summary')).toContainText(new RegExp(`^${t('tournaments.summaryBoosters', { n: 7, set: 'Roots of Corruption' })}`))
  await expect(page.getByText(tc('tournaments.poolsPrepared', 1))).toBeVisible()
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(page.getByText(t('tournaments.lockedNotice'))).toBeVisible()

  const { rows } = await db.query("SELECT tournament_ref IS NOT NULL AS attached, tournament_name, set_code FROM sealed_pools WHERE tournament_id = '474747'")
  expect(rows).toEqual([{ attached: true, tournament_name: 'Declared after the fact', set_code: 'EOLE' }])
  expect((await api('carol').get(`/api/tournaments/${id}`)).body.viewer.hasPool).toBe(true)
  const carol = await openAs('carol')
  await carol.goto(`/tournament/t/${id}`)
  await expect(carol.getByRole('link', { name: t('tournaments.step2ButtonExisting') })).toBeVisible()
})

test('pools of different formats: the declaration is refused', { tag: ['@g-adopt-mixed'] }, async ({ seed, openAs, db, api }) => {
  await db.query(`INSERT INTO sealed_pools (sub, kind, set_code, unique_count, even_factions, heroes_in_pool, guaranteed_uniques, nonce, tournament_id, tournament_name, bound_at, cards, boosters, created_by)
    VALUES ('22222222-2222-2222-2222-222222222222', 'tournament', 'CYCLONE', 1, false, false, 1, 'acceptance-mixed', '484848', 'BGA name', now(), '{}', '[]', 'bga')`)
  try {
    await seed.bgaDecklist('carol', { tournamentId: '484848', tournamentName: 'BGA name', gameId: 'g-484848' })
    const page = await openAs('alice')
    await page.goto('/tournament/new')
    await field(page, 'bgaUrlLabel').fill('https://boardgamearena.com/tournament?id=484848')
    await expect(page.getByRole('alert').filter({ hasText: t('tournaments.errBgaMixed') })).toBeVisible()
    await expect(page.getByTestId('form-problems')).toContainText(t('tournaments.errBgaMixed'))
    await expect(page.getByRole('button', { name: t('tournaments.submitCreate') })).toBeDisabled()
    const res = await api('alice').post('/api/tournaments', tournamentBody({ bgaUrl: 'https://boardgamearena.com/tournament?id=484848' }))
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('bga_tournament_mixed_formats')
  } finally {
    await db.query("DELETE FROM sealed_pools WHERE tournament_id = '484848'")
  }
})

test('the pool-counts endpoint keeps its shape', { tag: ['@g-counts'] }, async ({ api }) => {
  const res = await api('carol').get('/api/tournament-pool-counts?tournamentId=123456')
  expect(res.status).toBe(200)
  expect(typeof res.body.id).toBe('string')
  expect(Object.keys(res.body.cards).length).toBeGreaterThan(0)
})
