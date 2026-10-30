// Starts the sibling altered-dev-environment (Keycloak + decks-api, .NET Aspire) when it
// isn't answering yet, and waits until both services do. Run by `make dev` / `make dev-env`.
// The AppHost is spawned detached, in its own process group, so Ctrl+C on `make dev` only
// stops the API and Vite and the dev env keeps running like Postgres does; `make dev-env-down`
// (this script with --down) stops what was started here, through the pid file.
//
// Never fails the caller: login is optional, so a dev env that can't be started (repo not
// cloned next to this one, build taking longer than the timeout) is a warning, the app
// still runs without Re:Union login.
import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULTS = {
  dir: path.resolve(process.env.DEV_ENV_DIR || '../altered-dev-environment'),
  keycloakUrl: (process.env.KEYCLOAK_ISSUER || 'http://auth.altered.local.gd:18080/realms/players').replace(/\/realms\/.*$/, ''),
  decksApiUrl: process.env.DECKS_API_URL || 'http://localhost:8001',
  logFile: process.env.DEV_ENV_LOG || '/tmp/altered-dev-environment.log',
  pidFile: process.env.DEV_ENV_PID || '/tmp/altered-dev-environment.pid',
  // The first run builds the auth + decks images: minutes, not seconds.
  timeoutMs: 10 * 60 * 1000,
  pollMs: 2000,
}

const answers = async (f, url) => {
  try {
    return (await f(url, { signal: AbortSignal.timeout(3000) })).ok
  } catch {
    return false
  }
}

/** Returns 'already-up' | 'started' | 'missing-dir' | 'timeout'. */
export async function ensureDevEnv(opts = {}) {
  const {
    fetch: f = fetch, spawn = nodeSpawn, exists = existsSync, openLog = file => openSync(file, 'a'),
    writePid = (file, pid) => writeFileSync(file, `${pid}\n`), log = console.log,
    dir, keycloakUrl, decksApiUrl, logFile, pidFile, timeoutMs, pollMs,
  } = { ...DEFAULTS, ...opts }
  const ready = async () => (await answers(f, `${keycloakUrl}/realms/players`)) && (await answers(f, `${decksApiUrl}/api/docs.json`))

  if (await ready()) {
    log(`→ dev environment already up: Keycloak ${keycloakUrl}, decks-api ${decksApiUrl}`)
    return 'already-up'
  }
  if (!exists(path.join(dir, 'run.sh'))) {
    log(`⚠ altered-dev-environment not found at ${dir} — clone it next to this repo (or set DEV_ENV_DIR); no Re:Union login locally meanwhile.`)
    return 'missing-dir'
  }

  log(`→ starting altered-dev-environment from ${dir} (log: ${logFile}); the first run builds images and takes a few minutes…`)
  const out = openLog(logFile)
  const child = spawn('./run.sh', [], { cwd: dir, detached: true, stdio: ['ignore', out, out] })
  child.unref()
  writePid(pidFile, child.pid)

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollMs))
    if (await ready()) {
      log(`→ dev environment up: Keycloak ${keycloakUrl}, decks-api ${decksApiUrl}`)
      return 'started'
    }
  }
  log(`⚠ dev environment still not answering after ${Math.round(timeoutMs / 1000)}s — see ${logFile}; the app runs without Re:Union login meanwhile.`)
  return 'timeout'
}

/** Stops the AppHost `make dev` started (its whole process group); a no-op without a pid file. */
export function stopDevEnv({ pidFile = DEFAULTS.pidFile, kill = process.kill, log = console.log } = {}) {
  if (!existsSync(pidFile)) {
    log('→ no dev environment started by make dev (no pid file); if you started ./run.sh yourself, stop it there with Ctrl+C.')
    return 'nothing'
  }
  const pid = Number(readFileSync(pidFile, 'utf8'))
  try {
    kill(-pid, 'SIGTERM')
    log(`→ dev environment stopped (process group ${pid})`)
  } catch (err) {
    log(`→ dev environment already gone (${err.code || err.message})`)
  }
  rmSync(pidFile, { force: true })
  return 'stopped'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = process.argv.includes('--down') ? Promise.resolve(stopDevEnv()) : ensureDevEnv()
  run.catch(err => console.warn(`⚠ dev environment: ${err.message}`))
}
