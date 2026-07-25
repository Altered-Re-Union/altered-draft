// Node/Express server for the AlteredOps-hosted deployment (Docker on Re:Union's
// infra — see ROADMAP.md "Set 6 preview"). Serves the built Vite frontend (dist/) and
// routes /api/* to the SAME handler modules used on Vercel — every api/*.js file
// exports a Vercel-style `(req, res) => ...` handler, which Express's `(req, res)`
// signature is directly compatible with (same res.status().json() fluent API, and
// express.json() populates req.body the same way Vercel does). No handler code needed
// changing to move from Vercel serverless to this container.
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tokenHandler from '../api/token.js'
import decksIndexHandler from '../api/decks/index.js'
import decksItemHandler from '../api/decks/[id].js'
import tournamentNormalPoolHandler from '../api/tournament-normal-pool.js'
import tournamentPrepPoolHandler from '../api/tournament-prep-pool.js'
import tournamentBoundPoolsHandler from '../api/tournament-bound-pools.js'
import tournamentPoolHandler from '../api/tournament-pool.js'
import tournamentBgaDecklistHandler from '../api/tournament-bga-decklist.js'
import tournamentPoolCountsHandler from '../api/tournament-pool-counts.js'
import tournamentPoolByDeckHandler from '../api/tournament-pool-by-deck.js'
import roomsIndexHandler from '../api/rooms/index.js'
import roomsItemHandler from '../api/rooms/[id].js'
import realtimeConfigHandler from '../api/realtime-config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '../dist')

const app = express()
app.use(express.json())

// A handler throwing (e.g. an unreachable DB) must 500 that one request, not crash
// the whole process or hang the response — Express 4 doesn't auto-catch async errors.
function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      console.error(err)
      if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: err.message })
    }
  }
}

// Vercel puts a dynamic route segment straight into req.query; Express keeps it in
// req.params instead — bridge it so the handler (written for Vercel) sees it the same
// way. Express 5's req.query is a live getter that recomputes from req.url on every
// access, NOT a stored property — Object.assign(req.query, {...}) mutates a throwaway
// object and is silently lost on the handler's next read. Overriding the property
// itself (Object.defineProperty) is what actually sticks.
function routeWithParam(handler, param) {
  return route((req, res) => {
    Object.defineProperty(req, 'query', { value: { ...req.query, [param]: req.params[param] }, writable: true, configurable: true })
    return handler(req, res)
  })
}

app.all('/api/token', route(tokenHandler))
app.all('/api/decks', route(decksIndexHandler))
app.all('/api/decks/:id', routeWithParam(decksItemHandler, 'id'))
app.all('/api/tournament-normal-pool', route(tournamentNormalPoolHandler))
app.all('/api/tournament-prep-pool', route(tournamentPrepPoolHandler))
app.all('/api/tournament-bound-pools', route(tournamentBoundPoolsHandler))
app.all('/api/tournament-pool', route(tournamentPoolHandler))
app.all('/api/tournament-bga-decklist', route(tournamentBgaDecklistHandler))
app.all('/api/tournament-pool-counts', route(tournamentPoolCountsHandler))
app.all('/api/tournament-pool-by-deck', route(tournamentPoolByDeckHandler))
app.all('/api/rooms', route(roomsIndexHandler))
app.all('/api/rooms/:id', routeWithParam(roomsItemHandler, 'id'))
app.all('/api/realtime-config', route(realtimeConfigHandler))

app.use(express.static(distDir))
// SPA fallback for every non-API route (mirrors vercel.json's rewrite).
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')))

const port = process.env.PORT || 8080
app.listen(port, () => console.log(`altered-draft listening on :${port}`))
