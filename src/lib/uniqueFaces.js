import { createTaskQueue } from './taskQueue.js'
import { getCachedFace, putCachedFace } from './faceCache.js'
import { endpoints } from './endpoints.js'

// The TRUE face of a unique card, as an image. The real unique faces live on no host (Altered's
// S3 is locked, the community CDN only has the base rare …_R1), so we draw them with the
// Altered Card Renderer (vendored in public/ and loaded by index.html, which also exposes it as
// `window.AlteredRender`) on a canvas and snapshot it to a JPEG data URL.
//
// Faces are requested separately from the card DATA (fetchUnique returns the data at once,
// with `imagePath: null` and `faceLang` set): pages render the pool straight away and each
// unique shows a card back until its face is ready (CardImage.jsx). Faces render a couple at a
// time (a render is CPU-heavy, all at once they all crawl), the one about to be revealed can
// jump the line, and finished faces are kept in IndexedDB (faceCache.js) across visits.
//
// We call `AlteredRender.mountFromApi()` ourselves instead of mounting an <altered-card>
// element: the element signals nothing when it is done, and its canvas first shows a
// "Loading… <ref>" placeholder (card back) while the art downloads. Guessing the end by
// polling the canvas snapshotted that placeholder on any slow network (mobile) and cached it
// for 30 days. mountFromApi resolves once the art is loaded and the card drawn, and its state
// tells whether the art made it.
//
// Never falls back to the base rare's art: opening a unique is the highlight of a booster, and
// showing the wrong card in its place is worse than a moment of card back.

// Bump with the vendored renderer (index.html pins its commit) so cached faces get redrawn.
const RENDERER_VERSION = '84adbb8'
// Bump to drop every cached face — v2 drops the "Loading…" placeholders cached by the
// canvas-polling version.
const FACE_CACHE_VERSION = 2
const CACHE_PREFIX = `${RENDERER_VERSION}.${FACE_CACHE_VERSION}`
const CONCURRENCY = 2
const RENDER_ATTEMPTS = 2
// A cold render first loads the renderer's config, fonts and art (~15 files): on a slow mobile
// network that takes well over 10 s, so the budget is generous — a face that takes it all is
// still better than a failed one, and the card back shows meanwhile.
const RENDER_TIMEOUT_MS = 30000
const RENDERER_WAIT_MS = 6000
const DATA_TIMEOUT_MS = 10000
const BATCH_MAX = 50
const LOCALE = { EN: 'en', FR: 'fr', ES: 'es', DE: 'de', IT: 'it' }

const queue = createTaskQueue(CONCURRENCY)
const faces = new Map() // key -> { status: 'pending' | 'ready' | 'failed', src, promise }
const listeners = new Map() // key -> Set<fn>

function faceKey(reference, lang) {
  return `${reference}_${LOCALE[lang] ?? 'en'}`
}

function setFace(key, patch) {
  faces.set(key, { ...faces.get(key), ...patch })
  for (const fn of listeners.get(key) ?? []) fn()
}

function withTimeout(promise, ms) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) }),
  ]).finally(() => clearTimeout(timer))
}

// The renderer API, once its script has run; null without a DOM or when it never loads.
async function renderer() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  if (window.AlteredRender) return window.AlteredRender
  if (!window.customElements) return null
  try { await withTimeout(window.customElements.whenDefined('altered-card'), RENDERER_WAIT_MS) }
  catch { return null }
  return window.AlteredRender ?? null
}

let warming = null
/**
 * Starts loading the renderer's config and fonts (~15 files from the CDN) before the first
 * face is needed, so that face doesn't pay for them. Idempotent and harmless without a DOM.
 */
export function warmUniqueRenderer() {
  if (!warming) {
    warming = renderer()
      .then(R => R?.init?.())
      .catch(() => { warming = null }) // a failed warm-up is retried by the next call
  }
  return warming
}

// The renderer's card data (raw cards API shape) comes from the batch endpoint, like the
// renderer's own <altered-card> path: the faces requested in the same tick (a pool page mounts
// them all at once) share one request. Failures are not remembered, so a retry asks again.
const cardData = new Map() // `${ref}|${locale}` -> Promise<card | null>
let batch = null // { locale -> Map<ref, { resolve }> }

function fetchCardData(reference, locale) {
  const key = `${reference}|${locale}`
  if (cardData.has(key)) return cardData.get(key)
  const promise = new Promise(resolve => {
    if (!batch) {
      batch = new Map()
      setTimeout(flushBatch, 0)
    }
    if (!batch.has(locale)) batch.set(locale, new Map())
    batch.get(locale).set(reference, resolve)
  }).then(card => {
    if (!card) cardData.delete(key)
    return card
  })
  cardData.set(key, promise)
  return promise
}

function flushBatch() {
  const pending = batch
  batch = null
  for (const [locale, waiting] of pending) {
    const refs = [...waiting.keys()]
    for (let i = 0; i < refs.length; i += BATCH_MAX) {
      const chunk = refs.slice(i, i + BATCH_MAX)
      postBatch(chunk, locale).then(cards => {
        const byRef = new Map(cards.map(card => [card?.reference, card]))
        for (const ref of chunk) waiting.get(ref)(byRef.get(ref) ?? null)
      })
    }
  }
}

async function postBatch(references, locale) {
  try {
    const res = await fetch(`${endpoints().cardsApiUrl}/api/cards/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ references, locale }),
      signal: AbortSignal.timeout?.(DATA_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const cards = await res.json()
    return Array.isArray(cards) ? cards : []
  } catch {
    return []
  }
}

// Draws one face; null if the renderer isn't loaded, the card or its art is missing, it times
// out or the canvas is tainted — never the renderer's placeholder.
async function renderUniqueFace(reference, lang) {
  const locale = LOCALE[lang] ?? 'en'
  const [R, card] = await Promise.all([renderer(), fetchCardData(reference, locale)])
  if (!R?.mountFromApi || !card) return null
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:744px;height:1039px;opacity:0;pointer-events:none;z-index:-1'
  document.body.appendChild(host)
  try {
    const { canvas, state } = await withTimeout(
      R.mountFromApi(host, { ...card, forge: { collection: 'official', lang: locale } }),
      RENDER_TIMEOUT_MS,
    )
    if (!canvas?.width || !state?.images?.bg) return null // no art: a frame on a blank card
    try { return canvas.toDataURL('image/jpeg', 0.85) } catch { return null } // CORS-tainted
  } finally {
    try { document.body.removeChild(host) } catch { /* already detached */ }
  }
}

// A transient failure (art or data request) gets a second chance.
async function renderWithRetries(reference, lang) {
  for (let attempt = 0; attempt < RENDER_ATTEMPTS; attempt++) {
    const src = await renderUniqueFace(reference, lang).catch(() => null)
    if (src) return src
  }
  return null
}

/** Current state of a face: { status: 'idle' | 'pending' | 'ready' | 'failed', src }. */
export function getUniqueFace(reference, lang = 'EN') {
  return faces.get(faceKey(reference, lang)) ?? { status: 'idle', src: null }
}

export function subscribeUniqueFace(reference, lang, fn) {
  const key = faceKey(reference, lang)
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(fn)
  return () => listeners.get(key)?.delete(fn)
}

/**
 * Resolves with the face's data URL, or null when it couldn't be drawn. Idempotent: a face
 * already drawn or in progress isn't started again. `front` puts it ahead of the waiting ones.
 */
export function requestUniqueFace(reference, lang = 'EN', { front = false } = {}) {
  const key = faceKey(reference, lang)
  const face = faces.get(key)
  if (face?.status === 'ready') return Promise.resolve(face.src)
  if (face?.status === 'pending') {
    if (front) queue.prioritize([key])
    return face.promise
  }
  // The cache lookup runs inside the queued task (a few ms), so the task is queued right away
  // and prioritizeUniqueFaces can reorder it immediately.
  const cacheKey = `${CACHE_PREFIX}:${key}`
  // Asked now rather than in the task, so the faces requested together share one batch
  // request instead of one per queue slot (cheap even when the face turns out to be cached).
  fetchCardData(reference, LOCALE[lang] ?? 'en')
  const promise = queue.add(key, async () => {
    const cached = await getCachedFace(cacheKey)
    if (cached) return cached
    const src = await renderWithRetries(reference, lang)
    if (src) putCachedFace(cacheKey, src)
    return src
  }, { front }).catch(() => null).then(src => {
    setFace(key, src ? { status: 'ready', src } : { status: 'failed', src: null })
    return src
  })
  setFace(key, { status: 'pending', src: null, promise })
  return promise
}

/**
 * Moves the faces of these cards (unique card objects, with `faceLang`) to the front of the
 * queue, in this order — requesting the ones not asked for yet.
 */
export function prioritizeUniqueFaces(cards) {
  for (const card of cards) requestUniqueFace(card.reference, card.faceLang)
  queue.prioritize(cards.map(card => faceKey(card.reference, card.faceLang)))
}

/** Tries a failed face again, ahead of the others. */
export function retryUniqueFace(reference, lang = 'EN') {
  const key = faceKey(reference, lang)
  if (faces.get(key)?.status === 'failed') faces.delete(key)
  return requestUniqueFace(reference, lang, { front: true })
}
