// The throwaway Postgres as Playwright's FIRST webServer, so that it is stopped LAST:
// Playwright tears webServers down after globalTeardown, in reverse order. Stopping the
// container from globalTeardown instead would cut it under the still-running app, whose pg
// pool then dies on an unhandled 57P01 error at the end of every run.
// Brings the stack up, answers /health on DB_STACK_PORT once Postgres is healthy, and
// removes the stack on SIGTERM (kept with E2E_KEEP_STACK=1; then `make e2e-down`).
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import { COMPOSE_FILE, DB_STACK_PORT } from './support/env.js'

const compose = (...args) => execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], { stdio: 'inherit' })

compose('up', '-d', '--wait')
const server = http.createServer((req, res) => res.end('ok')).listen(DB_STACK_PORT)

process.on('SIGTERM', () => {
  server.close()
  if (process.env.E2E_KEEP_STACK !== '1') compose('down', '-v')
  process.exit(0)
})
