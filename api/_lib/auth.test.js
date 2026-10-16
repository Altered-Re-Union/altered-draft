import { describe, it, expect, vi, afterEach } from 'vitest'
import { decodeJwtPayload, moderatorConfig, isModerator, verifyUser } from './auth.js'

const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url')
const jwt = payload => `${b64url({ alg: 'RS256' })}.${b64url(payload)}.sig`

describe('decodeJwtPayload', () => {
  it('reads the payload of a well-formed token and returns {} otherwise', () => {
    expect(decodeJwtPayload(jwt({ realm_access: { roles: ['a'] } }))).toEqual({ realm_access: { roles: ['a'] } })
    expect(decodeJwtPayload('garbage')).toEqual({})
    expect(decodeJwtPayload('')).toEqual({})
  })
})

describe('isModerator', () => {
  it('matches the configured role or the allowlisted sub, and nothing when unconfigured', () => {
    const cfg = moderatorConfig({ TOURNAMENT_MODERATOR_ROLE: ' mod ', TOURNAMENT_MODERATORS: 'sub-a, sub-b' })
    expect(cfg).toEqual({ role: 'mod', subs: ['sub-a', 'sub-b'] })
    expect(isModerator({ sub: 'x', roles: ['mod'] }, cfg)).toBe(true)
    expect(isModerator({ sub: 'sub-b', roles: [] }, cfg)).toBe(true)
    expect(isModerator({ sub: 'x', roles: ['other'] }, cfg)).toBe(false)
    expect(isModerator({ sub: 'x', roles: ['mod'] }, moderatorConfig({}))).toBe(false)
  })
})

describe('verifyUser', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns sub, display name and roles once userinfo accepts the token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sub: 's1', preferred_username: 'alice' }) })))
    const req = { method: 'GET', url: '/x', headers: { authorization: `Bearer ${jwt({ realm_access: { roles: ['mod'] } })}` } }
    const user = await verifyUser(req)
    expect(user).toMatchObject({ sub: 's1', name: 'alice', roles: ['mod'] })
    expect(typeof user.isModerator).toBe('boolean')
  })

  it('returns null without a bearer or when userinfo rejects it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
    expect(await verifyUser({ method: 'GET', url: '/x', headers: {} })).toBeNull()
    expect(await verifyUser({ method: 'GET', url: '/x', headers: { authorization: 'Bearer bad' } })).toBeNull()
  })
})
