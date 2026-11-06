// Acceptance page "Cube sealed and the player cap — V5" (acceptance-cube-sealed.html): the
// form's Cube tab (community cube, Re:Union decks, pasted list), the cube Settings (boosters,
// faction guarantee, hero pool, the player cap and the cube's capacity), the stored config and
// its summary, the public cube page, the deal (one lot of boosters per place, every copy once),
// the reveal's generated cover, the full tournament (page + 409), the cap on a set tournament,
// the API guards, the edit lock, the BGA path, French and 375 px. The fixtures hold CYCLONE /
// EOLE / FUGUE plus the All Commons cube's own refs of CORE / ALIZE / BISE / DUSTER.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '../support/fixtures.js'
import { ALL_COMMONS, cubeTournamentBody, tournamentBody } from '../support/api.js'
import { ROOT_DIR } from '../support/env.js'
import { expectNoHorizontalScroll } from '../support/guards.js'
import { openMenu, openPoolPage, tournamentLink } from '../support/pages.js'
import { storedPool } from '../support/pools.js'
import { t, tc, tFr } from '../support/i18n.js'
import { COMMUNITY_CUBES } from '../../../src/lib/cubes.js'
import { FACTION_NAMES } from '../../../src/lib/cardData.js'

const FIXTURE_SETS = ['CORE', 'ALIZE', 'BISE', 'CYCLONE', 'DUSTER', 'EOLE', 'FUGUE']
const BY_REF = new Map(FIXTURE_SETS.flatMap(set =>
  JSON.parse(fs.readFileSync(path.join(ROOT_DIR, `tests/e2e/fixtures/cards/${set}/${set}_EN.json`), 'utf8')).map(c => [c.reference, c])))
const factionOf = ref => BY_REF.get(ref)?.mainFaction.reference
const FACTIONS = ['AX', 'BR', 'LY', 'MU', 'OR', 'YZ']
const CUBE = COMMUNITY_CUBES.find(c => c.id === 'all-commons')
const SOFIA = 'ALT_BISE_P_BR_64_C'
const bga = id => `https://boardgamearena.com/tournament?id=${id}`
const RAW_KEY = /\b(tournaments|tournamentPages|tournamentPoolView|packReveal|cardZoom|cubePreview|settingsFields|topNav|reunion|common)\.[A-Za-z.]+\b/

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const sourceRadio = (page, key) => page.getByRole('radiogroup', { name: t('tournaments.sourceLabel') }).getByRole('radio', { name: t(`tournaments.${key}`) })
const submit = (page, key = 'submitCreate') => page.getByRole('button', { name: t(`tournaments.${key}`) })
const problems = page => page.getByTestId('form-problems')
const stepper = (page, id, sign) => page.getByTestId(id).getByRole('button', { name: sign, exact: true })
const stepperValue = (page, id) => page.getByTestId(id).locator('span')
const maxPlayers = page => page.getByTestId('max-players')
const heroCount = page => page.getByTestId('hero-pool-count')
const summary = page => page.getByTestId('tournament-summary')
const players = (scope, n, max) => expect(scope.getByTestId('tournament-players')).toHaveText(t('tournaments.playersOf', { n, max }))

async function clickTimes(locator, times) {
  for (let i = 0; i < times; i++) await locator.click()
}

async function openForm(openAs, who = 'alice') {
  const page = await openAs(who)
  await page.goto('/tournament/new')
  await expect(page.getByRole('heading', { name: t('tournaments.createTitle') })).toBeVisible()
  return page
}

// The Cube tab with the community "All Commons" cube chosen (its sets load live).
async function chooseCommons(page) {
  await sourceRadio(page, 'sourceCube').click()
  await page.getByTestId('cube-community-all-commons').click()
  await expect(page.getByTestId('cube-chosen')).toBeVisible({ timeout: 15_000 })
}

// Steps a stepper from its current value to `target`.
async function stepTo(page, id, target) {
  const now = Number(await stepperValue(page, id).innerText())
  await clickTimes(stepper(page, id, target > now ? '+' : '−'), Math.abs(target - now))
  await expect(stepperValue(page, id)).toHaveText(String(target))
}

const capacityLimit = (have, needed) => t('tournaments.cubeCapacityLimit', { limit: t('tournaments.capacityLimitTotal', { have, needed }) })
const tooSmall = (have, needed) => t('tournaments.errCubeTooSmall', { limit: t('tournaments.capacityLimitTotal', { have, needed }) })
const summaryText = (src, perFaction) => [
  t('tournaments.summaryCube', { n: src.boosters, cards: src.cardsPerBooster, name: src.name, total: ALL_COMMONS.cards }),
  t(`tournaments.summaryPerFaction${perFaction}`),
].join(' · ')

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('form: the third tab "Cube", its hint, the three panels; the community cube chosen', { tag: ['@cu-a-tab', '@cu-a-community'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  const radios = page.getByRole('radiogroup', { name: t('tournaments.sourceLabel') }).getByRole('radio')
  await expect(radios).toHaveText([t('tournaments.sourceSets'), t('tournaments.sourceFactionMix'), t('tournaments.sourceCube')])
  await sourceRadio(page, 'sourceCube').click()
  await expect(sourceRadio(page, 'sourceCube')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText(t('tournaments.cubeHint'))).toBeVisible()
  const titles = [t('tournaments.cubeCommunityTitle'), t('tournaments.cubeReunionTitle'), t('tournaments.cubePasteTitle')]
  for (const title of titles) await expect(page.getByText(title, { exact: true })).toBeVisible()
  const tops = await Promise.all(titles.map(async title => (await page.getByText(title, { exact: true }).boundingBox()).y))
  expect([...tops].sort((a, b) => a - b)).toEqual(tops)
  await expect(page.getByText(t('tournaments.cubeCommunityHint'))).toBeVisible()
  await expect(page.getByText(CUBE.name, { exact: true })).toBeVisible()
  await expect(problems(page)).toContainText(t('tournaments.errSelectCube'))

  await page.getByTestId('cube-community-all-commons').click()
  const chosen = page.getByTestId('cube-chosen')
  await expect(chosen).toBeVisible({ timeout: 15_000 })
  await expect(chosen).toContainText(t('tournaments.cubeChosenTitle'))
  await expect(page.getByTestId('cube-name')).toHaveValue(CUBE.name)
  await expect(chosen).toContainText(t('tournaments.cubeOriginCommunity'))
  await expect(page.getByTestId('cube-count')).toHaveText(tc('tournaments.cubeCount', ALL_COMMONS.cards, { distinct: ALL_COMMONS.cards }))
  await expect(chosen).toContainText(tc('tournaments.cubeHeroesFound', ALL_COMMONS.heroes))
  let sum = 0
  for (const f of FACTIONS) {
    const n = Number(await page.getByTestId(`cube-faction-${f}`).innerText())
    expect(n, f).toBe(32)
    sum += n
  }
  expect(sum).toBe(ALL_COMMONS.cards)
  await expect(page.getByTestId('cube-unresolved')).toHaveCount(0)
  await expect(heroCount(page)).toHaveText(tc('tournaments.heroPoolCount', ALL_COMMONS.heroes))
  await expect(problems(page).getByText(t('tournaments.errSelectCube'))).toHaveCount(0)

  await page.getByTestId('cube-preview').click()
  const modal = page.getByRole('heading', { name: CUBE.name })
  await expect(modal).toBeVisible()
  await page.getByRole('button', { name: '✕' }).click()
  await expect(modal).toHaveCount(0)

  await page.getByTestId('cube-change').click()
  await expect(page.getByTestId('cube-chosen')).toHaveCount(0)
  for (const title of titles) await expect(page.getByText(title, { exact: true })).toBeVisible()
  await expect(problems(page)).toContainText(t('tournaments.errSelectCube'))
})

test('form: two Re:Union decks loaded as one cube', { tag: ['@cu-a-reunion'] }, async ({ openAs, fakes }) => {
  const commons = [...BY_REF.values()].filter(c => c.reference.startsWith('ALT_CYCLONE_B_') && c.rarity.reference === 'COMMON' && c.cardType.reference !== 'HERO').map(c => c.reference)
  const deckA = await fakes.seedDeck('alice', { name: 'Deck A', deckCards: commons.slice(0, 20).map(cardReference => ({ cardReference, quantity: 1 })) })
  const deckB = await fakes.seedDeck('alice', { name: 'Deck B', deckCards: commons.slice(20, 40).map(cardReference => ({ cardReference, quantity: 1 })) })
  const page = await openForm(openAs)
  await sourceRadio(page, 'sourceCube').click()
  await page.getByTestId('cube-reunion-load').click()
  const importButton = page.getByTestId('cube-reunion-import')
  await expect(importButton).toHaveText(t('tournaments.cubeReunionImportZero'))
  await expect(importButton).toBeDisabled()
  await page.getByTestId('cube-reunion-search').fill('zzzz')
  await expect(page.getByText(t('tournaments.cubeReunionNoMatch'))).toBeVisible()
  await page.getByTestId('cube-reunion-search').fill('')
  await page.getByTestId(`cube-reunion-deck-${deckA.id}`).click()
  await page.getByTestId(`cube-reunion-deck-${deckB.id}`).click()
  await expect(importButton).toHaveText(tc('tournaments.cubeReunionImport', 2))
  await importButton.click()
  await expect(page.getByTestId('cube-chosen')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('cube-chosen')).toContainText(t('tournaments.cubeOriginReunion'))
  await expect(page.getByTestId('cube-name')).toHaveValue(t('tournaments.cubeDecksName', { n: 2 }))
  await expect(page.getByTestId('cube-count')).toHaveText(tc('tournaments.cubeCount', 40, { distinct: 40 }))
  await expect(page.getByTestId('cube-unresolved')).toHaveCount(0)
})

test('form: a pasted list (alt-art, promo-only, unknown, bad serial, hero) and its stored refs', { tag: ['@cu-a-paste'] }, async ({ openAs, api }) => {
  const hero = [...BY_REF.values()].find(c => c.reference.startsWith('ALT_CYCLONE_B_') && c.cardType.reference === 'HERO').reference
  const common = [...BY_REF.values()].find(c => c.reference.startsWith('ALT_CYCLONE_B_BR_') && c.rarity.reference === 'COMMON' && c.cardType.reference !== 'HERO' && !CUBE.refs.includes(c.reference)).reference
  const odd = ['1 ALT_DUSTEROP_A_AX_98_C', `1 ${SOFIA}`, '1 ALT_NOPE_B_AX_01_C', '1 ALT_CYCLONE_B_AX_04_U_999999999', `1 ${hero}`, `2 ${common}`]
  const page = await openForm(openAs)
  await sourceRadio(page, 'sourceCube').click()
  await page.getByTestId('cube-paste-name').fill('Pasted test')
  await page.getByTestId('cube-paste-text').fill(odd.join('\n'))
  await page.getByTestId('cube-paste-parse').click()
  const chosen = page.getByTestId('cube-chosen')
  await expect(chosen).toBeVisible({ timeout: 15_000 })
  await expect(chosen).toContainText(t('tournaments.cubeOriginPaste'))
  await expect(page.getByTestId('cube-name')).toHaveValue('Pasted test')
  await expect(page.getByTestId('cube-unresolved')).toHaveText(`${tc('tournaments.cubeUnresolved', 2)} ALT_NOPE_B_AX_01_C, ALT_CYCLONE_B_AX_04_U_999999999`)
  await expect(chosen).toContainText(tc('tournaments.cubeHeroesFound', 1))
  await expect(heroCount(page)).toHaveText(tc('tournaments.heroPoolCount', 1))
  await expect(page.getByTestId('cube-count')).toHaveText(tc('tournaments.cubeCount', 4, { distinct: 3 }))

  // Change cube: the pasted text and the name stay in the paste panel. Big enough to create:
  // the same odd lines plus the All Commons cards (the two shared refs left to the odd lines).
  await page.getByTestId('cube-change').click()
  await expect(page.getByTestId('cube-paste-name')).toHaveValue('Pasted test')
  await expect(page.getByTestId('cube-paste-text')).toHaveValue(odd.join('\n'))
  const filler = CUBE.refs.filter(r => r !== 'ALT_DUSTER_B_AX_98_C' && r !== SOFIA).map(r => `1 ${r}`)
  await page.getByTestId('cube-paste-name').fill('Pasted cube')
  await page.getByTestId('cube-paste-text').fill([...odd, ...filler].join('\n'))
  await page.getByTestId('cube-paste-parse').click()
  await expect(page.getByTestId('cube-count')).toHaveText(tc('tournaments.cubeCount', ALL_COMMONS.cards + 2, { distinct: ALL_COMMONS.cards + 1 }), { timeout: 15_000 })
  await field(page, 'nameLabel').fill('Pasted cube')
  await field(page, 'bgaUrlLabel').fill(bga(123514))
  await stepTo(page, 'cube-boosters', 6)
  await stepTo(page, 'cube-cards-per-booster', 10)
  await maxPlayers(page).fill('3')
  await expect(problems(page)).toHaveCount(0)
  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  const { body } = await api(null).get(`/api/tournaments/${page.url().split('/').pop()}`)
  const src = body.config.source
  expect(src).toMatchObject({ type: 'cube', name: 'Pasted cube', origin: 'paste', cubeId: null })
  expect(src.cards).toMatchObject({ ALT_DUSTER_B_AX_98_C: 1, [SOFIA]: 1, [common]: 2 })
  for (const ref of ['ALT_DUSTEROP_A_AX_98_C', 'ALT_NOPE_B_AX_01_C', 'ALT_CYCLONE_B_AX_04_U_999999999', hero]) expect(src.cards, ref).not.toHaveProperty(ref)
  expect(src.heroPool).toEqual([hero])
})

test('form: Cube ↔ Sets keeps each tab’s state', { tag: ['@cu-a-switch'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await chooseCommons(page)
  await sourceRadio(page, 'sourceSets').click()
  const sky = page.getByRole('button', { name: 'Skybound Odyssey' })
  await sky.click()
  await expect(sky).toHaveAttribute('aria-pressed', 'true')
  await sourceRadio(page, 'sourceCube').click()
  await expect(page.getByTestId('cube-name')).toHaveValue(CUBE.name)
  await page.getByTestId('cube-name').fill('My commons')
  await sourceRadio(page, 'sourceSets').click()
  await expect(sky).toHaveAttribute('aria-pressed', 'true')
  await sourceRadio(page, 'sourceCube').click()
  await expect(page.getByTestId('cube-name')).toHaveValue('My commons')
  await expect(page.getByTestId('cube-count')).toHaveText(tc('tournaments.cubeCount', ALL_COMMONS.cards, { distinct: ALL_COMMONS.cards }))
})

test('form: the cube Settings — steppers, faction guarantee, heroes, capacity, too small', { tag: ['@cu-b-boosters', '@cu-b-heroes', '@cu-b-capacity', '@cu-b-too-small'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Settings cube')
  await field(page, 'bgaUrlLabel').fill(bga(123518))
  await chooseCommons(page)

  // Boosters: defaults 7 × 12, one of each faction; the pool line.
  await expect(stepperValue(page, 'cube-boosters')).toHaveText('7')
  await expect(stepperValue(page, 'cube-cards-per-booster')).toHaveText('12')
  await expect(page.getByTestId('cube-per-faction-1')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(t('tournaments.cubeCardsPerBoosterHint'))).toBeVisible()
  await expect(page.getByTestId('cube-pool-line')).toHaveText(t('tournaments.cubePoolLine', { cards: 84, boosters: 7, perBooster: 12 }) + t('tournaments.cubePoolLineHero'))
  // The capacity at 7 × 12: 2 players, the field prefilled.
  await expect(page.getByTestId('max-players-capacity')).toHaveText(t('tournaments.cubeCapacityLine', { n: 2 }))
  await expect(page.getByTestId('max-players-limit')).toHaveText(capacityLimit(ALL_COMMONS.cards, 84))
  await expect(maxPlayers(page)).toHaveValue('2')

  // The bounds.
  await stepTo(page, 'cube-boosters', 3)
  await expect(stepper(page, 'cube-boosters', '−')).toBeDisabled()
  await stepTo(page, 'cube-boosters', 8)
  await expect(stepper(page, 'cube-boosters', '+')).toBeDisabled()
  await stepTo(page, 'cube-cards-per-booster', 10)
  await expect(stepper(page, 'cube-cards-per-booster', '−')).toBeDisabled()
  await stepTo(page, 'cube-cards-per-booster', 16)
  await expect(stepper(page, 'cube-cards-per-booster', '+')).toBeDisabled()

  // 8 × 16 = 128 per player: the cube cannot serve 2 players.
  await expect(problems(page)).toContainText(tooSmall(ALL_COMMONS.cards, 128))
  await expect(page.getByTestId('max-players-capacity')).toHaveText(tooSmall(ALL_COMMONS.cards, 128))
  await expect(submit(page)).toBeDisabled()

  // Two of each faction: 12 cards per booster at least.
  await stepTo(page, 'cube-cards-per-booster', 12)
  await expect(page.getByTestId('cube-per-faction-2')).toBeEnabled()
  await page.getByTestId('cube-per-faction-2').click()
  await stepTo(page, 'cube-cards-per-booster', 11)
  await expect(page.getByTestId('cube-per-faction-2')).toBeDisabled()
  await expect(problems(page)).toContainText(t('tournaments.errCubePerFaction'))
  await page.getByTestId('cube-per-faction-1').click()
  await expect(problems(page).getByText(t('tournaments.errCubePerFaction'))).toHaveCount(0)

  // 3 × 10 = 30 cards: below the 60-card minimum.
  await stepTo(page, 'cube-boosters', 3)
  await stepTo(page, 'cube-cards-per-booster', 10)
  await expect(problems(page)).toContainText(t('tournaments.errCubePoolSize', { n: 30 }))

  // 6 × 10: 3 players.
  await stepTo(page, 'cube-boosters', 6)
  await expect(page.getByTestId('cube-pool-line')).toHaveText(t('tournaments.cubePoolLine', { cards: 60, boosters: 6, perBooster: 10 }) + t('tournaments.cubePoolLineHero'))
  await expect(page.getByTestId('max-players-capacity')).toHaveText(t('tournaments.cubeCapacityLine', { n: 3 }))
  await expect(page.getByTestId('max-players-limit')).toHaveText(capacityLimit(ALL_COMMONS.cards, 60))
  await maxPlayers(page).fill('4')
  await expect(problems(page)).toContainText(t('tournaments.errMaxPlayersCapacity', { n: 3 }))
  await maxPlayers(page).fill('2')
  await expect(problems(page)).toHaveCount(0)
  await maxPlayers(page).fill('')
  await expect(problems(page)).toContainText(t('tournaments.errMaxPlayersRequired'))
  await maxPlayers(page).fill('1')
  await expect(problems(page)).toContainText(t('tournaments.errMaxPlayers'))
  await maxPlayers(page).fill('3')
  await expect(problems(page)).toHaveCount(0)

  // Heroes: the two modes, the picker.
  await expect(page.getByTestId('hero-mode-packs')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('hero-mode-free')).toHaveAttribute('aria-pressed', 'false')
  await expect(heroCount(page)).toHaveText(tc('tournaments.heroPoolCount', 12))
  await expect(page.getByText(t('tournaments.heroPoolFromCube'))).toBeVisible()
  await page.getByTestId('hero-pool-open').click()
  for (const ref of CUBE.heroes) await expect(page.getByTestId(`hero-chip-${ref}`)).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  await page.getByTestId('hero-faction-none-AX').click()
  await expect(heroCount(page)).toHaveText(tc('tournaments.heroPoolCount', 10))
  await page.getByTestId('hero-faction-all-AX').click()
  const allAx = [...BY_REF.values()].filter(c => c.cardType.reference === 'HERO' && c.mainFaction.reference === 'AX' && c.reference.split('_')[2] === 'B').length
  await expect(heroCount(page)).toHaveText(tc('tournaments.heroPoolCount', 10 + allAx))
  const axHero = CUBE.heroes.find(r => factionOf(r) === 'AX')
  const firstName = BY_REF.get(axHero).name.split(',')[0]
  await page.getByTestId('hero-pool-search').fill(firstName)
  await expect(page.getByTestId(`hero-chip-${axHero}`)).toBeVisible()
  await expect(page.getByTestId(`hero-chip-${CUBE.heroes.find(r => factionOf(r) === 'BR')}`)).toHaveCount(0)
  await page.getByTestId('hero-pool-search').fill('')
  for (const f of FACTIONS) await page.getByTestId(`hero-faction-none-${f}`).click()
  await expect(heroCount(page)).toHaveText(tc('tournaments.heroPoolCount', 0))
  await expect(problems(page)).toContainText(t('tournaments.errCubeNoHero'))
  await page.getByTestId(`hero-chip-${axHero}`).click()
  await expect(heroCount(page)).toHaveText(tc('tournaments.heroPoolCount', 1))
  await expect(problems(page)).toHaveCount(0)
  await page.getByTestId('hero-pool-close').click()
  await expect(page.getByTestId('hero-pool-search')).toHaveCount(0)
})

test.fixme('form: the cap follows a capacity that rises from its prefill (7 × 12 → 6 × 10)', { tag: ['@cu-b-capacity'] }, async ({ openAs }) => {
  // The acceptance step: at 7 × 12 the field is prefilled with 2; at 6 × 10 "the field follows to 3
  // (it follows while it was untouched or above the capacity)". The form only follows when the
  // field is empty or above the capacity, so an untouched prefill of 2 stays 2.
  const page = await openForm(openAs)
  await chooseCommons(page)
  await expect(maxPlayers(page)).toHaveValue('2')
  await stepTo(page, 'cube-boosters', 6)
  await stepTo(page, 'cube-cards-per-booster', 10)
  await expect(page.getByTestId('max-players-capacity')).toHaveText(t('tournaments.cubeCapacityLine', { n: 3 }))
  await expect(maxPlayers(page)).toHaveValue('3')
})

test('create "Commons cube" through the form: stored config, summary, "0 / 3 players"', { tag: ['@cu-c-create', '@cu-c-summary'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Commons cube')
  await field(page, 'bgaUrlLabel').fill(bga(123510))
  await chooseCommons(page)
  await stepTo(page, 'cube-boosters', 6)
  await stepTo(page, 'cube-cards-per-booster', 10)
  await expect(page.getByTestId('max-players-capacity')).toHaveText(t('tournaments.cubeCapacityLine', { n: 3 }))
  await maxPlayers(page).fill('3')
  await expect(problems(page)).toHaveCount(0)
  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop()

  const { body } = await api(null).get(`/api/tournaments/${id}`)
  expect(body.maxPlayers).toBe(3)
  expect(body.config.source).toMatchObject({ type: 'cube', name: CUBE.name, origin: 'community', cubeId: 'all-commons', boosters: 6, cardsPerBooster: 10, perFaction: 1 })
  expect(Object.keys(body.config.source.cards)).toHaveLength(ALL_COMMONS.cards)
  expect(Object.values(body.config.source.cards).reduce((a, b) => a + b, 0)).toBe(ALL_COMMONS.cards)
  expect(body.config.source.cards).toHaveProperty(SOFIA)
  expect(body.config.source.heroPool).toHaveLength(ALL_COMMONS.heroes)
  expect(body.config.heroes).toBe('packs')
  expect(body.config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null })
  expect(body.config.excludeBanlist).toBe(false)

  await expect(summary(page)).toHaveText(summaryText({ boosters: 6, cardsPerBooster: 10, name: CUBE.name }, 1))
  await players(page.locator('header'), 0, 3)
  await expect(page.getByTestId('tournament-full')).toHaveCount(0)

  for (const tab of ['upcoming', 'created']) {
    const panel = await openMenu(page, `?tab=${tab}`)
    const card = tournamentLink(panel, 'Commons cube')
    await expect(card, tab).toContainText(summaryText({ boosters: 6, cardsPerBooster: 10, name: CUBE.name }, 1))
    await players(card, 0, 3)
  }
})

test('the cube page: the link, the header, the heroes, the contents; a set tournament redirects', { tag: ['@cu-d-link', '@cu-d-page', '@cu-d-redirect'] }, async ({ openAs, seed }) => {
  const body = cubeTournamentBody()
  const { id } = await seed.tournament('alice', body)
  const page = await openAs(null)
  await page.goto(`/tournament/t/${id}`)
  await expect(page.getByTestId('cube-link')).toHaveText(t('tournaments.cubeLink', { n: ALL_COMMONS.cards }))
  await page.getByTestId('cube-link').click()
  await page.waitForURL(`**/tournament/t/${id}/cube`)

  const header = page.getByTestId('cube-page')
  await expect(header.getByRole('heading', { level: 1 })).toHaveText(t('tournaments.cubePageOf', { name: body.name }))
  await expect(header).toContainText(body.config.source.name)
  await expect(header).toContainText(t('tournaments.cubeOriginCommunity'))
  await expect(header.getByTestId('tournament-summary')).toHaveText(summaryText(body.config.source, 1))
  await players(header, 0, 3)

  const heroes = page.getByTestId('cube-page-heroes')
  await expect(heroes.getByRole('heading')).toHaveText(t('tournaments.cubePageHeroesTitle', { n: 12 }))
  await expect(heroes).toContainText(t('tournaments.cubePageHeroesPacks'))
  await expect(heroes.getByRole('listitem')).toHaveCount(12)
  for (const ref of CUBE.heroes) await expect(heroes.getByText(BY_REF.get(ref).name, { exact: true })).toBeVisible()

  // The sidebar's faction counts, the search.
  for (const f of FACTIONS) {
    await expect(page.getByText(FACTION_NAMES[f], { exact: true }).first().locator('xpath=following-sibling::span[1]'), f).toHaveText('32')
  }
  const search = page.getByPlaceholder(t('cubePreview.searchPlaceholder'))
  const sofia = BY_REF.get(SOFIA).name
  await search.fill(sofia.split(',')[0])
  await expect(page.getByText(sofia).first()).toBeVisible()
  await expect(page.getByText(BY_REF.get(CUBE.refs.find(r => r !== SOFIA)).name, { exact: true })).toHaveCount(0)

  // The pool page's "Cube" link.
  const alice = await openPoolPage({ openAs, seed }, 'alice', id, body.name)
  await alice.getByTestId('pool-cube-link').click()
  await alice.waitForURL(`**/tournament/t/${id}/cube`)
  await expect(alice.getByTestId('cube-page')).toBeVisible()

  // A set tournament's /cube lands on its own page.
  const set = await seed.tournament('alice', tournamentBody({ name: 'Capped set cup', bgaUrl: bga(123512) }))
  await page.goto(`/tournament/t/${set.id}/cube`)
  await page.waitForURL(new RegExp(`/tournament/t/${set.id}$`))
  await expect(page.getByRole('heading', { name: 'Capped set cup', exact: true })).toBeVisible()
  await expect(page.getByTestId('cube-page')).toHaveCount(0)
})

test('the deal: three lots, slots 0 / 1 / 2, hero first, one card per faction, every copy once', { tag: ['@cu-e-first', '@cu-e-composition', '@cu-e-others'] }, async ({ seed, db, openAs }) => {
  const body = cubeTournamentBody()
  const { id } = await seed.tournament('alice', body)
  const src = body.config.source
  const pools = []
  for (const [i, who] of ['alice', 'bob', 'carol'].entries()) {
    await seed.pool(who, id)
    const { rows } = await db.query('SELECT count(*)::int AS n FROM tournament_cube_slots WHERE tournament_ref = $1', [id])
    expect(rows[0].n, `lots after ${who}`).toBe(3)
    const pool = await storedPool(db, id, who)
    expect(pool.cube_slot, who).toBe(i)
    pools.push(pool)
  }
  const dealt = []
  for (const pool of pools) {
    expect(pool.boosters).toHaveLength(6)
    const heroes = pool.boosters.map(b => b[0])
    expect(new Set(heroes).size).toBe(6)
    const counts = {}
    for (const booster of pool.boosters) {
      expect(booster, booster.join(' ')).toHaveLength(11)
      expect(src.heroPool, booster[0]).toContain(booster[0])
      expect(booster.slice(1, 7).map(factionOf), booster.join(' ')).toEqual(FACTIONS)
      for (const ref of booster.slice(1)) {
        expect(src.cards, ref).toHaveProperty(ref)
        dealt.push(ref)
      }
      for (const ref of booster) counts[ref] = (counts[ref] ?? 0) + 1
    }
    expect(pool.cards).toEqual(counts)
  }
  // Every cube card is a single copy: no ref dealt twice across the three pools.
  expect(dealt).toHaveLength(180)
  expect(new Set(dealt).size).toBe(180)

  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}`)
  await players(page.locator('header'), 3, 3)
  await expect(page.getByTestId('tournament-full')).toHaveText(t('tournaments.fullBadge'))
  await expect(page.getByTestId('tournament-full')).toHaveAttribute('title', t('tournaments.fullBadgeTitle'))
  // A pool already opened is still returned once the tournament is full.
  const again = await seed.pool('alice', id)
  expect(again.cards).toEqual((await storedPool(db, id, 'alice')).cards)
})

test('the reveal: the generated cover, 6 boosters, no bonus pack', { tag: ['@cu-e-reveal'] }, async ({ openAs, seed }) => {
  const body = cubeTournamentBody()
  const { id } = await seed.tournament('alice', body)
  await seed.pool('alice', id)
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}/pool`)
  await expect(page.getByRole('heading', { name: t('packReveal.openingYourPool') })).toBeVisible()
  const cover = page.locator('img[src^="data:image/png"]')
  const sublabel = t('packReveal.cubeBooster', { name: body.config.source.name })
  for (let n = 1; n <= 6; n++) {
    if (n > 1) await page.getByRole('button', { name: t('packReveal.nextBooster') }).dispatchEvent('click')
    await expect(page.getByText(t('packReveal.boosterOf', { n, total: 6 })).first()).toBeVisible()
    await expect(page.getByText(sublabel).first()).toBeVisible()
    await expect(cover.first(), `booster ${n}`).toBeVisible()
    await expect(page.getByRole('button', { name: t('cardZoom.openBooster') }).first(), `booster ${n}`).toBeVisible()
  }
  await expect(page.getByText(t('packReveal.guaranteedUnique'))).toHaveCount(0)
  await expect(page.getByRole('button', { name: t('packReveal.nextBooster') })).toHaveCount(0)
})

test('BGA: a deck taken from the pool; a player without a pool gets a slot and a deck', { tag: ['@cu-e-deck', '@cu-j-bga'] }, async ({ seed, db, fakes }) => {
  const { id } = await seed.tournament('alice', cubeTournamentBody())
  await seed.pool('alice', id)
  for (const who of ['alice', 'carol']) {
    const decklist = await seed.bgaDecklist(who, { tournamentId: '123510', tournamentName: 'Commons cube', gameId: `g-${who}` })
    expect(decklist['hydra:member'], who).toHaveLength(1)
    const [member] = decklist['hydra:member']
    const pool = await storedPool(db, id, who)
    const deck = (await fakes.decks(who)).find(d => d.id === member.id)
    expect(deck, who).toBeTruthy()
    expect(deck.deckCards.length, who).toBeGreaterThan(0)
    for (const { cardReference, quantity } of deck.deckCards) {
      expect(pool.cards[cardReference.toUpperCase()] ?? 0, `${who} ${cardReference}`).toBeGreaterThanOrEqual(quantity)
    }
  }
  expect((await storedPool(db, id, 'carol')).cube_slot).toBe(1)
  const { rows } = await db.query("SELECT created_by FROM sealed_pools WHERE tournament_ref = $1 ORDER BY cube_slot", [id])
  expect(rows.map(r => r.created_by)).toEqual(['page', 'bga'])
})

test('"Full cup": carol is refused on the page and the API; free heroes in every pool', { tag: ['@cu-f-page', '@cu-f-api', '@cu-f-free'] }, async ({ seed, db, api, openAs }) => {
  const { id } = await seed.tournament('alice', cubeTournamentBody({ name: 'Full cup', bgaUrl: bga(123511), maxPlayers: 2 }))
  await seed.pool('alice', id)
  await seed.pool('bob', id)

  const page = await openAs('carol')
  await page.goto(`/tournament/t/${id}`)
  await expect(page.getByTestId('step2-full')).toHaveText(t('tournaments.step2Full', { max: 2 }))
  await expect(page.getByRole('button', { name: t('tournaments.step2Button') })).toHaveCount(0)
  await players(page.locator('header'), 2, 2)
  await expect(page.getByTestId('tournament-full')).toBeVisible()

  // A direct link to the pool page: the sentence, never the raw 409 code.
  await page.goto(`/tournament/t/${id}/pool`)
  await expect(page.getByText(t('tournaments.step2Full', { max: 2 }))).toBeVisible()
  await expect(page.getByText('tournament_full')).toHaveCount(0)

  const pool = await api('carol').get(`/api/tournaments/${id}/pool`)
  expect(pool.status).toBe(409)
  expect(pool.body).toEqual({ error: 'tournament_full', maxPlayers: 2 })
  const decklist = await api('carol').get('/api/tournament-bga-decklist?tournamentId=123511&tournamentName=Full%20cup')
  expect(decklist.status).toBe(409)
  expect(decklist.body).toEqual({ error: 'tournament_full' })
  expect((await api('alice').get('/api/tournament-bga-decklist?tournamentId=123511&tournamentName=Full%20cup')).status).toBe(200)
  const { rows } = await db.query('SELECT count(*)::int AS n FROM sealed_pools WHERE tournament_ref = $1', [id])
  expect(rows[0].n).toBe(2)

  const base = cubeTournamentBody()
  const heroPool = CUBE.heroes.slice(0, 3)
  const free = await seed.tournament('alice', cubeTournamentBody({
    name: 'Free heroes cube', bgaUrl: bga(123517),
    config: { ...base.config, heroes: 'free', source: { ...base.config.source, heroPool } },
  }))
  for (const who of ['alice', 'bob']) {
    await seed.pool(who, free.id)
    const stored = await storedPool(db, free.id, who)
    for (const ref of heroPool) expect(stored.cards, `${who} ${ref}`).toHaveProperty(ref)
    expect(stored.boosters).toHaveLength(6)
    for (const booster of stored.boosters) {
      expect(booster, booster.join(' ')).toHaveLength(10)
      for (const ref of booster) expect(heroPool, ref).not.toContain(ref)
    }
  }
  const tn = await openAs('alice')
  await tn.goto(`/tournament/t/${free.id}`)
  await expect(summary(tn)).toContainText(t('tournaments.summaryHeroesFree'))
  await tn.goto(`/tournament/t/${free.id}/cube`)
  await expect(tn.getByTestId('cube-page-heroes')).toContainText(t('tournaments.cubePageHeroesTitle', { n: 3 }))
  await expect(tn.getByTestId('cube-page-heroes')).toContainText(t('tournaments.cubePageHeroesFree'))
})

test('"Capped set cup": the cap on a set tournament, full, raised, refused below the pools, cleared', { tag: ['@cu-g-create', '@cu-g-full', '@cu-g-lower'] }, async ({ openAs, seed, api }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Capped set cup')
  await field(page, 'bgaUrlLabel').fill(bga(123512))
  await page.getByRole('button', { name: 'Skybound Odyssey' }).click()
  await expect(maxPlayers(page)).toHaveValue('')
  await expect(maxPlayers(page)).toHaveAttribute('placeholder', t('tournaments.maxPlayersNoLimit'))
  await maxPlayers(page).fill('2')
  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  const id = page.url().split('/').pop()
  expect((await api(null).get(`/api/tournaments/${id}`)).body.maxPlayers).toBe(2)
  await players(page.locator('header'), 0, 2)
  const panel = await openMenu(page, '?tab=upcoming')
  await players(tournamentLink(panel, 'Capped set cup'), 0, 2)

  // Two pools: carol is refused.
  await seed.pool('alice', id)
  await seed.pool('bob', id)
  const refused = await api('carol').get(`/api/tournaments/${id}/pool`)
  expect(refused.status).toBe(409)
  expect(refused.body).toEqual({ error: 'tournament_full', maxPlayers: 2 })
  const carol = await openAs('carol')
  await carol.goto(`/tournament/t/${id}`)
  await expect(carol.getByTestId('step2-full')).toHaveText(t('tournaments.step2Full', { max: 2 }))
  await expect(carol.getByRole('button', { name: t('tournaments.step2Button') })).toHaveCount(0)
  await players(carol.locator('header'), 2, 2)
  await expect(carol.getByTestId('tournament-full')).toBeVisible()

  // Raise to 3 with pools: the cap stays editable on a locked set tournament.
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(page.getByText(t('tournaments.lockedNotice'))).toBeVisible()
  await expect(maxPlayers(page)).toBeEnabled()
  await expect(maxPlayers(page)).toHaveValue('2')
  await maxPlayers(page).fill('3')
  await submit(page, 'submitSave').click()
  await page.waitForURL(new RegExp(`/tournament/t/${id}$`))
  expect((await api(null).get(`/api/tournaments/${id}`)).body.maxPlayers).toBe(3)
  await players(page.locator('header'), 2, 3)
  await expect(page.getByTestId('tournament-full')).toHaveCount(0)

  await seed.pool('carol', id)
  await page.reload()
  await players(page.locator('header'), 3, 3)
  await expect(page.getByTestId('tournament-full')).toBeVisible()

  // Below the pool count: refused; out of range: the range message instead.
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(maxPlayers(page)).toHaveValue('3')
  await maxPlayers(page).fill('2')
  await expect(problems(page)).toContainText(t('tournaments.errMaxPlayersBelowPools', { n: 3 }))
  await expect(submit(page, 'submitSave')).toBeDisabled()
  await maxPlayers(page).fill('1')
  await expect(problems(page)).toContainText(t('tournaments.errMaxPlayers'))
  await expect(problems(page).getByText(t('tournaments.errMaxPlayersBelowPools', { n: 3 }))).toHaveCount(0)
  await expect(submit(page, 'submitSave')).toBeDisabled()

  const below = await api('alice').patch(`/api/tournaments/${id}`, { maxPlayers: 2 })
  expect(below.status).toBe(400)
  expect(below.body).toMatchObject({ error: 'invalid_request', fields: { maxPlayers: 'below_pool_count' } })
  const one = await api('alice').patch(`/api/tournaments/${id}`, { maxPlayers: 1 })
  expect(one.status).toBe(400)
  expect(one.body).toMatchObject({ fields: { maxPlayers: 'invalid_max_players' } })

  // Cleared: no limit.
  await maxPlayers(page).fill('')
  await expect(problems(page)).toHaveCount(0)
  await submit(page, 'submitSave').click()
  await page.waitForURL(new RegExp(`/tournament/t/${id}$`))
  expect((await api(null).get(`/api/tournaments/${id}`)).body.maxPlayers).toBeNull()
  await expect(page.getByTestId('tournament-players')).toHaveCount(0)
  await expect(page.getByText(tc('tournaments.poolsPrepared', 3))).toBeVisible()
})

test('API: every cube refusal and its code; the cap locked once a pool exists, the name not', { tag: ['@cu-h-api', '@cu-h-locked'] }, async ({ api, seed }) => {
  const base = () => structuredClone(cubeTournamentBody({ name: 'Guard', bgaUrl: bga(123515) }))
  const cases = [
    ['boosters 2', b => { b.config.source.boosters = 2 }, { config: ['source.boosters'] }],
    ['cards per booster 9', b => { b.config.source.cardsPerBooster = 9 }, { config: ['source.cardsPerBooster'] }],
    ['perFaction 2, 11 cards', b => { b.config.source.perFaction = 2; b.config.source.cardsPerBooster = 11 }, { config: ['source.perFaction'] }],
    ['3 x 10 (pool size)', b => { b.config.source.boosters = 3 }, { config: ['source.poolSize'] }],
    ['unknown ref', b => { b.config.source.cards.ALT_CORE_B_AX_99_C = 1 }, { config: ['source.cards.unresolved'], unresolved: ['ALT_CORE_B_AX_99_C'] }],
    ['a hero in cards', b => { b.config.source.cards[CUBE.heroes[0]] = 1 }, { config: ['source.cards'] }],
    ['a non-hero in heroPool', b => { b.config.source.heroPool = [CUBE.refs[0]] }, { config: ['source.heroPool'] }],
    ['no cap', b => { delete b.maxPlayers }, { fields: { maxPlayers: 'required_for_cube' } }],
    ['cap 9', b => { b.maxPlayers = 9 }, { fields: { maxPlayers: 'above_capacity' }, capacity: 3 }],
    ['cap 1', b => { b.maxPlayers = 1 }, { fields: { maxPlayers: 'invalid_max_players' } }],
    ['capacity below 2', b => { b.config.source.boosters = 8; b.config.source.cardsPerBooster = 16; b.maxPlayers = 2 }, { config: ['source.capacity'], capacity: 1 }],
    ['unknown origin', b => { b.config.source.origin = 'nowhere' }, { config: ['source.origin'] }],
    ['sum over 1500', b => { for (const k of Object.keys(b.config.source.cards)) b.config.source.cards[k] = 99 }, { config: ['source.cards'] }],
  ]
  for (const [label, edit, expected] of cases) {
    const b = base()
    edit(b)
    const res = await api('alice').post('/api/tournaments', b)
    expect(res.status, label).toBe(400)
    if (expected.config) expect(res.body.config, label).toEqual(expected.config)
    if (expected.fields) expect(res.body.fields, label).toEqual(expected.fields)
    if (expected.unresolved) expect(res.body.unresolved, label).toEqual(expected.unresolved)
    if (expected.capacity) expect(res.body.capacity?.players ?? res.body.capacity, label).toBe(expected.capacity)
  }
  expect((await api('alice').get('/api/tournaments?bgaId=123515')).body.tournaments).toEqual([])

  const { id } = await seed.tournament('alice', cubeTournamentBody())
  await seed.pool('bob', id)
  const locked = await api('alice').patch(`/api/tournaments/${id}`, { maxPlayers: 2 })
  expect(locked.status).toBe(409)
  expect(locked.body).toEqual({ error: 'tournament_locked' })
  const renamed = await api('alice').patch(`/api/tournaments/${id}`, { name: 'Renamed' })
  expect(renamed.status).toBe(200)
  expect((await api(null).get(`/api/tournaments/${id}`)).body).toMatchObject({ name: 'Renamed', maxPlayers: 3 })
})

test('edit a cube without pools: change the cube, the settings and the cap', { tag: ['@cu-i-unlocked'] }, async ({ openAs, seed, api }) => {
  const base = cubeTournamentBody()
  const { id } = await seed.tournament('alice', cubeTournamentBody({
    name: 'Pasted cube', bgaUrl: bga(123514),
    config: { ...base.config, source: { ...base.config.source, origin: 'paste', cubeId: null, name: 'Pasted cube' } },
  }))
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(sourceRadio(page, 'sourceCube')).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByTestId('cube-chosen')).toContainText(t('tournaments.cubeOriginPaste'))
  await expect(page.getByTestId('cube-name')).toHaveValue('Pasted cube')
  for (const f of FACTIONS) await expect(page.getByTestId(`cube-faction-${f}`), f).toHaveText('32', { timeout: 15_000 })
  await expect(page.getByTestId('cube-name')).toBeEnabled()

  await page.getByTestId('cube-change').click()
  await page.getByTestId('cube-community-all-commons').click()
  await expect(page.getByTestId('cube-chosen')).toContainText(t('tournaments.cubeOriginCommunity'), { timeout: 15_000 })
  await expect(heroCount(page)).toHaveText(tc('tournaments.heroPoolCount', 12))
  await stepTo(page, 'cube-boosters', 5)
  await stepTo(page, 'cube-cards-per-booster', 12)
  await page.getByTestId('cube-per-faction-2').click()
  await expect(page.getByTestId('max-players-capacity')).toHaveText(t('tournaments.cubeCapacityLine', { n: 3 }))
  await maxPlayers(page).fill('2')
  await expect(problems(page)).toHaveCount(0)
  await submit(page, 'submitSave').click()
  await page.waitForURL(new RegExp(`/tournament/t/${id}$`))

  const { body } = await api(null).get(`/api/tournaments/${id}`)
  expect(body.maxPlayers).toBe(2)
  expect(body.config.source).toMatchObject({ origin: 'community', cubeId: 'all-commons', name: CUBE.name, boosters: 5, cardsPerBooster: 12, perFaction: 2 })
  expect(body.config.source.heroPool).toEqual([...CUBE.heroes].sort())
  await expect(summary(page)).toHaveText(summaryText({ boosters: 5, cardsPerBooster: 12, name: CUBE.name }, 2))
  await players(page.locator('header'), 0, 2)
})

test('edit a cube with pools: everything locked but the name', { tag: ['@cu-i-locked'] }, async ({ openAs, seed, api }) => {
  const seeded = cubeTournamentBody()
  const { id } = await seed.tournament('alice', seeded)
  await seed.pool('bob', id)
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(page.getByText(t('tournaments.lockedNotice'))).toBeVisible()
  await expect(page.getByTestId('cube-chosen')).toBeVisible()
  await expect(page.getByTestId('cube-name')).toBeDisabled()
  await expect(page.getByTestId('cube-change')).toBeDisabled()
  await expect(page.getByTestId('cube-preview')).toBeEnabled()
  await page.getByTestId('cube-preview').click()
  await expect(page.getByRole('heading', { name: seeded.config.source.name })).toBeVisible()
  await page.getByRole('button', { name: '✕' }).click()
  for (const testId of ['cube-boosters', 'cube-cards-per-booster']) {
    for (const button of await page.getByTestId(testId).getByRole('button').all()) await expect(button, testId).toBeDisabled()
  }
  for (const testId of ['cube-per-faction-0', 'cube-per-faction-1', 'cube-per-faction-2', 'hero-mode-packs', 'hero-mode-free', 'hero-pool-open', 'max-players']) {
    await expect(page.getByTestId(testId), testId).toBeDisabled()
  }
  for (const key of ['sourceSets', 'sourceFactionMix', 'sourceCube']) await expect(sourceRadio(page, key)).toBeDisabled()
  await expect(field(page, 'nameLabel')).toBeEnabled()
  await field(page, 'nameLabel').fill('Commons cube ')
  await submit(page, 'submitSave').click()
  await page.waitForURL(new RegExp(`/tournament/t/${id}$`))
  const { body } = await api(null).get(`/api/tournaments/${id}`)
  expect(body.name.trim()).toBe('Commons cube')
  expect(body.maxPlayers).toBe(3)
})

test.fixme('edit a cube with pools: no "Change cube" on the read-only chosen cube', { tag: ['@cu-i-locked'] }, async ({ openAs, seed }) => {
  // The acceptance step: "the chosen cube is read-only (no name field to edit, no “Change cube”)".
  // The locked form shows the name field and the "Change cube" button, both disabled.
  const { id } = await seed.tournament('alice', cubeTournamentBody())
  await seed.pool('bob', id)
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(page.getByTestId('cube-chosen')).toBeVisible()
  await expect(page.getByTestId('cube-change')).toHaveCount(0)
})

test('French: the Cube tab, the cube settings, the tournament page and the cube page', { tag: ['@cu-k-fr'] }, async ({ openAs, seed }) => {
  const { id } = await seed.tournament('alice', cubeTournamentBody())
  const page = await openAs('alice')
  await openMenu(page)
  await page.getByRole('combobox', { name: t('lang.select') }).selectOption('fr')

  await page.goto('/tournament/new')
  await page.getByRole('radio', { name: tFr('tournaments.sourceCube') }).click()
  await expect(page.getByText(tFr('tournaments.cubeHint'))).toBeVisible()
  await expect(page.getByText(tFr('tournaments.cubeCommunityTitle'), { exact: true })).toBeVisible()
  await expect(page.getByText(tFr('tournaments.cubePasteTitle'), { exact: true })).toBeVisible()
  await page.getByTestId('cube-community-all-commons').click()
  await expect(page.getByTestId('cube-chosen')).toContainText(tFr('tournaments.cubeChosenTitle'), { timeout: 15_000 })
  await expect(page.getByText(tFr('tournaments.cubeBoostersTitle'), { exact: true })).toBeVisible()
  await expect(page.getByText(tFr('tournaments.maxPlayersLabel'), { exact: true })).toBeVisible()
  await page.getByTestId('hero-pool-open').click()
  await expect(page.getByTestId('hero-pool-search')).toHaveAttribute('placeholder', tFr('tournaments.heroPoolSearch'))
  await page.waitForLoadState('networkidle')
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY)

  await page.goto(`/tournament/t/${id}`)
  await expect(page.getByTestId('cube-link')).toHaveText(tFr('tournaments.cubeLink', { n: ALL_COMMONS.cards }))
  await expect(page.getByTestId('tournament-players')).toHaveText(tFr('tournaments.playersOf', { n: 0, max: 3 }))
  await page.waitForLoadState('networkidle')
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY)

  await page.goto(`/tournament/t/${id}/cube`)
  await expect(page.getByTestId('cube-page-heroes')).toContainText(tFr('tournaments.cubePageHeroesTitle', { n: 12 }))
  await expect(page.getByTestId('cube-page')).toContainText(tFr('tournaments.cubeOriginCommunity'))
  await page.waitForLoadState('networkidle')
  expect(await page.locator('body').innerText()).not.toMatch(RAW_KEY)
})

test('375 px: the Cube tab, the chosen cube, the hero picker, the tournament and cube pages', { tag: ['@cu-k-mobile', '@mobile'] }, async ({ openAs, seed }) => {
  const page = await openForm(openAs)
  await sourceRadio(page, 'sourceCube').click()
  await expect(page.getByText(t('tournaments.cubePasteTitle'), { exact: true })).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.getByTestId('cube-community-all-commons').click()
  await expect(page.getByTestId('cube-chosen')).toBeVisible({ timeout: 15_000 })
  await expectNoHorizontalScroll(page)
  await page.getByTestId('hero-pool-open').click()
  await expect(page.getByTestId(`hero-chip-${CUBE.heroes[0]}`)).toBeVisible({ timeout: 15_000 })
  await expectNoHorizontalScroll(page)
  await maxPlayers(page).scrollIntoViewIfNeeded()
  await expect(maxPlayers(page)).toBeVisible()
  await expectNoHorizontalScroll(page)

  const { id } = await seed.tournament('alice', cubeTournamentBody())
  await page.goto(`/tournament/t/${id}`)
  await expect(page.getByTestId('tournament-summary')).toBeVisible()
  await expectNoHorizontalScroll(page)
  await page.goto(`/tournament/t/${id}/cube`)
  await expect(page.getByTestId('cube-page-heroes').getByRole('listitem')).toHaveCount(12)
  await expectNoHorizontalScroll(page)
  await seed.pool('alice', id)
  await page.goto(`/tournament/t/${id}/pool`)
  await expect(page.getByRole('heading', { name: t('packReveal.openingYourPool') })).toBeVisible()
  await expectNoHorizontalScroll(page)
})
