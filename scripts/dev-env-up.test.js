import { describe, it, expect } from 'vitest'
import { ensureDevEnv, stopDevEnv, dashboardUrl } from './dev-env-up.mjs'

const KC = 'http://kc.test:18080'
const DECKS = 'http://decks.test:8001'

// `upAfter` = how many readiness polls fail before both services answer.
function fakes({ upAfter = 0, dirExists = true } = {}) {
  let polls = 0
  const spawned = []
  const fetch = async url => {
    if (url === `${KC}/realms/players` || url === `${DECKS}/api/docs.json`) {
      polls++
      return { ok: polls > upAfter * 2 }
    }
    return { ok: false }
  }
  const spawn = (cmd, args, opts) => { spawned.push({ cmd, args, opts }); return { pid: 4242, unref() {} } }
  const exists = () => dirExists
  const log = []
  return { fetch, spawn, exists, spawned, log: m => log.push(m), lines: log }
}

const run = (f, extra = {}) => ensureDevEnv({
  fetch: f.fetch, spawn: f.spawn, exists: f.exists, log: f.log,
  dir: '/repos/altered-dev-environment', aspire: '/tools/aspire', keycloakUrl: KC, decksApiUrl: DECKS,
  logFile: '/tmp/x.log', pidFile: '/tmp/x.pid', writePid: () => {}, openLog: () => 'ignore', readLog: () => '',
  timeoutMs: 1000, pollMs: 0, ...extra,
})

describe('dashboardUrl', () => {
  it('finds the tokened dashboard link in the AppHost log, OSC-8 hyperlink escapes included', () => {
    const log = 'Tableau de bord:  \u001b]8;id=1;https://localhost:17272/login?t=ad45d37a779a\u001b\\https://localhost:17272/login?t=ad45d37a779a\u001b]8;;\u001b\\\n'
    expect(dashboardUrl(log)).toBe('https://localhost:17272/login?t=ad45d37a779a')
  })

  it('takes the last link: the log is appended across restarts and every run mints a new token', () => {
    const log = 'login at https://localhost:17272/login?t=aaaa0000\n…\nlogin at https://localhost:17272/login?t=bbbb1111\n'
    expect(dashboardUrl(log)).toBe('https://localhost:17272/login?t=bbbb1111')
  })

  it('is null when the log has no link yet', () => {
    expect(dashboardUrl('Démarrage du tableau de bord...\n')).toBeNull()
    expect(dashboardUrl('')).toBeNull()
  })
})

describe('ensureDevEnv', () => {
  it('does nothing when Keycloak and decks-api already answer', async () => {
    const f = fakes()
    expect(await run(f)).toBe('already-up')
    expect(f.spawned).toEqual([])
  })

  it('starts `aspire run` detached in the dev-env dir (not run.sh: its prompts need a TTY) and waits for both services', async () => {
    const f = fakes({ upAfter: 3 })
    expect(await run(f)).toBe('started')
    expect(f.spawned).toHaveLength(1)
    const [{ cmd, args, opts }] = f.spawned
    expect(cmd).toBe('/tools/aspire')
    expect(args).toEqual(['run'])
    expect(opts.cwd).toBe('/repos/altered-dev-environment')
    // Its own process group: Ctrl+C on `make dev` must not take the dev env down with it.
    expect(opts.detached).toBe(true)
    expect(f.lines.at(-1)).toMatch(/dev environment up/)
  })

  it('tells how to install the prerequisites when the aspire CLI is missing', async () => {
    const f = fakes({ upAfter: 99 })
    expect(await run(f, { aspire: null })).toBe('missing-aspire')
    expect(f.spawned).toEqual([])
    expect(f.lines.join('\n')).toMatch(/run\.sh/)
  })

  it('warns and gives up when the sibling repo is missing', async () => {
    const f = fakes({ upAfter: 99, dirExists: false })
    expect(await run(f)).toBe('missing-dir')
    expect(f.spawned).toEqual([])
    expect(f.lines.join('\n')).toMatch(/altered-dev-environment/)
  })

  it('reports a timeout when the services never answer', async () => {
    const f = fakes({ upAfter: 1e9 })
    expect(await run(f, { timeoutMs: 30 })).toBe('timeout')
    expect(f.spawned).toHaveLength(1)
    expect(f.lines.join('\n')).toMatch(/\/tmp\/x\.log/)
  })
})

describe('stopDevEnv', () => {
  const stop = (extra = {}) => {
    const killed = []
    const lines = []
    const result = stopDevEnv({
      pidFile: '/tmp/x.pid', readPid: () => null, removePid: () => {}, listAspire: () => [],
      kill: (pid, sig) => killed.push([pid, sig]), log: m => lines.push(m), ...extra,
    })
    return { result, killed, lines }
  }

  it('stops the process group recorded by make dev', () => {
    const { result, killed } = stop({ readPid: () => 4242 })
    expect(result).toBe('stopped')
    expect(killed).toEqual([[-4242, 'SIGTERM']])
  })

  it('also stops an AppHost started by hand (./run.sh in a terminal), found by process name', () => {
    const { result, killed, lines } = stop({ listAspire: () => [777, 778] })
    expect(result).toBe('stopped')
    expect(killed).toEqual([[777, 'SIGTERM'], [778, 'SIGTERM']])
    expect(lines.join('\n')).toMatch(/started outside make dev/)
  })

  it('does not count a stale pid file as a stop', () => {
    const { result, killed } = stop({ readPid: () => 4242, kill: () => { const e = new Error('gone'); e.code = 'ESRCH'; throw e } })
    expect(result).toBe('nothing')
    expect(killed).toEqual([])
  })

  it('reports nothing to stop', () => {
    const { result, lines } = stop()
    expect(result).toBe('nothing')
    expect(lines.join('\n')).toMatch(/nothing to stop/)
  })
})
