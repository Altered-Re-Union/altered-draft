// Public runtime config for the browser: the Re:Union / Community service URLs this
// deployment targets (src/lib/endpoints.js). Served at runtime rather than baked into the
// bundle for the same reason as api/realtime-config.js: one static build is shared across
// environments, and only the server knows which services it talks to.
import { publicEndpoints } from '../src/lib/endpoints.js'

export default function handler(req, res) {
  // Fetched before the app renders: let Vercel's edge cache it so first paint doesn't
  // wait on a cold function. No browser cache, so a changed .env shows up on reload.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300')
  res.status(200).json(publicEndpoints())
}
