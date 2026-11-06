import { UNIQUES_EN } from './uniquesData.js'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cardImageUrl, isUniqueRef, needsCardApi, canonicalCardRef, apiSetCode,
  uniqueRefsIn, fetchUnique, fetchUniques, fetchRandomUniques, fetchSet,
} from './cardData.js'

describe('cardImageUrl', () => {
  it('builds a deterministic CDN url from the reference', () => {
    expect(cardImageUrl('ALT_CORE_B_AX_04_C')).toBe('https://cdn.alteredcore.org/cards/en/CORE/ALT_CORE_B_AX_04_C.webp')
  })

  it('lowercases the language and defaults to en for an unknown one', () => {
    expect(cardImageUrl('ALT_CORE_B_AX_04_C', 'FR')).toContain('/cards/fr/')
    expect(cardImageUrl('ALT_CORE_B_AX_04_C', 'XX')).toContain('/cards/en/')
  })

  it('falls back a unique reference to its base _R1 printing (no unique art on the CDN)', () => {
    expect(cardImageUrl('ALT_CORE_B_AX_04_U_1437')).toBe('https://cdn.alteredcore.org/cards/en/CORE/ALT_CORE_B_AX_04_R1.webp')
  })

  it('returns null for a falsy or malformed reference', () => {
    expect(cardImageUrl(null)).toBeNull()
    expect(cardImageUrl('')).toBeNull()
    expect(cardImageUrl('NoUnderscoresHere')).toBeNull()
  })
})

describe('isUniqueRef', () => {
  it('recognizes a unique reference', () => {
    expect(isUniqueRef('ALT_CORE_B_AX_04_U_1437')).toBe(true)
  })

  it('rejects standard printings', () => {
    expect(isUniqueRef('ALT_CORE_B_AX_04_C')).toBe(false)
    expect(isUniqueRef('ALT_CORE_B_AX_04_R1')).toBe(false)
  })

  it('handles nullish input', () => {
    expect(isUniqueRef(undefined)).toBe(false)
    expect(isUniqueRef(null)).toBe(false)
  })
})

describe('needsCardApi', () => {
  it('is true for uniques', () => {
    expect(needsCardApi('ALT_CORE_B_AX_04_U_1437')).toBe(true)
  })

  it('is true for non-B printings (alt-art, promo)', () => {
    expect(needsCardApi('ALT_CORE_A_AX_04_C')).toBe(true)
    expect(needsCardApi('ALT_BISE_P_BR_64_C')).toBe(true)
  })

  it('is false for a standard B printing', () => {
    expect(needsCardApi('ALT_CORE_B_AX_04_C')).toBe(false)
  })
})

describe('canonicalCardRef', () => {
  it('leaves an already-standard B printing untouched', () => {
    expect(canonicalCardRef('ALT_CORE_B_AX_04_C')).toBe('ALT_CORE_B_AX_04_C')
  })

  it('maps a promo/OP set code to the base set\'s B printing', () => {
    expect(canonicalCardRef('ALT_DUSTEROP_A_AX_98_C')).toBe('ALT_DUSTER_B_AX_98_C')
  })

  it('maps an alt-art reprint of a known set to its B twin', () => {
    expect(canonicalCardRef('ALT_CORE_A_AX_22_C')).toBe('ALT_CORE_B_AX_22_C')
  })

  it('leaves unique references untouched', () => {
    expect(canonicalCardRef('ALT_CORE_B_AX_04_U_1437')).toBe('ALT_CORE_B_AX_04_U_1437')
  })

  it('leaves an unknown set untouched', () => {
    expect(canonicalCardRef('ALT_UNKNOWNSET_A_AX_01_C')).toBe('ALT_UNKNOWNSET_A_AX_01_C')
  })

  it('passes through falsy input', () => {
    expect(canonicalCardRef(null)).toBeNull()
    expect(canonicalCardRef('')).toBe('')
  })
})

describe('apiSetCode', () => {
  it('is the identity function (COREKS is its own dataset)', () => {
    expect(apiSetCode('COREKS')).toBe('COREKS')
    expect(apiSetCode('CORE')).toBe('CORE')
  })
})

describe('uniqueRefsIn', () => {
  it('finds unique refs inside a plain string', () => {
    expect(uniqueRefsIn('pick ALT_CORE_B_AX_04_U_1437 now')).toEqual(['ALT_CORE_B_AX_04_U_1437'])
  })

  it('finds unique refs nested inside arbitrary objects/arrays', () => {
    const state = { packs: { 0: ['ALT_CORE_B_AX_04_U_1437', 'ALT_CORE_B_AX_04_C'] } }
    expect(uniqueRefsIn(state)).toEqual(['ALT_CORE_B_AX_04_U_1437'])
  })

  it('dedupes repeated refs', () => {
    const state = ['ALT_CORE_B_AX_04_U_1437', 'ALT_CORE_B_AX_04_U_1437']
    expect(uniqueRefsIn(state)).toEqual(['ALT_CORE_B_AX_04_U_1437'])
  })

  it('returns [] for null/undefined/no matches', () => {
    expect(uniqueRefsIn(null)).toEqual([])
    expect(uniqueRefsIn(undefined)).toEqual([])
    expect(uniqueRefsIn('no uniques here')).toEqual([])
  })
})

describe('fetchUnique', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('serves a bundled EN unique from the local snapshot without hitting the network', async () => {
    const card = await fetchUnique('ALT_CORE_B_AX_04_U_1437', 'EN')
    expect(card.name).toBe('Kelon Elemental')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fetches an unbundled reference live and normalizes the alteredcore.org shape', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        member: [{
          reference: 'ALT_EOLE_B_YZ_99_U_5555',
          name: { en: 'Live Unique', fr: 'Unique en direct' },
          faction: { code: 'YZ', name: 'Yzmir' },
          rarity: { reference: 'UNIQUE' },
          cardType: { reference: 'CHARACTER' },
          mainCost: 3, recallCost: 2, forestPower: 1, mountainPower: 2, oceanPower: 3,
        }],
      }),
    })

    const card = await fetchUnique('ALT_EOLE_B_YZ_99_U_5555', 'EN')
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(card.name).toBe('Live Unique')
    expect(card.faction).toBe('YZ')
    expect(card.rarity).toBe('U')
    expect(card.imagePath).toBeNull()
    expect(card.faceLang).toBe('EN')
  })

  it('flags the synthetic fallback card, never a bundled one', async () => {
    global.fetch.mockRejectedValue(new Error('down'))
    const synth = await fetchUnique('ALT_CORE_B_AX_04_U_999999999', 'EN')
    expect(synth.synthetic).toBe(true)
    const bundled = await fetchUnique(Object.keys(UNIQUES_EN)[0], 'EN')
    expect('synthetic' in bundled).toBe(false)
  }, 15000)

  it('aborts a stalled request instead of hanging', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ member: [{ reference: 'ALT_EOLE_B_YZ_99_U_7777', rarity: { reference: 'UNIQUE' } }] }) })
    await fetchUnique('ALT_EOLE_B_YZ_99_U_7777', 'EN')
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps the bundled EN uniques on their local image', async () => {
    const card = await fetchUnique('ALT_CORE_B_AX_04_U_1437', 'EN')
    expect(card.imagePath).toMatch(/^\/uniques\//)
    expect(card.faceLang).toBeUndefined()
  })

  it('falls back to the bundled EN snapshot when the live fetch fails, for a bundled ref', async () => {
    global.fetch.mockRejectedValueOnce(new Error('network down'))
    // FR lookup of a card that IS bundled in EN — hits the network first (non-EN), then falls back.
    const card = await fetchUnique('ALT_CORE_B_AX_04_U_1437', 'FR')
    expect(card.name).toBe('Kelon Elemental') // the EN snapshot, as a fallback
  })

  it('retries, then returns a placeholder built from the reference when there is no bundled fallback', async () => {
    vi.useFakeTimers()
    try {
      global.fetch.mockRejectedValue(new Error('network down'))
      const pending = fetchUnique('ALT_EOLE_B_YZ_99_U_9999', 'FR')
      await vi.runAllTimersAsync() // skip the retry backoff
      const card = await pending

      expect(global.fetch).toHaveBeenCalledTimes(3)
      expect(card).toMatchObject({
        reference: 'ALT_EOLE_B_YZ_99_U_9999',
        name: 'ALT_EOLE_B_YZ_99_U_9999',
        faction: 'XX',
        rarity: 'U',
        // a unique's face is on no host: it gets drawn (uniqueFaces.js), never the base rare's art
        imagePath: null,
        faceLang: 'FR',
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fetchUnique failures (I2)', () => {
  const originalFetch = global.fetch
  const live = reference => ({ ok: true, status: 200, json: async () => ({ member: [{ reference, name: { en: 'Real' }, faction: { code: 'AX' }, rarity: { reference: 'UNIQUE' }, cardType: { reference: 'CHARACTER' } }] }) })
  beforeEach(() => { global.fetch = vi.fn(); vi.useFakeTimers() })
  afterEach(() => { global.fetch = originalFetch; vi.useRealTimers() })
  const run = async p => { await vi.runAllTimersAsync(); return p }

  it('never caches the synthetic card of an unavailable API: a later fetch returns the real card', async () => {
    global.fetch.mockRejectedValue(new Error('down'))
    const first = await run(fetchUnique('ALT_EOLE_B_YZ_99_U_4242', 'EN'))
    expect(first).toMatchObject({ synthetic: true, unavailable: true })
    global.fetch.mockReset(); global.fetch.mockResolvedValue(live('ALT_EOLE_B_YZ_99_U_4242'))
    const second = await run(fetchUnique('ALT_EOLE_B_YZ_99_U_4242', 'EN'))
    expect(second.synthetic).toBeUndefined()
    expect(second.name).toBe('Real')
  })
  it('a 5xx is unavailable, a 404 or an empty member is unknown (synthetic, not unavailable)', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 502, json: async () => ({}) })
    expect(await run(fetchUnique('ALT_EOLE_B_YZ_99_U_4243', 'EN'))).toMatchObject({ synthetic: true, unavailable: true })
    global.fetch.mockReset(); global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    const notFound = await run(fetchUnique('ALT_EOLE_B_YZ_99_U_4244', 'EN'))
    expect(notFound.synthetic).toBe(true); expect(notFound.unavailable).toBeUndefined()
    global.fetch.mockReset(); global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ member: [] }) })
    const empty = await run(fetchUnique('ALT_EOLE_B_YZ_99_U_4245', 'EN'))
    expect(empty.synthetic).toBe(true); expect(empty.unavailable).toBeUndefined()
  })
  it('fetchUniques runs at most 8 requests at once', async () => {
    let inFlight = 0; let peak = 0
    global.fetch.mockImplementation(async url => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 10))
      inFlight--
      return live(new URL(url).searchParams.get('reference'))
    })
    const refs = Array.from({ length: 30 }, (_, i) => `ALT_EOLE_B_YZ_99_U_${7000 + i}`)
    const out = await run(fetchUniques(refs, 'EN'))
    expect(out).toHaveLength(30)
    expect(peak).toBeLessThanOrEqual(8)
    expect(peak).toBeGreaterThan(1)
  })
})

describe('fetchSet timeout (M2)', () => {
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })
  it('passes an abort signal to the set request', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    await fetchSet('FUGUE', 'IT')
    expect(global.fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('fetchRandomUniques', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('normalizes and dedupes members by reference', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        member: [
          { reference: 'ALT_EOLE_B_YZ_99_U_1', name: { en: 'A' }, faction: { code: 'YZ' }, rarity: { reference: 'UNIQUE' }, cardType: { reference: 'CHARACTER' } },
          { reference: 'ALT_EOLE_B_YZ_99_U_1', name: { en: 'A dup' }, faction: { code: 'YZ' }, rarity: { reference: 'UNIQUE' }, cardType: { reference: 'CHARACTER' } },
          { reference: 'ALT_EOLE_B_OR_10_U_2', name: { en: 'B' }, faction: { code: 'OR' }, rarity: { reference: 'UNIQUE' }, cardType: { reference: 'CHARACTER' } },
        ],
      }),
    })

    const cards = await fetchRandomUniques('EOLE', 50, 'EN')
    expect(cards).toHaveLength(2)
    expect(cards.map(c => c.reference)).toEqual(['ALT_EOLE_B_YZ_99_U_1', 'ALT_EOLE_B_OR_10_U_2'])
  })

  it('degrades gracefully to [] on failure (pack generation should not blow up)', async () => {
    global.fetch.mockRejectedValueOnce(new Error('down'))
    expect(await fetchRandomUniques('EOLE')).toEqual([])
  })

  it('degrades gracefully to [] on a non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 })
    expect(await fetchRandomUniques('EOLE')).toEqual([])
  })
})

describe('fetchSet', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('reads the set file from the configured card DB', async () => {
    vi.stubEnv('CARD_DB_URL', 'http://localhost:8091/carddb')
    vi.resetModules()
    const { fetchSet: fetchSetFresh } = await import('./cardData.js')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    await fetchSetFresh('CYCLONE')
    expect(global.fetch.mock.calls[0][0]).toBe('http://localhost:8091/carddb/CYCLONE/CYCLONE_EN.json')
  })
})
