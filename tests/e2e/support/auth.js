// Logging in. loginAs = fast path (a refresh token minted by the fake, injected as the two
// cookies api/token.js sets; the app's own refresh then runs through /api/token on load).
// loginViaUi = the real redirect round trip, for the steps that assert it. tokenFor = a
// password-grant access token for API calls.
import { CLIENT_ID, CLIENT_SECRET, KEYCLOAK_ISSUER } from './env.js'
import { fakesSession } from './fakes-client.js'
import { t } from './i18n.js'
import { PASSWORD, PERSONAS } from './personas.js'

export async function loginAs(context, who) {
  const rt = await fakesSession(who)
  await context.addCookies([
    { name: 'reunion_rt', value: encodeURIComponent(rt), domain: 'localhost', path: '/api/token', httpOnly: true, secure: true, sameSite: 'Strict' },
    { name: 'reunion_auth', value: '1', domain: 'localhost', path: '/', secure: true, sameSite: 'Strict' },
  ])
}

export async function loginViaUi(page, who, { from }) {
  const origin = new URL(page.url()).origin
  await page.getByRole('button', { name: t('reunion.connect') }).first().click()
  await page.waitForURL(url => url.href.startsWith(`${KEYCLOAK_ISSUER}/protocol/openid-connect/auth`))
  await page.getByRole('link', { name: who, exact: true }).click()
  await page.waitForURL(`${origin}${from}`)
}

export async function tokenFor(who) {
  const res = await fetch(`${KEYCLOAK_ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, username: PERSONAS[who].username, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`password grant for ${who} → ${res.status}`)
  return (await res.json()).access_token
}
