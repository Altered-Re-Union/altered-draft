// Acceptance page "Multi-set sealed and random uniques — V3" (acceptance-multiset-sealed.html):
// the Sets tab (grid + "Mix several sets" steppers), its live issues, the stored config and its
// summary, the multi-set pool (set-pure boosters, a pack photo for the Roots of Corruption ones),
// exact and random uniques on the three sources, the API guards, the BGA path, the lock and the
// 375 px form. The fixtures hold CYCLONE / EOLE / FUGUE only; Neverending Journey (FUGUE) has
// no unique data.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '../support/fixtures.js'
import { factionTournamentBody, multisetTournamentBody, tournamentBody } from '../support/api.js'
import { FAKES_URL, ROOT_DIR } from '../support/env.js'
import { expectNoHorizontalScroll } from '../support/guards.js'
import { openPoolPage } from '../support/pages.js'
import { countBySet, setOf, storedPool } from '../support/pools.js'
import { PERSONAS } from '../support/personas.js'
import { t, tc } from '../support/i18n.js'

const FIXTURE_SETS = ['CYCLONE', 'EOLE', 'FUGUE']
const BY_REF = new Map(FIXTURE_SETS.flatMap(set =>
  JSON.parse(fs.readFileSync(path.join(ROOT_DIR, `tests/e2e/fixtures/cards/${set}/${set}_EN.json`), 'utf8')).map(c => [c.reference, c])))
const VISIBLE_SETS = ['CORE', 'ALIZE', 'BISE', 'CYCLONE', 'DUSTER', 'EOLE', 'FUGUE']
const SET_NAMES = {
  CORE: 'Beyond the Gates', ALIZE: 'Trial by Frost', BISE: 'Whisper from the Maze', CYCLONE: 'Skybound Odyssey',
  DUSTER: 'Seeds of Unity', EOLE: 'Roots of Corruption', FUGUE: 'Neverending Journey',
}
const MIX = { CYCLONE: 3, EOLE: 3, FUGUE: 1 }
const bga = id => `https://boardgamearena.com/tournament?id=${id}`

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const sourceRadio = (page, key) => page.getByRole('radiogroup', { name: t('tournaments.sourceLabel') }).getByRole('radio', { name: t(`tournaments.${key}`) })
const factionPills = page => page.getByRole('radiogroup', { name: t('tournaments.factionLabel'), exact: true })
const uniqueFactionPills = page => page.getByRole('radiogroup', { name: t('tournaments.uniquesFaction') })
const tile = (page, code) => page.getByRole('button', { name: SET_NAMES[code] })
const mixToggle = page => page.getByTestId('set-mix-toggle')
const count = (page, code) => page.getByTestId(`set-count-${code}`)
const countButton = (page, code, sign) => count(page, code).getByRole('button', { name: sign, exact: true })
const total = page => page.getByTestId('set-count-total')
const badge = (page, code) => page.getByTestId(`set-badge-${code}`)
const weight = (page, code) => page.getByTestId(`set-weight-${code}`)
const uniquesStepper = (page, which) => page.getByTestId(which === 'in' ? 'uniques-in-boosters' : 'uniques-guaranteed')
const submit = page => page.getByRole('button', { name: t('tournaments.submitCreate') })
const problems = page => page.getByTestId('form-problems')
// The slider runs left to right from "1 in 10" to "every booster": position = 11 - N.
const sliderPos = n => String(11 - n)
const isUnique = ref => ref.includes('_U_')

async function openForm(openAs) {
  const page = await openAs('alice')
  await page.goto('/tournament/new')
  await expect(page.getByRole('heading', { name: t('tournaments.createTitle') })).toBeVisible()
  return page
}

async function clickTimes(locator, times) {
  for (let i = 0; i < times; i++) await locator.click()
}

// Opens the disclosure and steps each set from 0 to its count (the split starts empty).
async function fillMix(page, counts) {
  if (await mixToggle(page).getAttribute('aria-expanded') !== 'true') await mixToggle(page).click()
  for (const [code, n] of Object.entries(counts)) await clickTimes(countButton(page, code, '+'), n)
  await expect(total(page)).toHaveText(t('tournaments.mixSetsCounter', { n: Object.values(counts).reduce((a, b) => a + b, 0) }))
}

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('form: the Sets tab grid, one click = the 7 boosters of a set', { tag: ['@ms-a-grid'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await expect(sourceRadio(page, 'sourceSets')).toHaveAttribute('aria-checked', 'true')
  await expect(sourceRadio(page, 'sourceSets')).toHaveText(t('tournaments.sourceSets'))
  await expect(mixToggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(total(page)).toHaveCount(0)

  await tile(page, 'CYCLONE').click()
  await expect(tile(page, 'CYCLONE')).toHaveAttribute('aria-pressed', 'true')
  await expect(badge(page, 'CYCLONE')).toHaveCount(0)
  await expect(total(page)).toHaveCount(0)

  await tile(page, 'CYCLONE').click()
  for (const code of VISIBLE_SETS) await expect(tile(page, code)).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId(/^set-badge-/)).toHaveCount(0)
  await expect(mixToggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId(/^set-count-/)).toHaveCount(0)
})

test('form: the "Mix several sets" steppers, counter and badges', { tag: ['@ms-a-mix'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await mixToggle(page).click()
  await expect(mixToggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText(t('tournaments.mixSetsHint'))).toBeVisible()
  for (const code of VISIBLE_SETS) await expect(count(page, code)).toContainText('0')
  await expect(count(page, 'COREKS')).toHaveCount(0)
  await expect(total(page)).toHaveText(t('tournaments.mixSetsCounter', { n: 0 }))

  await tile(page, 'CYCLONE').click()
  await expect(count(page, 'CYCLONE')).toContainText('7')
  await expect(total(page)).toHaveText(t('tournaments.mixSetsCounter', { n: 7 }))
  for (const code of VISIBLE_SETS) await expect(countButton(page, code, '+')).toBeDisabled()

  await clickTimes(countButton(page, 'CYCLONE', '−'), 3)
  await expect(total(page)).toHaveText(t('tournaments.mixSetsCounter', { n: 4 }))
  await expect(badge(page, 'CYCLONE')).toHaveText('×4')
  await expect(tile(page, 'CYCLONE')).toHaveAttribute('aria-pressed', 'false')
  for (const code of VISIBLE_SETS) await expect(countButton(page, code, '+')).toBeEnabled()

  await clickTimes(countButton(page, 'EOLE', '+'), 3)
  await expect(total(page)).toHaveText(t('tournaments.mixSetsCounter', { n: 7 }))
  await expect(badge(page, 'EOLE')).toHaveText('×3')
  for (const code of VISIBLE_SETS) await expect(countButton(page, code, '+')).toBeDisabled()

  await tile(page, 'FUGUE').click()
  await expect(count(page, 'FUGUE')).toContainText('7')
  await expect(count(page, 'CYCLONE')).toContainText('0')
  await expect(count(page, 'EOLE')).toContainText('0')
  await expect(page.getByTestId(/^set-badge-/)).toHaveCount(0)
  await expect(tile(page, 'FUGUE')).toHaveAttribute('aria-pressed', 'true')
})

test('form: live issues of the split', { tag: ['@ms-a-issues'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Issues multiset')
  await field(page, 'bgaUrlLabel').fill(bga(123497))
  await fillMix(page, { CYCLONE: 4 })
  await expect(problems(page)).toContainText(t('tournaments.errBoostersTotal', { n: 4 }))
  await expect(submit(page)).toBeDisabled()

  await problems(page).getByRole('button', { name: t('tournaments.errBoostersTotal', { n: 4 }) }).click()
  await expect(page.locator('#tn-cards')).toBeInViewport()

  await clickTimes(countButton(page, 'EOLE', '+'), 3)
  await expect(problems(page)).toHaveCount(0)
  await expect(submit(page)).toBeEnabled()

  await clickTimes(countButton(page, 'CYCLONE', '−'), 4)
  await clickTimes(countButton(page, 'EOLE', '−'), 3)
  await expect(problems(page)).toContainText(t('tournaments.errSelectSet'))
  await expect(submit(page)).toBeDisabled()
})

test('form: Sets ↔ Mono-faction mix keeps each tab’s values', { tag: ['@ms-a-switch'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await fillMix(page, { CYCLONE: 4, EOLE: 3 })

  await sourceRadio(page, 'sourceFactionMix').click()
  // The faction tab's own weights: every set at ×1, untouched by the split.
  for (const code of VISIBLE_SETS) await expect(weight(page, code)).toContainText('×1')
  await factionPills(page).getByRole('radio', { name: 'Axiom', exact: true }).click()
  await weight(page, 'BISE').getByRole('button', { name: '+', exact: true }).click()
  await expect(weight(page, 'BISE')).toContainText('×2')

  await sourceRadio(page, 'sourceSets').click()
  await expect(mixToggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(count(page, 'CYCLONE')).toContainText('4')
  await expect(count(page, 'EOLE')).toContainText('3')
  await expect(total(page)).toHaveText(t('tournaments.mixSetsCounter', { n: 7 }))
  await expect(badge(page, 'CYCLONE')).toHaveText('×4')
  await expect(badge(page, 'EOLE')).toHaveText('×3')

  await sourceRadio(page, 'sourceFactionMix').click()
  await expect(factionPills(page).getByRole('radio', { name: 'Axiom', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(weight(page, 'BISE')).toContainText('×2')
  for (const code of VISIBLE_SETS.filter(c => c !== 'BISE')) await expect(weight(page, code)).toContainText('×1')
})

test('create "SKY ROC NEJ mix": stored config and summary', { tag: ['@ms-b-create'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('SKY ROC NEJ mix')
  await field(page, 'bgaUrlLabel').fill(bga(123490))
  await fillMix(page, MIX)
  await expect(page.getByText(t('tournaments.uniquesPartialSupport'))).toBeVisible()
  await expect(page.getByRole('button', { name: new RegExp(`^${t('settingsFields.inPacks')}`) })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('uniques-mode-exact')).toHaveAttribute('aria-checked', 'true')
  await uniquesStepper(page, 'in').getByRole('button', { name: '+' }).click()
  await expect(uniquesStepper(page, 'in')).toContainText('2')
  await expect(uniquesStepper(page, 'out')).toContainText('1')
  await expect(page.locator('#even-factions')).toHaveCount(0)
  await expect(submit(page)).toBeEnabled()
  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)

  const id = page.url().split('/').pop()
  const { body } = await api(null).get(`/api/tournaments/${id}`)
  expect(body.config).toEqual({
    v: 1,
    format: 'sealed',
    source: { type: 'multiset', sets: MIX, boosters: 7 },
    heroes: 'packs',
    uniques: { inBoosters: 2, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: null },
    excludeBanlist: false,
  })
  await expect(page.getByTestId('tournament-summary')).toHaveText([
    t('tournaments.summaryBoostersCount', { n: 7 }),
    'SKY ×3, ROC ×3, NEJ',
    tc('tournaments.summaryUniquesIn', 2),
    tc('tournaments.summaryUniquesOut', 1),
  ].join(' · '))
})

test('the pool reveal: a pack photo for the Roots of Corruption boosters only', { tag: ['@ms-c-reveal'] }, async ({ openAs, seed, db }) => {
  const { id } = await seed.tournament('alice', multisetTournamentBody())
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}`)
  await page.getByRole('button', { name: t('tournaments.step2Button') }).click()
  await page.waitForURL(`**/tournament/t/${id}/pool`)
  await expect(page.getByRole('heading', { name: t('packReveal.openingYourPool') })).toBeVisible()
  const pool = await storedPool(db, id, 'alice')
  const cover = page.locator('img[src*="/boosters/"]')
  const openButton = page.getByRole('button', { name: t('cardZoom.openBooster') })
  for (let n = 1; n <= 7; n++) {
    if (n > 1) await page.getByRole('button', { name: t('packReveal.nextBooster') }).dispatchEvent('click')
    await expect(page.getByText(t('packReveal.boosterOf', { n, total: 8 })).first()).toBeVisible()
    const booster = pool.boosters[n - 1]
    // The zoom of THIS booster is open on its first card (under the cover, if any).
    await expect(page.getByRole('dialog').locator(`img[src*="${booster[0]}"]`)).toBeAttached()
    if (setOf(booster[0]) === 'EOLE') {
      await expect(page.locator('img[src*="/boosters/EOLE"]'), `booster ${n}`).toHaveCount(1)
      await expect(openButton, `booster ${n}`).toHaveCount(1)
    } else {
      await expect(cover, `booster ${n}`).toHaveCount(0)
      await expect(openButton, `booster ${n}`).toHaveCount(0)
    }
  }
  await page.getByRole('button', { name: t('packReveal.nextBooster') }).dispatchEvent('click')
  await expect(page.getByText(t('packReveal.boosterOf', { n: 8, total: 8 })).first()).toBeVisible()
  await expect(page.getByText(t('packReveal.guaranteedUnique')).first()).toBeVisible()
  await expect(cover).toHaveCount(0)
  await expect(openButton).toHaveCount(0)
})

test('stored pool: 7 set-pure boosters of 13, 3 / 3 / 1', { tag: ['@ms-c-boosters'] }, async ({ seed, db }) => {
  const { id } = await seed.tournament('alice', multisetTournamentBody())
  await seed.pool('alice', id)
  const pool = await storedPool(db, id, 'alice')
  expect(pool.set_code).toBeNull()
  expect(pool.boosters).toHaveLength(7)
  expect(countBySet(pool.boosters.map(b => b[0]))).toEqual(MIX)
  for (const booster of pool.boosters) {
    const set = setOf(booster[0])
    expect(booster, booster.join(' ')).toHaveLength(13)
    expect(new Set(booster.map(setOf)), booster.join(' ')).toEqual(new Set([set]))
    expect(new Set(booster).size, booster.join(' ')).toBe(13)
    expect(BY_REF.get(booster[0])?.cardType.reference, booster[0]).toBe('HERO')
    for (const ref of booster.slice(1, 10)) expect(BY_REF.get(ref)?.rarity.reference, ref).toBe('COMMON')
    for (const ref of booster.slice(10, 13)) expect(isUnique(ref) || (BY_REF.has(ref) && BY_REF.get(ref).rarity.reference !== 'COMMON'), ref).toBe(true)
  }
})

test('exact uniques: 2 inside SKY / ROC boosters of their set, 1 guaranteed outside', { tag: ['@ms-d-in-boosters', '@ms-d-guaranteed'] }, async ({ seed, db }) => {
  const { id } = await seed.tournament('alice', multisetTournamentBody())
  await seed.pool('alice', id)
  const pool = await storedPool(db, id, 'alice')
  const inBoosters = []
  for (const booster of pool.boosters) {
    booster.forEach((ref, pos) => { if (isUnique(ref)) inBoosters.push({ ref, pos, set: setOf(booster[0]) }) })
  }
  expect(inBoosters).toHaveLength(2)
  for (const { ref, pos, set } of inBoosters) {
    expect(pos, ref).toBeGreaterThanOrEqual(10)
    expect(['CYCLONE', 'EOLE'], ref).toContain(set)
    expect(setOf(ref), ref).toBe(set)
  }
  const inAnyBooster = new Set(pool.boosters.flat())
  const outside = Object.keys(pool.cards).filter(ref => !inAnyBooster.has(ref))
  expect(outside).toHaveLength(1)
  expect(outside[0]).toMatch(/^ALT_(CYCLONE|EOLE)_.*_U_\d+$/)
  expect(Object.keys(pool.cards).filter(isUnique)).toHaveLength(3)
})

test('form: in-booster uniques capped by the boosters with unique data', { tag: ['@ms-d-cap'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Cap mix')
  await field(page, 'bgaUrlLabel').fill(bga(123498))
  await tile(page, 'CYCLONE').click()
  await clickTimes(uniquesStepper(page, 'in').getByRole('button', { name: '+' }), 3)
  await expect(uniquesStepper(page, 'in')).toContainText('4')
  await mixToggle(page).click()
  await clickTimes(countButton(page, 'CYCLONE', '−'), 6)
  await clickTimes(countButton(page, 'FUGUE', '+'), 6)
  await expect(total(page)).toHaveText(t('tournaments.mixSetsCounter', { n: 7 }))
  await expect(page.getByText(t('tournaments.uniquesPartialSupport'))).toBeVisible()
  await expect(problems(page)).toContainText(t('tournaments.errUniquesTooMany', { n: 3 }))
  await expect(submit(page)).toBeDisabled()

  await uniquesStepper(page, 'in').getByRole('button', { name: '−' }).click()
  await expect(uniquesStepper(page, 'in')).toContainText('3')
  await expect(problems(page)).toHaveCount(0)
  await expect(uniquesStepper(page, 'in').getByRole('button', { name: '+' })).toBeDisabled()
})

test('form: the exact / random switch and the slider; a random tournament stored', { tag: ['@ms-e-form'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await tile(page, 'CYCLONE').click()
  const exact = page.getByTestId('uniques-mode-exact')
  const random = page.getByTestId('uniques-mode-random')
  const slider = page.getByTestId('random-one-in')
  const sliderText = page.getByTestId('random-one-in-text')
  await expect(exact).toHaveAttribute('aria-checked', 'true')

  // No unique at all in exact mode: the faction chips are off; random mode alone turns them on.
  const chips = uniqueFactionPills(page).getByRole('radio')
  expect(await chips.count()).toBeGreaterThan(0)
  await uniquesStepper(page, 'in').getByRole('button', { name: '−' }).click()
  await uniquesStepper(page, 'out').getByRole('button', { name: '−' }).click()
  await expect(uniquesStepper(page, 'in')).toContainText('0')
  await expect(uniquesStepper(page, 'out')).toContainText('0')
  for (const chip of await chips.all()) await expect(chip).toBeDisabled()
  await random.click()
  for (const chip of await chips.all()) await expect(chip).toBeEnabled()
  await exact.click()
  for (const chip of await chips.all()) await expect(chip).toBeDisabled()

  await clickTimes(uniquesStepper(page, 'in').getByRole('button', { name: '+' }), 2)
  await uniquesStepper(page, 'out').getByRole('button', { name: '+' }).click()
  await expect(uniquesStepper(page, 'in')).toContainText('2')
  await expect(uniquesStepper(page, 'out')).toContainText('1')

  await random.click()
  await expect(random).toHaveAttribute('aria-checked', 'true')
  await expect(uniquesStepper(page, 'in')).toHaveCount(0)
  await expect(slider).toHaveValue(sliderPos(8))
  await expect(sliderText).toHaveText(t('tournaments.randomOneInText', { n: 8, pct: 12.5 }))
  await expect(page.getByText(t('tournaments.randomOneInHint'))).toBeVisible()
  await expect(page.locator('#even-factions')).toHaveCount(0)
  await expect(uniquesStepper(page, 'out')).toBeVisible()
  for (const chip of await chips.all()) await expect(chip).toBeEnabled()

  await slider.fill(sliderPos(10))
  await expect(sliderText).toHaveText(t('tournaments.randomOneInText', { n: 10, pct: 10 }))
  await slider.fill(sliderPos(2))
  await expect(sliderText).toHaveText(t('tournaments.randomOneInText', { n: 2, pct: 50 }))
  await slider.fill(sliderPos(1))
  await expect(sliderText).toHaveText(t('tournaments.randomOneInEvery'))

  await exact.click()
  await expect(uniquesStepper(page, 'in')).toContainText('2')
  await expect(slider).toHaveCount(0)
  await expect(page.locator('#even-factions')).toHaveCount(1)
  await random.click()
  await expect(slider).toHaveValue(sliderPos(1))
  await exact.click()

  await field(page, 'nameLabel').fill('Random four')
  await field(page, 'bgaUrlLabel').fill(bga(123496))
  await random.click()
  await slider.fill(sliderPos(4))
  await expect(sliderText).toHaveText(t('tournaments.randomOneInText', { n: 4, pct: 25 }))
  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  const { body } = await api(null).get(`/api/tournaments/${page.url().split('/').pop()}`)
  expect(body.config.uniques).toEqual({ inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 4 })
  await expect(page.getByTestId('tournament-summary')).toContainText(t('tournaments.summaryUniquesRandom', { n: 4 }))
})

test('random on one set, every booster, 1 guaranteed: 8 uniques', { tag: ['@ms-e-set'] }, async ({ seed, db, api }) => {
  const { id } = await seed.tournament('alice', tournamentBody({
    name: 'Random SKY',
    bgaUrl: bga(123491),
    config: { source: { type: 'set', setCode: 'CYCLONE' }, heroes: 'packs', uniques: { inBoosters: 0, guaranteed: 1, randomOneIn: 1 } },
  }))
  const { body } = await api(null).get(`/api/tournaments/${id}`)
  expect(body.config.source).toEqual({ type: 'set', setCode: 'CYCLONE', boosters: 7 })
  expect(body.config.uniques).toEqual({ inBoosters: 0, guaranteed: 1, evenFactions: false, faction: null, randomOneIn: 1 })
  await seed.pool('alice', id)
  const pool = await storedPool(db, id, 'alice')
  expect(pool.boosters).toHaveLength(7)
  for (const booster of pool.boosters) expect(booster[12], booster.join(' ')).toMatch(/^ALT_CYCLONE_.*_U_\d+$/)
  expect(new Set(Object.keys(pool.cards).filter(isUnique)).size).toBe(8)
})

test('random on the mix: 6 uniques, none in the Neverending Journey booster', { tag: ['@ms-e-mix'] }, async ({ seed, db, api }) => {
  const { id } = await seed.tournament('alice', multisetTournamentBody({
    name: 'Random SKY ROC NEJ mix',
    bgaUrl: bga(123492),
    // Random mode forces inBoosters to 0 and evenFactions to false, without an error.
    config: { ...multisetTournamentBody().config, uniques: { randomOneIn: 1, inBoosters: 5, evenFactions: true, guaranteed: 0 } },
  }))
  const { body } = await api(null).get(`/api/tournaments/${id}`)
  expect(body.config.source).toEqual({ type: 'multiset', sets: MIX, boosters: 7 })
  expect(body.config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: 1 })
  await seed.pool('alice', id)
  const pool = await storedPool(db, id, 'alice')
  for (const booster of pool.boosters) {
    const set = setOf(booster[0])
    if (set === 'FUGUE') expect(isUnique(booster[12]), booster[12]).toBe(false)
    else {
      expect(isUnique(booster[12]), booster[12]).toBe(true)
      expect(setOf(booster[12]), booster[12]).toBe(set)
    }
  }
  expect(Object.keys(pool.cards).filter(isUnique)).toHaveLength(6)
})

test('random on an Axiom mono-faction mix: Axiom uniques, none from NEJ', { tag: ['@ms-e-faction'] }, async ({ seed, db, request }) => {
  const { id } = await seed.tournament('alice', factionTournamentBody({
    bgaUrl: bga(123493),
    config: { ...factionTournamentBody().config, uniques: { inBoosters: 0, guaranteed: 1, randomOneIn: 1 } },
  }))
  await seed.pool('alice', id)
  const pool = await storedPool(db, id, 'alice')
  expect(pool.boosters).toHaveLength(7)
  for (const booster of pool.boosters) expect(isUnique(booster[12]), booster.join(' ')).toBe(true)
  const uniques = Object.keys(pool.cards).filter(isUnique)
  expect(new Set(uniques).size).toBe(8)
  for (const ref of uniques) expect(ref).toMatch(/^ALT_(CYCLONE|EOLE)_B_/)
  const { member } = await (await request.get(`${FAKES_URL}/cards/api/cards?reference=${uniques[0]}`)).json()
  expect(member[0]?.faction.code, uniques[0]).toBe('AX')
})

test('API: invalid splits and random values refused; a one-set multiset stored as a set', { tag: ['@ms-f-api', '@ms-f-normalize'] }, async ({ api, seed, db }) => {
  const none = { inBoosters: 0, guaranteed: 0 }
  const body = (sets, uniques = none) => ({
    name: 'Guard multiset', bgaUrl: bga(123494), startsAt: tournamentBody().startsAt,
    config: { source: { type: 'multiset', sets }, heroes: 'packs', uniques },
  })
  const cases = [
    ['sum 6', body({ CYCLONE: 3, EOLE: 3 }), 'source.sets'],
    ['8 in one set', body({ CYCLONE: 8 }), 'source.sets'],
    ['COREKS', body({ COREKS: 4, CYCLONE: 3 }), 'source.sets'],
    ['randomOneIn 0', body(MIX, { randomOneIn: 0, guaranteed: 0 }), 'uniques.randomOneIn'],
    ['randomOneIn 11', body(MIX, { randomOneIn: 11, guaranteed: 0 }), 'uniques.randomOneIn'],
    ['NEJ alone, random', body({ FUGUE: 7 }, { randomOneIn: 8, guaranteed: 0 }), 'uniques.unsupportedSet'],
    ['cap: SKY 1, NEJ 6, 4 in', body({ CYCLONE: 1, FUGUE: 6 }, { inBoosters: 4, guaranteed: 0 }), 'uniques.inBoosters'],
  ]
  for (const [label, b, code] of cases) {
    const res = await api('alice').post('/api/tournaments', b)
    expect(res.status, label).toBe(400)
    expect(res.body.config, label).toEqual([code])
  }
  expect((await api(null).get('/api/tournaments')).body.tournaments.map(tn => tn.name)).not.toContain('Guard multiset')

  // A set at 0 is dropped, then the one set left makes a `set` source, with a set-code pool.
  const res = await api('alice').post('/api/tournaments', {
    ...body({ CYCLONE: 7, EOLE: 0 }, { inBoosters: 1, guaranteed: 0 }), name: 'Normalized SKY', bgaUrl: bga(123495),
  })
  expect(res.status).toBe(201)
  expect(res.body.config.source).toEqual({ type: 'set', setCode: 'CYCLONE', boosters: 7 })
  expect(res.body.config.uniques).toEqual({ inBoosters: 1, guaranteed: 0, evenFactions: false, faction: null, randomOneIn: null })
  await seed.pool('alice', res.body.id)
  const pool = await storedPool(db, res.body.id, 'alice')
  expect(pool.set_code).toBe('CYCLONE')
  expect(pool.boosters).toHaveLength(7)
})

test('BGA: the first call creates a multi-set pool and a deck taken from it', { tag: ['@ms-g-bga'] }, async ({ seed, api, db, fakes }) => {
  const { id } = await seed.tournament('alice', multisetTournamentBody())
  await seed.pool('alice', id)
  const decklist = await seed.bgaDecklist('carol', { tournamentId: '123490', tournamentName: 'BGA name', gameId: 'g-123490' })
  const [member] = decklist['hydra:member']
  expect(member).toMatchObject({ name: 'Random SKY ROC NEJ mix' })

  const deck = (await fakes.decks('carol')).find(d => d.id === member.id)
  expect(deck).toBeTruthy()
  const counts = await api('carol').get('/api/tournament-pool-counts?tournamentId=123490')
  expect(counts.status).toBe(200)
  for (const { cardReference, quantity } of deck.deckCards) {
    expect(counts.body.cards[cardReference.toUpperCase()] ?? 0, cardReference).toBeGreaterThanOrEqual(quantity)
  }
  expect(deck.deckCards.reduce((n, c) => n + c.quantity, 0)).toBeGreaterThanOrEqual(30)

  const { rows } = await db.query("SELECT sub, created_by, set_code IS NULL AS no_set_code, jsonb_array_length(boosters) AS boosters, tournament_name FROM sealed_pools WHERE tournament_id = '123490' ORDER BY created_by")
  expect(rows).toEqual([
    { sub: PERSONAS.carol.sub, created_by: 'bga', no_set_code: true, boosters: 7, tournament_name: 'SKY ROC NEJ mix' },
    { sub: PERSONAS.alice.sub, created_by: 'page', no_set_code: true, boosters: 7, tournament_name: 'SKY ROC NEJ mix' },
  ])
  const carolPool = await storedPool(db, id, 'carol')
  for (const { cardReference } of deck.deckCards) expect(Object.keys(carolPool.cards)).toContain(cardReference.toUpperCase())
})

test('edit: the split and the uniques mode are locked once a pool exists', { tag: ['@ms-h-locked'] }, async ({ openAs, seed }) => {
  const { id } = await seed.tournament('alice', multisetTournamentBody())
  await seed.pool('bob', id)
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(page.getByText(t('tournaments.lockedNotice'))).toBeVisible()
  await expect(sourceRadio(page, 'sourceSets')).toHaveAttribute('aria-checked', 'true')
  for (const key of ['sourceSets', 'sourceFactionMix']) await expect(sourceRadio(page, key)).toBeDisabled()
  await expect(mixToggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(mixToggle(page)).toBeDisabled()
  await expect(total(page)).toHaveText(t('tournaments.mixSetsCounter', { n: 7 }))
  for (const code of VISIBLE_SETS) {
    await expect(count(page, code)).toContainText(String(MIX[code] ?? 0))
    for (const button of await count(page, code).getByRole('button').all()) await expect(button).toBeDisabled()
    await expect(tile(page, code)).toBeDisabled()
  }
  await expect(badge(page, 'CYCLONE')).toHaveText('×3')
  await expect(badge(page, 'EOLE')).toHaveText('×3')
  await expect(badge(page, 'FUGUE')).toHaveText('×1')
  for (const mode of ['uniques-mode-exact', 'uniques-mode-random']) await expect(page.getByTestId(mode)).toBeDisabled()
  for (const key of ['nameLabel', 'descriptionLabel', 'startsAtLabel', 'endsAtLabel']) await expect(field(page, key), key).toBeEnabled()
})

test('375 px: the disclosure, the random slider and the pool page', { tag: ['@ms-i-mobile', '@mobile'] }, async ({ openAs, seed }) => {
  const page = await openForm(openAs)
  await fillMix(page, MIX)
  await expectNoHorizontalScroll(page)
  // The disclosure line: the toggle and the counter side by side.
  const toggleBox = await mixToggle(page).boundingBox()
  const totalBox = await total(page).boundingBox()
  expect(Math.abs((toggleBox.y + toggleBox.height / 2) - (totalBox.y + totalBox.height / 2))).toBeLessThan(4)
  expect(totalBox.x).toBeGreaterThanOrEqual(toggleBox.x + toggleBox.width)
  // Each row on one line: the set name and its stepper side by side.
  for (const code of VISIBLE_SETS) {
    const row = page.getByRole('listitem').filter({ has: count(page, code) })
    const name = await row.locator(':scope > span').first().boundingBox()
    const stepper = await count(page, code).boundingBox()
    expect(Math.abs((stepper.y + stepper.height / 2) - (name.y + name.height / 2)), code).toBeLessThan(4)
    expect(stepper.x, code).toBeGreaterThanOrEqual(name.x + name.width)
  }

  await page.getByTestId('uniques-mode-random').click()
  await page.getByTestId('random-one-in').scrollIntoViewIfNeeded()
  await expect(page.getByTestId('random-one-in')).toBeVisible()
  await expect(page.getByText(t('tournaments.randomOneInMin'))).toBeVisible()
  await expect(page.getByText(t('tournaments.randomOneInMax'), { exact: true })).toBeVisible()
  await expectNoHorizontalScroll(page)

  const { id } = await seed.tournament('alice', multisetTournamentBody())
  await page.goto(`/tournament/t/${id}`)
  await expect(page.getByTestId('tournament-summary')).toBeVisible()
  await expectNoHorizontalScroll(page)
  const pool = await openPoolPage({ openAs, seed }, 'alice', id, 'SKY ROC NEJ mix')
  await expectNoHorizontalScroll(pool)
})
