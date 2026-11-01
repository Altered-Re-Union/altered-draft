// Persistent browser cache for rendered unique faces (IndexedDB), so reopening a pool doesn't
// re-render every unique. Best effort: when IndexedDB is missing or refuses (private mode,
// blocked storage, Node) every call degrades to a miss / no-op.
//
// Size stays bounded by our own pruning — the browser only evicts a site's storage as a whole,
// under disk pressure, so we can't rely on it: entries older than MAX_AGE_MS go, and beyond
// MAX_ENTRIES the oldest go (a face is a ~150-250 KB JPEG data URL, so ~50 MB at most).
// Pruning runs once per page load, on the first access, reading keys and dates only.

const DB_NAME = 'altered-draft'
const STORE = 'unique-faces'
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000
export const MAX_ENTRIES = 200

// Keys of the entries to delete: expired ones, then the oldest beyond `maxEntries`.
// `entries` = [{ key, savedAt }] in any order.
export function facesToEvict(entries, now, { maxAgeMs = MAX_AGE_MS, maxEntries = MAX_ENTRIES } = {}) {
  const sorted = [...entries].sort((a, b) => a.savedAt - b.savedAt)
  const fresh = sorted.filter(e => now - e.savedAt <= maxAgeMs)
  const expired = sorted.filter(e => now - e.savedAt > maxAgeMs)
  const overflow = fresh.slice(0, Math.max(0, fresh.length - maxEntries))
  return [...expired, ...overflow].map(e => e.key)
}

let dbPromise = null
function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('savedAt', 'savedAt')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch { resolve(null) }
  }).then(db => { if (db) prune(db); return db })
  return dbPromise
}

function prune(db) {
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const entries = []
    const cursorReq = store.index('savedAt').openKeyCursor()
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result
      if (cursor) { entries.push({ key: cursor.primaryKey, savedAt: cursor.key }); cursor.continue(); return }
      for (const key of facesToEvict(entries, Date.now())) store.delete(key)
    }
  } catch { /* pruning is best effort */ }
}

export async function getCachedFace(key) {
  const db = await openDb()
  if (!db) return null
  return new Promise(resolve => {
    try {
      const req = db.transaction(STORE).objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result?.src ?? null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

export async function putCachedFace(key, src) {
  const db = await openDb()
  if (!db) return
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, src, savedAt: Date.now() }) }
  catch { /* quota or blocked storage: the face just isn't cached */ }
}
