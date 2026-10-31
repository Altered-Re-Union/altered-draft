// Acceptance page "Mono-faction sealed — V2" (acceptance-mono-faction-sealed.html): the Cards
// switch and the weight steppers, the live issues, the stored config and its summary, the
// faction pool (exact per-set quotas on the e2e card fixtures), the uniques of a mix with
// Neverending Journey, the API guards, the BGA path, the lock, and the 375 px form.
// The fixtures hold CYCLONE / EOLE / FUGUE only: every tournament here leaves the other sets
// at ×0, with the weights SKY ×1 / ROC ×2 / NEJ ×1 (Σ 4) unless a test says otherwise.
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '../support/fixtures.js'
import { factionTournamentBody, tournamentBody } from '../support/api.js'
import { FAKES_URL, ROOT_DIR } from '../support/env.js'
import { expectNoHorizontalScroll } from '../support/guards.js'
import { openPoolPage } from '../support/pages.js'
import { PERSONAS } from '../support/personas.js'
import { t, tc } from '../support/i18n.js'

const FIXTURE_SETS = ['CYCLONE', 'EOLE', 'FUGUE']
const BY_REF = new Map(FIXTURE_SETS.flatMap(set =>
  JSON.parse(fs.readFileSync(path.join(ROOT_DIR, `tests/e2e/fixtures/cards/${set}/${set}_EN.json`), 'utf8')).map(c => [c.reference, c])))
const VISIBLE_SETS = ['CORE', 'ALIZE', 'BISE', 'CYCLONE', 'DUSTER', 'EOLE', 'FUGUE']
const FACTIONS = ['Axiom', 'Bravos', 'Lyra', 'Muna', 'Ordis', 'Yzmir']
const MIX_WEIGHTS = { CORE: 0, ALIZE: 0, BISE: 0, CYCLONE: 1, DUSTER: 0, EOLE: 2, FUGUE: 1 }
const bga = id => `https://boardgamearena.com/tournament?id=${id}`

const field = (page, key) => page.getByLabel(t(`tournaments.${key}`), { exact: true })
const sourceRadio = (page, key) => page.getByRole('radiogroup', { name: t('tournaments.sourceLabel') }).getByRole('radio', { name: t(`tournaments.${key}`) })
// exact: "Faction" alone, never "Faction of the uniques".
const factionPills = page => page.getByRole('radiogroup', { name: t('tournaments.factionLabel'), exact: true })
const weight = (page, code) => page.getByTestId(`set-weight-${code}`)
const weightRow = (page, code) => page.getByRole('listitem').filter({ has: weight(page, code) })
const weightButton = (page, code, sign) => weight(page, code).getByRole('button', { name: sign, exact: true })
const uniquesStepper = (page, which) => page.getByTestId(which === 'in' ? 'uniques-in-boosters' : 'uniques-guaranteed')
const submit = page => page.getByRole('button', { name: t('tournaments.submitCreate') })
const problems = page => page.getByTestId('form-problems')
const isUnique = ref => ref.includes('_U_')

async function openForm(openAs) {
  const page = await openAs('alice')
  await page.goto('/tournament/new')
  await expect(page.getByRole('heading', { name: t('tournaments.createTitle') })).toBeVisible()
  return page
}

// Every weight starts at ×1: step each one to its target.
async function setWeights(page, targets) {
  for (const code of VISIBLE_SETS) {
    const target = targets[code] ?? 0
    for (let w = 1; w < target; w++) await weightButton(page, code, '+').click()
    for (let w = 1; w > target; w--) await weightButton(page, code, '−').click()
    await expect(weight(page, code)).toContainText(`×${target}`)
  }
}

// The faction pool of `who` on `tournamentId`, as stored.
async function storedPool(db, tournamentId, who) {
  const { rows } = await db.query('SELECT set_code, created_by, boosters, cards FROM sealed_pools WHERE tournament_ref = $1 AND sub = $2', [tournamentId, PERSONAS[who].sub])
  expect(rows).toHaveLength(1)
  return rows[0]
}

const setOf = ref => ref.split('_')[1]
function countBySet(refs) {
  const counts = {}
  for (const ref of refs) counts[setOf(ref)] = (counts[setOf(ref)] ?? 0) + 1
  return counts
}

test.beforeEach(async ({ db, fakes }) => {
  await db.resetDb()
  await fakes.reset()
})

test('form: the source switch, the faction pills and the weight steppers', { tag: ['@mf-a-switch'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await expect(sourceRadio(page, 'sourceOneSet')).toHaveAttribute('aria-checked', 'true')
  await expect(sourceRadio(page, 'sourceFactionMix')).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'Skybound Odyssey' }).click()
  await expect(page.getByRole('button', { name: 'Skybound Odyssey' })).toHaveAttribute('aria-pressed', 'true')

  await sourceRadio(page, 'sourceFactionMix').click()
  await expect(sourceRadio(page, 'sourceFactionMix')).toHaveAttribute('aria-checked', 'true')
  const pills = factionPills(page).getByRole('radio')
  await expect(pills).toHaveCount(6)
  for (const [i, name] of FACTIONS.entries()) {
    await expect(pills.nth(i)).toHaveText(name)
    await expect(pills.nth(i).locator('img')).toHaveCount(1)
    await expect(pills.nth(i)).toHaveAttribute('aria-checked', 'false')
  }
  await expect(page.getByText(t('tournaments.setsWeightsLabel'))).toBeVisible()
  await expect(page.getByTestId(/^set-weight-/)).toHaveCount(7)
  await expect(page.getByTestId('set-weight-COREKS')).toHaveCount(0)
  for (const code of VISIBLE_SETS) {
    await expect(weight(page, code)).toContainText('×1')
    await expect(weightRow(page, code)).toContainText('14 %')
  }

  await weightButton(page, 'ALIZE', '−').click()
  await expect(weight(page, 'ALIZE')).toContainText('×0')
  await expect(weightRow(page, 'ALIZE')).toContainText(t('tournaments.weightExcluded'))
  await expect(weightButton(page, 'ALIZE', '−')).toBeDisabled()
  for (const code of VISIBLE_SETS.filter(c => c !== 'ALIZE')) await expect(weightRow(page, code)).toContainText('17 %')

  await weightButton(page, 'CYCLONE', '+').click()
  await weightButton(page, 'CYCLONE', '+').click()
  await expect(weight(page, 'CYCLONE')).toContainText('×3')
  await expect(weightButton(page, 'CYCLONE', '+')).toBeDisabled()

  await sourceRadio(page, 'sourceOneSet').click()
  await expect(page.getByTestId(/^set-weight-/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Skybound Odyssey' })).toHaveAttribute('aria-pressed', 'true')
  await sourceRadio(page, 'sourceFactionMix').click()
  await expect(weight(page, 'ALIZE')).toContainText('×0')
  await expect(weight(page, 'CYCLONE')).toContainText('×3')
})

test('form: live issues for the faction and the sets', { tag: ['@mf-a-issues'] }, async ({ openAs }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Issues mix')
  await field(page, 'bgaUrlLabel').fill(bga(123489))
  await sourceRadio(page, 'sourceFactionMix').click()
  await expect(problems(page)).toContainText(t('tournaments.errSelectFaction'))
  await expect(submit(page)).toBeDisabled()

  await factionPills(page).getByRole('radio', { name: 'Axiom', exact: true }).click()
  // The faction was the only problem left: the list goes away.
  await expect(problems(page)).toHaveCount(0)
  await setWeights(page, {})
  await expect(problems(page)).toContainText(t('tournaments.errSelectSets'))
  await expect(submit(page)).toBeDisabled()

  await problems(page).getByRole('button', { name: t('tournaments.errSelectSets') }).click()
  await expect(page.locator('#tn-cards')).toBeFocused()
  await expect(page.locator('#tn-cards')).toBeInViewport()

  await weightButton(page, 'CYCLONE', '+').click()
  await expect(problems(page)).toHaveCount(0)
  await expect(submit(page)).toBeEnabled()
})

test('create "Axiom mix": stored config and summary', { tag: ['@mf-b-create'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('Axiom mix')
  await field(page, 'bgaUrlLabel').fill(bga(123480))
  await sourceRadio(page, 'sourceFactionMix').click()
  await factionPills(page).getByRole('radio', { name: 'Axiom', exact: true }).click()
  await setWeights(page, MIX_WEIGHTS)
  await expect(page.getByRole('button', { name: new RegExp(`^${t('settingsFields.inPacks')}`) })).toHaveAttribute('aria-pressed', 'true')
  await uniquesStepper(page, 'in').getByRole('button', { name: '−' }).click()
  await expect(uniquesStepper(page, 'in')).toContainText('0')
  await expect(uniquesStepper(page, 'out')).toContainText('1')
  await expect(submit(page)).toBeEnabled()
  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)

  const id = page.url().split('/').pop()
  const { body } = await api(null).get(`/api/tournaments/${id}`)
  expect(body.config).toEqual({
    v: 1,
    format: 'sealed',
    source: { type: 'faction', faction: 'AX', sets: { CYCLONE: 1, EOLE: 2, FUGUE: 1 }, boosters: 7 },
    heroes: 'packs',
    uniques: { inBoosters: 0, guaranteed: 1, evenFactions: false, faction: 'AX' },
    excludeBanlist: false,
  })
  const summary = page.getByTestId('tournament-summary')
  await expect(summary).toHaveText([
    t('tournaments.summaryBoostersCount', { n: 7 }),
    t('tournaments.summaryFactionMix', { faction: 'Axiom' }),
    'SKY, ROC ×2, NEJ',
    tc('tournaments.summaryUniquesOut', 1),
  ].join(' · '))
  await expect(summary.locator('img')).toHaveCount(1)
})

test('the pool: reveal without a booster cover, exact per-set quotas, Axiom only', { tag: ['@mf-c-pool'] }, async ({ openAs, seed, db, request }) => {
  const { id } = await seed.tournament('alice', factionTournamentBody())
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}`)
  await page.getByRole('button', { name: t('tournaments.step2Button') }).click()
  await page.waitForURL(`**/tournament/t/${id}/pool`)
  await expect(page.getByRole('heading', { name: t('packReveal.openingYourPool') })).toBeVisible()
  for (let n = 1; n <= 8; n++) {
    if (n > 1) await page.getByRole('button', { name: t('packReveal.nextBooster') }).dispatchEvent('click')
    await expect(page.getByText(t('packReveal.boosterOf', { n, total: 8 })).first()).toBeVisible()
    // The boosters mix sets: never a pack photo (EOLE has one), straight to the cards.
    await expect(page.locator('img[src*="/boosters/"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: t('cardZoom.openBooster') })).toHaveCount(0)
  }
  await expect(page.getByText(t('packReveal.guaranteedUnique')).first()).toBeVisible()
  await page.getByRole('button', { name: t('packReveal.seeFullPool') }).last().dispatchEvent('click')
  await expect(page.getByRole('heading', { name: 'Axiom mix', exact: true })).toBeVisible()

  const pool = await storedPool(db, id, 'alice')
  expect(pool.set_code).toBeNull()
  expect(pool.boosters).toHaveLength(7)
  for (const booster of pool.boosters) expect(booster).toHaveLength(13)
  // Slot 0 = hero, 1..9 = commons, 10..12 = rares (uniques 0 / 1: none in the boosters).
  // Quotas over Σ weights 4 with the largest remainder: commons 63 → 16 / 31 / 16,
  // rares 21 → 5 / 11 / 5.
  const slots = (from, to) => pool.boosters.flatMap(b => b.slice(from, to))
  expect(countBySet(slots(1, 10))).toEqual({ CYCLONE: 16, EOLE: 31, FUGUE: 16 })
  expect(countBySet(slots(10, 13))).toEqual({ CYCLONE: 5, EOLE: 11, FUGUE: 5 })
  for (const ref of slots(1, 10)) expect(BY_REF.get(ref)?.rarity.reference, ref).toBe('COMMON')
  for (const ref of slots(10, 13)) expect(BY_REF.get(ref)?.rarity.reference, ref).not.toBe('COMMON')
  // The fixtures hold one Axiom hero per set: the 7 hero slots deal all 3, then repeat.
  const heroes = slots(0, 1)
  for (const ref of heroes) expect(BY_REF.get(ref)?.cardType.reference, ref).toBe('HERO')
  expect([...new Set(heroes)].sort()).toEqual(['ALT_CYCLONE_B_AX_65_C', 'ALT_EOLE_B_AX_65_C', 'ALT_FUGUE_B_AX_130_C'])
  for (const booster of pool.boosters) expect(new Set(booster).size, booster.join(' ')).toBe(13)

  const refs = Object.keys(pool.cards)
  for (const ref of refs.filter(r => !isUnique(r))) expect(BY_REF.get(ref)?.mainFaction.reference, ref).toBe('AX')
  expect(refs.some(r => r.endsWith('_R2'))).toBe(true)
  const uniques = refs.filter(isUnique)
  expect(uniques).toHaveLength(1)
  expect(uniques[0]).toMatch(/^ALT_(CYCLONE|EOLE)_B_/)
  const { member } = await (await request.get(`${FAKES_URL}/cards/api/cards?reference=${uniques[0]}`)).json()
  expect(member[0]?.faction.code, uniques[0]).toBe('AX')
})

test('SKY ×1 + NEJ ×1, uniques 2 / 1: every unique from Skybound Odyssey', { tag: ['@mf-d-nej'] }, async ({ seed, db }) => {
  const { id } = await seed.tournament('alice', factionTournamentBody({
    name: 'NEJ and SKY mix',
    bgaUrl: bga(123481),
    config: { source: { type: 'faction', faction: 'AX', sets: { CYCLONE: 1, FUGUE: 1 } }, heroes: 'packs', uniques: { inBoosters: 2, guaranteed: 1 } },
  }))
  await seed.pool('alice', id)
  const pool = await storedPool(db, id, 'alice')
  const uniques = Object.keys(pool.cards).filter(isUnique)
  expect(uniques).toHaveLength(3)
  for (const ref of uniques) expect(ref).toMatch(/^ALT_CYCLONE_B_/)
  const rareSlots = pool.boosters.flatMap(b => b.slice(10, 13))
  expect(rareSlots.filter(isUnique)).toHaveLength(2)
  expect(rareSlots.filter(r => !isUnique(r))).toHaveLength(19)
  expect(pool.boosters.flatMap(b => b.slice(0, 10)).filter(isUnique)).toHaveLength(0)
})

test('Neverending Journey alone: uniques disabled, stored with none', { tag: ['@mf-d-nej-alone'] }, async ({ openAs, api }) => {
  const page = await openForm(openAs)
  await field(page, 'nameLabel').fill('NEJ only mix')
  await field(page, 'bgaUrlLabel').fill(bga(123483))
  await sourceRadio(page, 'sourceFactionMix').click()
  await factionPills(page).getByRole('radio', { name: 'Axiom', exact: true }).click()
  await setWeights(page, { FUGUE: 1 })
  const unsupported = page.getByText(t('tournaments.uniquesUnsupportedSets'))
  const expectUniquesOff = async () => {
    await expect(unsupported).toBeVisible()
    for (const which of ['in', 'out']) {
      await expect(uniquesStepper(page, which)).toContainText('0')
      for (const button of await uniquesStepper(page, which).getByRole('button').all()) await expect(button).toBeDisabled()
    }
  }
  await expectUniquesOff()
  await weightButton(page, 'CYCLONE', '+').click()
  await expect(unsupported).toHaveCount(0)
  await expect(uniquesStepper(page, 'in').getByRole('button', { name: '+' })).toBeEnabled()
  await expect(uniquesStepper(page, 'out').getByRole('button', { name: '+' })).toBeEnabled()
  await weightButton(page, 'CYCLONE', '−').click()
  await expectUniquesOff()

  await submit(page).click()
  await page.waitForURL(/\/tournament\/t\/[0-9a-f-]{36}$/)
  const { body } = await api(null).get(`/api/tournaments/${page.url().split('/').pop()}`)
  expect(body.config.source.sets).toEqual({ FUGUE: 1 })
  expect(body.config.uniques).toEqual({ inBoosters: 0, guaranteed: 0, evenFactions: false, faction: null })
})

test('API: invalid sources are refused with their error code', { tag: ['@mf-e-api'] }, async ({ api }) => {
  const none = { inBoosters: 0, guaranteed: 0 }
  const body = (source, uniques = none) => ({
    name: 'Guard mix', bgaUrl: bga(123485), startsAt: tournamentBody().startsAt,
    config: { source: { type: 'faction', ...source }, heroes: 'packs', uniques },
  })
  const cases = [
    ['unknown faction', body({ faction: 'XX', sets: { CYCLONE: 1 } }), 'source.faction'],
    ['weight 4', body({ faction: 'AX', sets: { CYCLONE: 4 } }), 'source.sets'],
    ['weight -1', body({ faction: 'AX', sets: { CYCLONE: -1, EOLE: 1 } }), 'source.sets'],
    ['all zero', body({ faction: 'AX', sets: { CYCLONE: 0, EOLE: 0 } }), 'source.sets'],
    ['COREKS', body({ faction: 'AX', sets: { COREKS: 1 } }), 'source.sets'],
    ['unknown set', body({ faction: 'AX', sets: { NOPE: 1 } }), 'source.sets'],
    ['NEJ alone with uniques', body({ faction: 'AX', sets: { FUGUE: 1 } }, { inBoosters: 1, guaranteed: 0 }), 'uniques.unsupportedSet'],
  ]
  for (const [label, b, code] of cases) {
    const res = await api('alice').post('/api/tournaments', b)
    expect(res.status, label).toBe(400)
    expect(res.body.config, label).toEqual([code])
  }
  expect((await api(null).get('/api/tournaments')).body.tournaments.map(tn => tn.name)).not.toContain('Guard mix')
})

test('API: the faction and even factions of the uniques are forced', { tag: ['@mf-e-forced'] }, async ({ api }) => {
  const res = await api('alice').post('/api/tournaments', {
    name: 'Forced faction mix', bgaUrl: bga(123485), startsAt: tournamentBody().startsAt,
    config: {
      source: { type: 'faction', faction: 'AX', sets: { CYCLONE: 1, EOLE: 2, FUGUE: 0 } },
      heroes: 'packs',
      uniques: { inBoosters: 1, guaranteed: 1, evenFactions: true, faction: 'BR' },
    },
  })
  expect(res.status).toBe(201)
  expect(res.body.config.source.sets).toEqual({ CYCLONE: 1, EOLE: 2 })
  expect(res.body.config.uniques).toEqual({ inBoosters: 1, guaranteed: 1, evenFactions: false, faction: 'AX' })
  expect([200, 204]).toContain((await api('alice').delete(`/api/tournaments/${res.body.id}`)).status)
})

test('BGA: the first call creates a faction pool and a deck taken from it', { tag: ['@mf-f-bga'] }, async ({ seed, api, db, fakes }) => {
  const { id } = await seed.tournament('alice', factionTournamentBody())
  await seed.pool('alice', id)
  const decklist = await seed.bgaDecklist('carol', { tournamentId: '123480', tournamentName: 'BGA name', gameId: 'g-123480' })
  const [member] = decklist['hydra:member']
  expect(member).toMatchObject({ name: 'Random Axiom mix', faction: { reference: 'AX' } })

  const deck = (await fakes.decks('carol')).find(d => d.id === member.id)
  expect(deck).toBeTruthy()
  const counts = await api('carol').get('/api/tournament-pool-counts?tournamentId=123480')
  expect(counts.status).toBe(200)
  for (const { cardReference, quantity } of deck.deckCards) {
    expect(counts.body.cards[cardReference.toUpperCase()] ?? 0, cardReference).toBeGreaterThanOrEqual(quantity)
  }
  expect(deck.deckCards.reduce((n, c) => n + c.quantity, 0)).toBeGreaterThanOrEqual(30)

  const { rows } = await db.query("SELECT sub, created_by, set_code IS NULL AS no_set_code, tournament_name FROM sealed_pools WHERE tournament_id = '123480' ORDER BY created_by")
  expect(rows).toEqual([
    { sub: PERSONAS.carol.sub, created_by: 'bga', no_set_code: true, tournament_name: 'Axiom mix' },
    { sub: PERSONAS.alice.sub, created_by: 'page', no_set_code: true, tournament_name: 'Axiom mix' },
  ])
  const carolPool = await storedPool(db, id, 'carol')
  for (const { cardReference } of deck.deckCards) expect(Object.keys(carolPool.cards)).toContain(cardReference.toUpperCase())
})

test('edit: the source, the faction and the weights are locked once a pool exists', { tag: ['@mf-g-locked'] }, async ({ openAs, seed }) => {
  const { id } = await seed.tournament('alice', factionTournamentBody())
  await seed.pool('bob', id)
  const page = await openAs('alice')
  await page.goto(`/tournament/t/${id}/edit`)
  await expect(page.getByText(t('tournaments.lockedNotice'))).toBeVisible()
  await expect(sourceRadio(page, 'sourceFactionMix')).toHaveAttribute('aria-checked', 'true')
  for (const key of ['sourceOneSet', 'sourceFactionMix']) await expect(sourceRadio(page, key)).toBeDisabled()
  await expect(factionPills(page).getByRole('radio', { name: 'Axiom', exact: true })).toHaveAttribute('aria-checked', 'true')
  for (const pill of await factionPills(page).getByRole('radio').all()) await expect(pill).toBeDisabled()
  for (const code of VISIBLE_SETS) {
    await expect(weight(page, code)).toContainText(`×${MIX_WEIGHTS[code]}`)
    for (const button of await weight(page, code).getByRole('button').all()) await expect(button).toBeDisabled()
  }
  for (const key of ['nameLabel', 'descriptionLabel', 'startsAtLabel', 'endsAtLabel']) await expect(field(page, key), key).toBeEnabled()
})

test('375 px: the weights list, the tournament page and the pool page', { tag: ['@mf-h-mobile', '@mobile'] }, async ({ openAs, seed }) => {
  const page = await openForm(openAs)
  await sourceRadio(page, 'sourceFactionMix').click()
  await factionPills(page).getByRole('radio', { name: 'Axiom', exact: true }).click()
  await expect(page.getByTestId(/^set-weight-/)).toHaveCount(7)
  await expectNoHorizontalScroll(page)
  // Each row on one line: the stepper and its share sit side by side.
  for (const code of VISIBLE_SETS) {
    const stepper = await weight(page, code).boundingBox()
    const share = await weightRow(page, code).locator(':scope > span').last().boundingBox()
    expect(Math.abs((stepper.y + stepper.height / 2) - (share.y + share.height / 2)), code).toBeLessThan(4)
    expect(share.x, code).toBeGreaterThanOrEqual(stepper.x + stepper.width)
  }

  const { id } = await seed.tournament('alice', factionTournamentBody())
  await page.goto(`/tournament/t/${id}`)
  await expect(page.getByTestId('tournament-summary')).toBeVisible()
  await expectNoHorizontalScroll(page)
  const pool = await openPoolPage({ openAs, seed }, 'alice', id, 'Axiom mix')
  await expectNoHorizontalScroll(pool)
})
