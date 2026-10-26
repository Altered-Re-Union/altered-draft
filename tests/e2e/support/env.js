// Single source of the e2e stack's ports and URLs, shared by the Playwright config, the
// global setup and the helpers. The app's env is set from APP_ENV, never read from .env.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERSONAS } from './personas.js'

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
export const COMPOSE_FILE = path.join(ROOT_DIR, 'docker-compose.e2e.yml')

export const APP_PORT = 8090
export const FAKES_PORT = 8091
export const DB_PORT = 55433

export const APP_URL = `http://localhost:${APP_PORT}`
export const FAKES_URL = `http://localhost:${FAKES_PORT}`
export const KEYCLOAK_ISSUER = `${FAKES_URL}/realms/players`
export const CLIENT_ID = 'altered-draft'
export const CLIENT_SECRET = 'e2e-altered-draft-secret'
export const DATABASE_URL = `postgres://altered_draft_e2e:altered_draft_e2e@localhost:${DB_PORT}/altered_draft_e2e`

export const APP_ENV = {
  PORT: String(APP_PORT),
  DATABASE_URL,
  DATABASE_SSL: 'false',
  KEYCLOAK_ISSUER,
  KEYCLOAK_CLIENT_ID: CLIENT_ID,
  KEYCLOAK_CLIENT_SECRET: CLIENT_SECRET,
  DECKS_API_URL: `${FAKES_URL}/decks`,
  CARDS_API_URL: `${FAKES_URL}/cards`,
  CDN_URL: `${FAKES_URL}/cdn`,
  CARD_DB_URL: `${FAKES_URL}/carddb`,
  DECKBUILDER_URL: `${FAKES_URL}/deckbuilder`,
  REUNION_URL: `${FAKES_URL}/reunion`,
  TOURNAMENT_MODERATORS: PERSONAS.bob.sub,
}
