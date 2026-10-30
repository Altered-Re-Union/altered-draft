import { describe, it, expect } from 'vitest'
import { ensureDevEnv } from './dev-env-up.mjs'

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
  dir: '/repos/altered-dev-environment', keycloakUrl: KC, decksApiUrl: DECKS,
  logFile: '/tmp/x.log', pidFile: '/tmp/x.pid', writePid: () => {},
  timeoutMs: 1000, pollMs: 0, ...extra,
})

describe('ensureDevEnv', () => {
  it('does nothing when Keycloak and decks-api already answer', async () => {
    const f = fakes()
    expect(await run(f)).toBe('already-up')
    expect(f.spawned).toEqual([])
  })

  it('starts run.sh detached in the dev-env dir and waits for both services', async () => {
    const f = fakes({ upAfter: 3 })
    expect(await run(f)).toBe('started')
    expect(f.spawned).toHaveLength(1)
    const [{ cmd, args, opts }] = f.spawned
    expect(cmd).toBe('./run.sh')
    expect(args).toEqual([])
    expect(opts.cwd).toBe('/repos/altered-dev-environment')
    // Its own process group: Ctrl+C on `make dev` must not take the dev env down with it.
    expect(opts.detached).toBe(true)
    expect(f.lines.at(-1)).toMatch(/dev environment up/)
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
