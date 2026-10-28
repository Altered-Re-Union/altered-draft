// Acceptance group F — a BGA tournament declared by someone who does not organize it: the
// moderator detaches it, pools created for it go, pools that predate it stay and follow the
// real organizer's declaration.
import { test, expect, resetStack } from '../support/fixtures.js'
import { acceptNextDialog, captureNextDialog } from '../support/guards.js'
import { t, tc } from '../support/i18n.js'
import { openMenu, tournamentLink, waitForHub } from '../support/pages.js'
import { PERSONAS } from '../support/personas.js'

test.describe.configure({ mode: 'serial' })

const LINK = 'https://boardgamearena.com/tournament?id=777777'
const SET_NAMES = ['Beyond the Gates', 'Trial by Frost', 'Whisper from the Maze', 'Skybound Odyssey', 'Seeds of Unity', 'Roots of Corruption', 'Neverending Journey']

let squatId
let realId
let bobPoolId
let bobPoolCards
let bobDeckId

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const pill = page => page.getByTestId('tournament-status')
const panel = page => page.getByTestId('organizer-panel')

async function openDetail(openAs, who, tournamentId) {
  const page = await openAs(who)
  await page.goto(`/tournament/t/${tournamentId}`)
  await expect(pill(page)).toBeVisible()
  return page
}

async function declare(page, name) {
  await page.goto('/tournament/new')
  await field(page, 'nameLabel').fill(name)
  await field(page, 'bgaUrlLabel').fill(LINK)
  await expect(page.getByRole('status')).toHaveText(tc('tournaments.legacyImposed', 1))
  await expect(page.getByRole('button', { name: 'Roots of Corruption' })).toHaveAttribute('aria-pressed', 'true')
}

async function createDeclared(page) {
  await page.getByRole('button', { name: t('tournaments.submitCreate') }).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  return page.url().split('/').pop()
}

test.beforeAll(async () => {
  await resetStack()
})

test('preparing the squatted declaration', { tag: ['@f-squat-r3'] }, async ({ seed, openAs, api, db }) => {
  const decklist = await seed.bgaDecklist('bob', { tournamentId: '777777', tournamentName: 'BGA name', gameId: 'g-777777' })
  expect(decklist['hydra:member'][0].name).toBe('Random BGA name')
  bobDeckId = decklist['hydra:member'][0].id

  const carol = await openAs('carol')
  const lookups = []
  carol.on('request', req => { if (new URL(req.url()).pathname === '/api/tournaments') lookups.push(req.url()) })
  await carol.goto('/tournament/new')
  await expect(field(carol, 'nameLabel')).toBeVisible()
  expect(lookups).toEqual([])
  await declare(carol, 'Squat cup')
  for (const set of SET_NAMES) await expect(carol.getByRole('button', { name: set }), set).toBeDisabled()
  expect(lookups.filter(url => url.endsWith('/api/tournaments?bgaId=777777'))).toHaveLength(1)
  expect(lookups).toHaveLength(1)
  squatId = await createDeclared(carol)

  const alice = await openDetail(openAs, 'alice', squatId)
  await alice.getByRole('button', { name: t('tournaments.step2Button') }).click()
  await alice.waitForURL(`**/tournament/t/${squatId}/pool`)
  await alice.goto('/tournament/new')
  await field(alice, 'bgaUrlLabel').fill(LINK)
  await expect(alice.getByRole('alert').filter({ hasText: t('tournaments.errBgaTaken') })).toBeVisible()

  const { rows } = await db.query("SELECT sub, adopted_at IS NOT NULL AS adopted, set_code FROM sealed_pools WHERE tournament_id = '777777' ORDER BY sub")
  expect(rows).toEqual([
    { sub: PERSONAS.alice.sub, adopted: false, set_code: 'EOLE' },
    { sub: PERSONAS.bob.sub, adopted: true, set_code: 'EOLE' },
  ])
  const bound = (await api('bob').get('/api/tournament-bound-pools')).body.pools.find(p => p.tournamentId === '777777')
  bobPoolId = bound.id
  bobPoolCards = Object.keys((await api('bob').get(`/api/tournament-pool?id=${bobPoolId}`)).body.cards).sort()
})

test('no Detach button for an organizer who is not a moderator', { tag: ['@f-no-button'] }, async ({ openAs }) => {
  const page = await openDetail(openAs, 'carol', squatId)
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByRole('button', { name: t('tournaments.detach') })).toHaveCount(0)
})

test('the moderator sees the action and its warning', { tag: ['@f-button-r3'] }, async ({ openAs }) => {
  const page = await openDetail(openAs, 'bob', squatId)
  await expect(panel(page)).toBeVisible()
  await expect(panel(page).getByText(t('tournaments.detachHint'))).toBeVisible()
  const message = captureNextDialog(page)
  await panel(page).getByRole('button', { name: t('tournaments.detach') }).click()
  expect(await message).toBe(tc('tournaments.detachConfirm', 2))
})

test('detach: alice\'s pool deleted, bob\'s released, tournament frozen', { tag: ['@f-detach-r3'] }, async ({ openAs, db }) => {
  const page = await openDetail(openAs, 'bob', squatId)
  acceptNextDialog(page)
  await panel(page).getByRole('button', { name: t('tournaments.detach') }).click()
  await expect(pill(page)).toHaveText(t('tournaments.statusDetached'))
  await expect(page.getByText(t('tournaments.detachedNotice'))).toBeVisible()
  await expect(panel(page).getByRole('button', { name: t('tournaments.delete') })).toBeVisible()
  await expect(panel(page).getByRole('link', { name: t('tournaments.edit') })).toHaveCount(0)
  for (const key of ['cancel', 'close', 'detach']) await expect(panel(page).getByRole('button', { name: t(`tournaments.${key}`) })).toHaveCount(0)
  await expect(page.getByText(t('tournaments.step2Closed'))).toBeVisible()
  const { rows } = await db.query("SELECT sub, tournament_ref IS NULL AS released, adopted_at FROM sealed_pools WHERE tournament_id = '777777'")
  expect(rows).toEqual([{ sub: PERSONAS.bob.sub, released: true, adopted_at: null }])
})

test('alice lost her pool, bob kept his', { tag: ['@f-players-r3'] }, async ({ openAs, api }) => {
  const alice = await openAs('alice')
  for (const tab of ['pools', 'upcoming', 'ongoing']) {
    await openMenu(alice, `?tab=${tab}`)
    await expect(tournamentLink(alice, 'Squat cup'), tab).toHaveCount(0)
  }
  const bob = await openAs('bob')
  await openMenu(bob, '?tab=pools')
  await expect(tournamentLink(bob, 'Squat cup')).toHaveAttribute('href', `/tournament/pools/${bobPoolId}`)
  const pool = (await api('bob').get(`/api/tournament-pool?id=${bobPoolId}`)).body
  expect(Object.keys(pool.cards).sort()).toEqual(bobPoolCards)
  expect(pool.deck.id).toBe(bobDeckId)
})

test('the squatter can no longer change anything', { tag: ['@f-frozen'] }, async ({ openAs, api }) => {
  const page = await openAs('carol')
  await page.goto(`/tournament/t/${squatId}/edit`)
  await page.waitForURL(`**/tournament/t/${squatId}`)
  const res = await api('carol').patch(`/api/tournaments/${squatId}`, { name: 'Back' })
  expect(res.status).toBe(409)
  expect(res.body).toEqual({ error: 'tournament_detached' })
})

test('the real organizer redeclares and gets bob\'s pool', { tag: ['@f-redeclare-r3'] }, async ({ openAs, api, db }) => {
  const page = await openAs('alice')
  await declare(page, 'Real cup')
  realId = await createDeclared(page)
  await expect(page.getByText(tc('tournaments.poolsPrepared', 1))).toBeVisible()
  await page.goto(`/tournament/t/${realId}/edit`)
  await expect(page.getByText(t('tournaments.lockedNotice'))).toBeVisible()
  const squat = await api(null).get(`/api/tournaments/${squatId}`)
  expect(squat.status).toBe(200)
  expect(squat.body.status).toBe('detached')
  const { rows } = await db.query("SELECT sub, tournament_name, adopted_at IS NOT NULL AS adopted FROM sealed_pools WHERE tournament_id = '777777'")
  expect(rows).toEqual([{ sub: PERSONAS.bob.sub, tournament_name: 'Real cup', adopted: true }])
})

test('bob\'s next BGA call lands on his pool, under the new declaration', { tag: ['@f-bga-r3'] }, async ({ seed }) => {
  const decklist = await seed.bgaDecklist('bob', { tournamentId: '777777', tournamentName: 'BGA name', gameId: 'g-777777b' })
  expect(decklist['hydra:member']).toHaveLength(1)
  expect(decklist['hydra:member'][0]).toMatchObject({ id: bobDeckId, name: 'Random Real cup' })
})

test('the detached trace can be deleted', { tag: ['@f-delete'] }, async ({ openAs, api }) => {
  const page = await openDetail(openAs, 'bob', squatId)
  acceptNextDialog(page)
  await panel(page).getByRole('button', { name: t('tournaments.delete') }).click()
  await waitForHub(page)
  expect((await api(null).get(`/api/tournaments/${squatId}`)).status).toBe(404)
})
