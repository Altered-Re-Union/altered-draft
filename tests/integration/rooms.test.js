// Integration tests for api/rooms/*.js against a REAL Postgres (docker-compose.test.yml,
// started by globalSetup.js). These exercise the exact SQL — including the
// optimistic-concurrency compare-and-swap `Draft.jsx`'s doPick relies on — that unit tests
// mocking the DB would only be able to assert by re-stating the SQL string, not proving it
// actually behaves correctly against a real server.
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { query, getPool } from '../../src/lib/db.js'
import insertRoomHandler from '../../api/rooms/index.js'
import roomItemHandler from '../../api/rooms/[id].js'

function mockRes() {
  const res = {
    statusCode: null,
    body: undefined,
    headers: {},
    status(code) { res.statusCode = code; return res },
    json(payload) { res.body = payload; return res },
    setHeader(name, value) { res.headers[name] = value; return res },
  }
  return res
}

async function call(handler, { method = 'GET', body, query: q = {} } = {}) {
  const req = { method, body, query: q }
  const res = mockRes()
  await handler(req, res)
  return res
}

beforeEach(async () => {
  await query('TRUNCATE draft_rooms')
})

afterAll(async () => {
  await getPool().end()
})

describe('POST /api/rooms (insertRoomHandler)', () => {
  it('creates a room and it becomes readable', async () => {
    const res = await call(insertRoomHandler, { method: 'POST', body: { id: 'ROOM1', state: { version: 0, phase: 'lobby' } } })
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual({ id: 'ROOM1' })

    const { rows } = await query('SELECT state FROM draft_rooms WHERE id = $1', ['ROOM1'])
    expect(rows[0].state).toEqual({ version: 0, phase: 'lobby' })
  })

  it('rejects a duplicate room code with 409', async () => {
    await call(insertRoomHandler, { method: 'POST', body: { id: 'DUP1', state: { version: 0 } } })
    const res = await call(insertRoomHandler, { method: 'POST', body: { id: 'DUP1', state: { version: 0 } } })
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'room_already_exists' })
  })

  it('rejects a request missing id or state with 400', async () => {
    const missingState = await call(insertRoomHandler, { method: 'POST', body: { id: 'ROOM2' } })
    expect(missingState.statusCode).toBe(400)

    const missingId = await call(insertRoomHandler, { method: 'POST', body: { state: { version: 0 } } })
    expect(missingId.statusCode).toBe(400)
  })

  it('rejects non-POST methods with 405', async () => {
    const res = await call(insertRoomHandler, { method: 'GET' })
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('POST')
  })
})

describe('GET /api/rooms/:id (roomItemHandler)', () => {
  it('returns 404 for a room that does not exist', async () => {
    const res = await call(roomItemHandler, { method: 'GET', query: { id: 'NOPE' } })
    expect(res.statusCode).toBe(404)
  })

  it('returns the stored state for an existing room', async () => {
    await call(insertRoomHandler, { method: 'POST', body: { id: 'GETME', state: { version: 0, players: ['a'] } } })
    const res = await call(roomItemHandler, { method: 'GET', query: { id: 'GETME' } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ state: { version: 0, players: ['a'] } })
  })
})

describe('PATCH /api/rooms/:id — unconditional update', () => {
  it('overwrites the state regardless of its current version', async () => {
    await call(insertRoomHandler, { method: 'POST', body: { id: 'PATCH1', state: { version: 5, phase: 'lobby' } } })
    const res = await call(roomItemHandler, { method: 'PATCH', query: { id: 'PATCH1' }, body: { state: { version: 0, phase: 'drafting' } } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ updated: true })

    const { rows } = await query('SELECT state FROM draft_rooms WHERE id = $1', ['PATCH1'])
    expect(rows[0].state).toEqual({ version: 0, phase: 'drafting' })
  })

  it('rejects a PATCH with no state in the body', async () => {
    await call(insertRoomHandler, { method: 'POST', body: { id: 'PATCH2', state: { version: 0 } } })
    const res = await call(roomItemHandler, { method: 'PATCH', query: { id: 'PATCH2' }, body: {} })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /api/rooms/:id — optimistic-concurrency compare-and-swap', () => {
  it('commits the write when expectedVersion matches the row\'s current version', async () => {
    await call(insertRoomHandler, { method: 'POST', body: { id: 'CAS1', state: { version: 3, picks: [] } } })
    const res = await call(roomItemHandler, {
      method: 'PATCH', query: { id: 'CAS1' },
      body: { state: { version: 4, picks: ['card1'] }, expectedVersion: 3 },
    })
    expect(res.body).toEqual({ updated: true })

    const { rows } = await query('SELECT state FROM draft_rooms WHERE id = $1', ['CAS1'])
    expect(rows[0].state).toEqual({ version: 4, picks: ['card1'] })
  })

  it('rejects the write (no-op) when expectedVersion is stale — the core anti-clobber guarantee', async () => {
    await call(insertRoomHandler, { method: 'POST', body: { id: 'CAS2', state: { version: 3, picks: ['already-here'] } } })

    // Simulates two players racing: this write still claims to be against version 3,
    // but the row has since moved on (e.g. another player's pick already landed).
    await query("UPDATE draft_rooms SET state = state || '{\"version\": 4}'::jsonb WHERE id = $1", ['CAS2'])

    const res = await call(roomItemHandler, {
      method: 'PATCH', query: { id: 'CAS2' },
      body: { state: { version: 4, picks: ['already-here', 'clobbering-pick'] }, expectedVersion: 3 },
    })
    expect(res.body).toEqual({ updated: false })

    // The row must be untouched by the rejected write.
    const { rows } = await query('SELECT state FROM draft_rooms WHERE id = $1', ['CAS2'])
    expect(rows[0].state.picks).toEqual(['already-here'])
    expect(rows[0].state.version).toBe(4)
  })

  it('two concurrent conditional writes against the same expectedVersion: exactly one wins', async () => {
    await call(insertRoomHandler, { method: 'POST', body: { id: 'RACE1', state: { version: 0, picks: [] } } })

    const [resA, resB] = await Promise.all([
      call(roomItemHandler, { method: 'PATCH', query: { id: 'RACE1' }, body: { state: { version: 1, picks: ['fromA'] }, expectedVersion: 0 } }),
      call(roomItemHandler, { method: 'PATCH', query: { id: 'RACE1' }, body: { state: { version: 1, picks: ['fromB'] }, expectedVersion: 0 } }),
    ])

    const winners = [resA, resB].filter(r => r.body.updated)
    expect(winners).toHaveLength(1) // exactly one of the two racing writes commits

    const { rows } = await query('SELECT state FROM draft_rooms WHERE id = $1', ['RACE1'])
    expect(['fromA', 'fromB']).toContain(rows[0].state.picks[0])
  })
})
