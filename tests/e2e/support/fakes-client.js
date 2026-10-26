// Thin client for the fake process's /__control endpoints.
import { FAKES_URL } from './env.js'

async function call(method, path, body) {
  const res = await fetch(`${FAKES_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`fake ${method} ${path} → ${res.status}`)
  return res.status === 204 ? null : res.json()
}

export const fakesReset = () => call('POST', '/__control/reset')
export const fakesRevoke = user => call('POST', '/__control/revoke', { user })
export const fakesSession = async user => (await call('POST', '/__control/session', { user })).refresh_token
export const fakesDecks = user => call('GET', `/__control/decks?user=${encodeURIComponent(user)}`)
export const fakesRequests = () => call('GET', '/__control/requests')
export const fakesDrainUnmatched = () => call('POST', '/__control/unmatched/drain')
