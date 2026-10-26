// Playwright globalTeardown: removes the throwaway Postgres, unless E2E_KEEP_STACK=1 keeps
// it for the next run (then `make e2e-down` removes it).
import { execFileSync } from 'node:child_process'
import { COMPOSE_FILE } from './support/env.js'

export default async function globalTeardown() {
  if (process.env.E2E_KEEP_STACK === '1') return
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, 'down', '-v'], { stdio: 'inherit' })
}
