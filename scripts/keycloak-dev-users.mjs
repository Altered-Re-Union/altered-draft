// Creates (or completes) the extra test accounts the tournament acceptance page needs in
// the LOCAL Keycloak started by altered-dev-environment (realm `players`): alice and bob
// ship with the realm, carol does not. Idempotent; run by `make dev` / `make keycloak-users`.
// The realm is re-imported from scratch on every Keycloak restart, so re-run it after one.
//
// Two admin calls per user on purpose: the realm adds its default required action (terms
// and conditions) to every user it creates, and its user profile requires a birth date, so a
// freshly created user cannot log in ("Account is not fully set up") until a second PUT
// clears the actions. The password is (re)set in its own call so an existing user ends up
// with the expected one too.
//
// Never fails the caller: like the client registration, a Keycloak that isn't up just
// means "no Re:Union login locally" and gets a warning.
import { fileURLToPath } from 'node:url'

const KEYCLOAK_URL = process.env.KEYCLOAK_ADMIN_URL || 'http://auth.altered.local.gd:18080'
const REALM = 'players'

export const DEV_USERS = [
  {
    username: 'carol@example.test',
    email: 'carol@example.test',
    firstName: 'Carol',
    lastName: 'Test',
    // In this realm the username is the email; the pseudo is the displayed name.
    attributes: { pseudo: ['Carol'], locale: ['en'], birthDate: ['1992-03-03'] },
    password: 'TestPassword1234',
  },
]

async function adminToken(f, keycloakUrl) {
  const res = await f(`${keycloakUrl}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' }),
  })
  if (!res.ok) throw new Error(`admin login failed (${res.status})`)
  return (await res.json()).access_token
}

/** Creates or completes each user; returns `[{ username, outcome: 'created' | 'updated' }]`. */
export async function ensureUsers({ fetch: f = fetch, keycloakUrl = KEYCLOAK_URL, realm = REALM, users = DEV_USERS, log = console.log } = {}) {
  const token = await adminToken(f, keycloakUrl)
  const api = (path, init = {}) => f(`${keycloakUrl}/admin/realms/${realm}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })

  const results = []
  for (const { password, ...user } of users) {
    const representation = { ...user, emailVerified: true, enabled: true, requiredActions: [] }

    const created = await api('/users', { method: 'POST', body: JSON.stringify(representation) })
    if (!created.ok && created.status !== 409) {
      throw new Error(`user "${user.username}" creation failed (${created.status}): ${await created.text()}`)
    }

    const lookup = await api(`/users?username=${encodeURIComponent(user.username)}&exact=true`)
    if (!lookup.ok) throw new Error(`user "${user.username}" lookup failed (${lookup.status})`)
    const [existing] = await lookup.json()
    if (!existing) throw new Error(`user "${user.username}" not found after creation`)

    const completed = await api(`/users/${existing.id}`, { method: 'PUT', body: JSON.stringify(representation) })
    if (!completed.ok) throw new Error(`user "${user.username}" update failed (${completed.status}): ${await completed.text()}`)

    const reset = await api(`/users/${existing.id}/reset-password`, { method: 'PUT', body: JSON.stringify({ type: 'password', value: password, temporary: false }) })
    if (!reset.ok) throw new Error(`user "${user.username}" password reset failed (${reset.status}): ${await reset.text()}`)

    const outcome = created.ok ? 'created' : 'updated'
    log(`→ Keycloak user "${user.username}" ${outcome} in ${keycloakUrl}/realms/${realm} (password ${password})`)
    results.push({ username: user.username, outcome })
  }
  return results
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  ensureUsers().catch(err => {
    console.warn(`⚠ Keycloak dev users not created (${err.message}) — carol won't be able to log in locally.`)
    console.warn('  Start altered-auth via altered-dev-environment, then run: make keycloak-users')
  })
}
