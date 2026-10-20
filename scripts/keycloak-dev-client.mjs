// Registers the `altered-draft` OIDC client in the LOCAL Keycloak started by
// altered-dev-environment (realm `players`), via its admin REST API. Idempotent: creates
// the client, or resets it to the config below. Run by `make dev` / `make keycloak-client`.
//
// The local realm is seeded from AlteredAuth/dev/realm-export.json, which has no
// altered-draft client, and Keycloak re-imports it from scratch on every restart (H2 is
// ephemeral) — so re-run this after restarting the `altered-auth` resource.
//
// Never fails the caller: login is optional, so a Keycloak that isn't up just means
// "no Re:Union login locally" and gets a warning.
const KEYCLOAK_URL = process.env.KEYCLOAK_ADMIN_URL || 'http://auth.altered.local.gd:18080'
const REALM = 'players'
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5173'

const client = {
  clientId: process.env.KEYCLOAK_CLIENT_ID || 'altered-draft',
  name: 'Altered Draft (local dev)',
  enabled: true,
  protocol: 'openid-connect',
  publicClient: false,
  secret: process.env.KEYCLOAK_CLIENT_SECRET || 'dev-altered-draft-secret',
  standardFlowEnabled: true,
  // Lets you mint a token from the CLI for manual API testing (password grant, alice/bob).
  directAccessGrantsEnabled: true,
  redirectUris: [`${APP_ORIGIN}/*`],
  webOrigins: ['+'],
  attributes: {
    'pkce.code.challenge.method': 'S256',
    'post.logout.redirect.uris': '+',
  },
}

async function adminToken() {
  const res = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: 'admin', password: 'admin' }),
  })
  if (!res.ok) throw new Error(`admin login failed (${res.status})`)
  return (await res.json()).access_token
}

async function main() {
  const token = await adminToken()
  const api = (path, init = {}) => fetch(`${KEYCLOAK_URL}/admin/realms/${REALM}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  })

  const lookup = await api(`/clients?clientId=${encodeURIComponent(client.clientId)}`)
  if (!lookup.ok) throw new Error(`client lookup failed (${lookup.status})`)
  const [existing] = await lookup.json()

  const res = existing
    ? await api(`/clients/${existing.id}`, { method: 'PUT', body: JSON.stringify({ ...existing, ...client, attributes: { ...existing.attributes, ...client.attributes } }) })
    : await api('/clients', { method: 'POST', body: JSON.stringify(client) })
  if (!res.ok) throw new Error(`client ${existing ? 'update' : 'creation'} failed (${res.status}): ${await res.text()}`)

  console.log(`→ Keycloak client "${client.clientId}" ${existing ? 'updated' : 'created'} in ${KEYCLOAK_URL}/realms/${REALM}`)
}

main().catch(err => {
  console.warn(`⚠ Keycloak client not registered (${err.message}) — Re:Union login won't work locally.`)
  console.warn('  Start altered-auth via altered-dev-environment, then run: make keycloak-client')
})
