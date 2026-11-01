import { createTaskQueue } from './taskQueue.js'
import { getCachedFace, putCachedFace } from './faceCache.js'

// The TRUE face of a unique card, as an image. The real unique faces live on no host (Altered's
// S3 is locked, the community CDN only has the base rare …_R1), so we draw them with the
// <altered-card> web component (the Altered Card Renderer, vendored in public/ and loaded by
// index.html) and snapshot its canvas to a JPEG data URL.
//
// Faces are requested separately from the card DATA (fetchUnique returns the data at once,
// with `imagePath: null` and `faceLang` set): pages render the pool straight away and each
// unique shows a card back until its face is ready (CardImage.jsx). Faces render a couple at a
// time (a render is CPU-heavy, all at once they all crawl), the one about to be revealed can
// jump the line, and finished faces are kept in IndexedDB (faceCache.js) across visits.
//
// Never falls back to the base rare's art: opening a unique is the highlight of a booster, and
// showing the wrong card in its place is worse than a moment of card back.

// Bump with the vendored renderer (index.html pins its commit) so cached faces get redrawn.
const RENDERER_VERSION = '84adbb8'
const CONCURRENCY = 2
const RENDER_ATTEMPTS = 2
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

// Draws one face; null if the renderer isn't loaded / times out / the canvas is tainted.
async function renderUniqueFace(reference, lang) {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !window.customElements) return null
  const CE = window.customElements
  if (!CE.get('altered-card')) {
    try { await Promise.race([CE.whenDefined('altered-card'), new Promise((_, rej) => setTimeout(rej, 6000))]) }
    catch { return null }
  }
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:744px;height:1039px;opacity:0;pointer-events:none;z-index:-1'
  const el = document.createElement('altered-card')
  el.setAttribute('ref', reference)
  el.setAttribute('locale', LOCALE[lang] ?? 'en')
  host.appendChild(el)
  document.body.appendChild(host)
  try {
    // The renderer signals nothing when it's done: poll the canvas until two reads match.
    const start = Date.now()
    let prev = ''
    while (Date.now() - start < 10000) {
      await new Promise(r => setTimeout(r, 250))
      const canvas = el.querySelector('canvas')
      if (!canvas || !canvas.width) continue
      let url
      try { url = canvas.toDataURL('image/jpeg', 0.85) } catch { return null } // CORS-tainted → give up
      if (url && url.length > 8000 && url === prev) return url // two identical reads → fully drawn
      prev = url
    }
    return (prev && prev.length > 8000) ? prev : null
  } finally {
    try { document.body.removeChild(host) } catch { /* already detached */ }
  }
}

// A cold page load can lose the race against the renderer's own script, hence a retry.
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
  const cacheKey = `${RENDERER_VERSION}:${key}`
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
