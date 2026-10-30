// Starts the sibling altered-dev-environment (Keycloak + decks-api, .NET Aspire) when it
// isn't answering yet, and waits until both services do. Run by `make dev` / `make dev-env`.
// The AppHost (`aspire run`, what the sibling repo's ./run.sh ends with) is spawned detached,
// in its own process group, so Ctrl+C on `make dev` only stops the API and Vite and the dev
// env keeps running like Postgres does; `make dev-env-down` (this script with --down) stops
// what was started here, through the pid file. ./run.sh itself is not used: its prerequisite
// checks prompt on a TTY (none here) and it opens the Aspire dashboard in a browser tab; the
// dashboard link, with its login token, is read from the log instead (see dashboardUrl).
//
// Never fails the caller: login is optional, so a dev env that can't be started (repo not
// cloned next to this one, aspire CLI missing, build taking longer than the timeout) is a
// warning, the app still runs without Re:Union login.
import { spawn as nodeSpawn, spawnSync } from 'node:child_process'
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The aspire CLI: on PATH, or where `dotnet tool install -g` puts it; null when absent. */
export function findAspire({ env = process.env, exists = existsSync } = {}) {
  const candidates = [
    ...(env.PATH || '').split(path.delimiter).filter(Boolean).map(d => path.join(d, 'aspire')),
    path.join(os.homedir(), '.dotnet', 'tools', 'aspire'),
  ]
  return candidates.find(c => exists(c)) ?? null
}

/**
 * The tokened dashboard login link the AppHost prints (through OSC-8 hyperlink escapes).
 * The last one: the log is appended across restarts and every run mints a new token.
 */
export function dashboardUrl(logText) {
  const links = logText.match(/https?:\/\/localhost:\d+\/login\?t=[0-9a-f]+/g)
  return links?.at(-1) ?? null
}

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
    readLog = file => (existsSync(file) ? readFileSync(file, 'utf8') : ''),
    writePid = (file, pid) => writeFileSync(file, `${pid}\n`), log = console.log,
    aspire = findAspire(), dir, keycloakUrl, decksApiUrl, logFile, pidFile, timeoutMs, pollMs,
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
  if (!aspire) {
    log(`⚠ the aspire CLI is not installed — run ./run.sh once in ${dir} (it installs the .NET SDK and aspire), then make dev again; no Re:Union login locally meanwhile.`)
    return 'missing-aspire'
  }

  log(`→ starting altered-dev-environment from ${dir} (aspire run, log: ${logFile}); the first run builds images and takes a few minutes…`)
  const out = openLog(logFile)
  const child = spawn(aspire, ['run'], { cwd: dir, detached: true, stdio: ['ignore', out, out] })
  child.unref()
  writePid(pidFile, child.pid)

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollMs))
    if (await ready()) {
      const dashboard = dashboardUrl(readLog(logFile))
      log(`→ dev environment up: Keycloak ${keycloakUrl}, decks-api ${decksApiUrl}${dashboard ? `, Aspire dashboard ${dashboard}` : ''}`)
      return 'started'
    }
  }
  log(`⚠ dev environment still not answering after ${Math.round(timeoutMs / 1000)}s — see ${logFile}; the app runs without Re:Union login meanwhile.`)
  return 'timeout'
}

/** Pids of every running `aspire run` (an AppHost started by hand from ./run.sh, typically). */
function runningAspire() {
  const res = spawnSync('pgrep', ['-f', 'aspire run'], { encoding: 'utf8' })
  return (res.stdout || '').split('\n').map(Number).filter(pid => pid > 0 && pid !== process.pid)
}

/**
 * Stops the dev environment: the process group `make dev` recorded in the pid file, or,
 * without one (started by hand with ./run.sh), every running `aspire run`. Returns
 * 'stopped' | 'nothing'.
 */
export function stopDevEnv({
  pidFile = DEFAULTS.pidFile,
  readPid = file => (existsSync(file) ? Number(readFileSync(file, 'utf8')) || null : null),
  removePid = file => rmSync(file, { force: true }),
  listAspire = runningAspire,
  kill = process.kill,
  log = console.log,
} = {}) {
  let stopped = false
  const pid = readPid(pidFile)
  if (pid) {
    try {
      kill(-pid, 'SIGTERM')
      log(`→ dev environment stopped (process group ${pid})`)
      stopped = true
    } catch (err) {
      log(`→ stale pid file ignored (${err.code || err.message})`)
    }
    removePid(pidFile)
  }
  if (!stopped) {
    for (const other of listAspire()) {
      try {
        kill(other, 'SIGTERM')
        log(`→ stopped an AppHost started outside make dev (pid ${other})`)
        stopped = true
      } catch (err) {
        log(`→ AppHost ${other} already gone (${err.code || err.message})`)
      }
    }
  }
  if (!stopped) log('→ dev environment: nothing to stop')
  return stopped ? 'stopped' : 'nothing'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = process.argv.includes('--down') ? Promise.resolve(stopDevEnv()) : ensureDevEnv()
  run.catch(err => console.warn(`⚠ dev environment: ${err.message}`))
}
