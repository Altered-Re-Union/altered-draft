// The app as Playwright's webServer: refuses to start against a missing build and warns on a
// stale one, then runs server/index.js unchanged. The check lives here rather than in a
// globalSetup because Playwright starts the webServers first: a globalSetup would only refuse
// once the app was already serving whatever dist/ held.
import fs from 'node:fs'
import path from 'node:path'
import { ROOT_DIR } from './support/env.js'

function newestMtime(dir) {
  let newest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const mtime = entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs
    if (mtime > newest) newest = mtime
  }
  return newest
}

const index = path.join(ROOT_DIR, 'dist', 'index.html')
if (!fs.existsSync(index)) {
  console.error('[e2e] dist/index.html missing — run npm run build (or make e2e)')
  process.exit(1)
}
if (fs.statSync(index).mtimeMs < newestMtime(path.join(ROOT_DIR, 'src'))) {
  console.warn('[e2e] dist/ is older than src/ — the suite runs the previous build (npm run build, or make e2e)')
}
await import('../../server/index.js')
