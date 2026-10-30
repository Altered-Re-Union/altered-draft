import { describe, it, expect } from 'vitest'
import { ensureUsers, DEV_USERS } from './keycloak-dev-users.mjs'

const KC = 'http://kc.test:18080'
const json = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) })

// A fake Keycloak admin API: records every call, answers by route. `create` is the status
// of the user POST (201 on a fresh realm, 409 when the user already exists).
function fakeKeycloak({ create = 201 } = {}) {
  const calls = []
  const fetch = async (url, init = {}) => {
    // The admin token call posts form data, every other call JSON.
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? null
    calls.push({ method: init.method || 'GET', url, headers: init.headers || {}, body })
    if (url === `${KC}/realms/master/protocol/openid-connect/token`) return json(200, { access_token: 'ADMIN' })
    if (url === `${KC}/admin/realms/players/users` && init.method === 'POST') return json(create, {})
    if (url.startsWith(`${KC}/admin/realms/players/users?username=`)) return json(200, [{ id: 'u-carol' }])
    if (url === `${KC}/admin/realms/players/users/u-carol` && init.method === 'PUT') return json(204, {})
    if (url === `${KC}/admin/realms/players/users/u-carol/reset-password` && init.method === 'PUT') return json(204, {})
    return json(404, { error: `unexpected ${init.method || 'GET'} ${url}` })
  }
  return { fetch, calls }
}

describe('ensureUsers', () => {
  it('creates carol, then completes the account and sets her password', async () => {
    const kc = fakeKeycloak()
    const result = await ensureUsers({ fetch: kc.fetch, keycloakUrl: KC, log: () => {} })

    expect(result).toEqual([{ username: 'carol@example.test', outcome: 'created' }])
    const admin = kc.calls.filter(c => c.url.startsWith(`${KC}/admin/`))
    expect(admin.map(c => `${c.method} ${c.url.replace(KC, '')}`)).toEqual([
      'POST /admin/realms/players/users',
      'GET /admin/realms/players/users?username=carol%40example.test&exact=true',
      'PUT /admin/realms/players/users/u-carol',
      'PUT /admin/realms/players/users/u-carol/reset-password',
    ])
    for (const c of admin) expect(c.headers.Authorization).toBe('Bearer ADMIN')

    const created = admin[0].body
    expect(created).toMatchObject({ username: 'carol@example.test', email: 'carol@example.test', emailVerified: true, enabled: true })
    expect(created.credentials).toBeUndefined()

    // The realm adds its terms-and-conditions action to every new user and requires a
    // birth date: without this second PUT the login answers "Account is not fully set up".
    const completed = admin[2].body
    expect(completed.requiredActions).toEqual([])
    expect(completed.attributes.birthDate).toEqual(['1992-03-03'])
    expect(completed.attributes.pseudo).toEqual(['Carol'])
    expect(completed).toMatchObject({ username: 'carol@example.test', email: 'carol@example.test', emailVerified: true, enabled: true })

    expect(admin[3].body).toEqual({ type: 'password', value: 'TestPassword1234', temporary: false })
  })

  it('completes an existing carol instead of failing on the 409', async () => {
    const kc = fakeKeycloak({ create: 409 })
    const result = await ensureUsers({ fetch: kc.fetch, keycloakUrl: KC, log: () => {} })

    expect(result).toEqual([{ username: 'carol@example.test', outcome: 'updated' }])
    expect(kc.calls.filter(c => c.method === 'PUT')).toHaveLength(2)
  })

  it('throws when the admin login fails', async () => {
    const fetch = async () => json(401, {})
    await expect(ensureUsers({ fetch, keycloakUrl: KC, log: () => {} })).rejects.toThrow('admin login failed (401)')
  })

  it('throws on any other creation error', async () => {
    const kc = fakeKeycloak({ create: 500 })
    await expect(ensureUsers({ fetch: kc.fetch, keycloakUrl: KC, log: () => {} })).rejects.toThrow('user "carol@example.test" creation failed (500)')
  })

  it('ships carol only: alice and bob come with the realm', () => {
    expect(DEV_USERS.map(u => u.username)).toEqual(['carol@example.test'])
  })
})
