// Playwright globalSetup: refuses to run against a missing build, warns on a stale one,
// then brings up the throwaway Postgres (docker-compose.e2e.yml). The fakes and the app are
// started by the config's webServer entries.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { COMPOSE_FILE, ROOT_DIR } from './support/env.js'

function newestMtime(dir) {
  let newest = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const mtime = entry.isDirectory() ? newestMtime(full) : fs.statSync(full).mtimeMs
    if (mtime > newest) newest = mtime
  }
  return newest
}

export default async function globalSetup() {
  const index = path.join(ROOT_DIR, 'dist', 'index.html')
  if (!fs.existsSync(index)) throw new Error('dist/index.html missing — run npm run build (or make e2e)')
  if (fs.statSync(index).mtimeMs < newestMtime(path.join(ROOT_DIR, 'src'))) {
    console.warn('[e2e] dist/ is older than src/ — the suite runs the previous build (npm run build, or make e2e)')
  }
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'up', '-d', '--wait'], { stdio: 'inherit' })
}
