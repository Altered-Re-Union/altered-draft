// Vitest globalSetup for the api/rooms/* integration suite: brings up the throwaway
// Postgres from docker-compose.test.yml, points DATABASE_URL at it, and tears the
// container down again when the run finishes (pass or fail).
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const composeFile = path.join(rootDir, 'docker-compose.test.yml')
const composeArgs = ['compose', '-f', composeFile]

export async function setup() {
  process.env.DATABASE_URL = 'postgres://altered_draft_test:altered_draft_test@localhost:55432/altered_draft_test'
  process.env.DATABASE_SSL = 'false'

  execFileSync('docker', [...composeArgs, 'up', '-d', '--wait'], { stdio: 'inherit' })
}

export async function teardown() {
  execFileSync('docker', [...composeArgs, 'down', '-v'], { stdio: 'inherit' })
}
