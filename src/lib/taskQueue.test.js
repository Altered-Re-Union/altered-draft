import { describe, it, expect } from 'vitest'
import { createTaskQueue } from './taskQueue.js'

// A task that only finishes when the test says so, recording when it started.
function deferredTask(log, key) {
  let finish
  const done = new Promise(r => { finish = r })
  return { run: () => { log.push(key); return done.then(() => key) }, finish }
}
const flush = () => new Promise(r => setTimeout(r, 0))

describe('createTaskQueue', () => {
  it('runs at most `concurrency` tasks at once, the rest in FIFO order', async () => {
    const log = []
    const q = createTaskQueue(2)
    const tasks = ['a', 'b', 'c', 'd'].map(k => deferredTask(log, k))
    const results = tasks.map((t, i) => q.add(['a', 'b', 'c', 'd'][i], t.run))
    await flush()
    expect(log).toEqual(['a', 'b'])
    tasks[1].finish()
    await flush()
    expect(log).toEqual(['a', 'b', 'c'])
    tasks[0].finish(); tasks[2].finish()
    await flush()
    tasks[3].finish()
    expect(await Promise.all(results)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('moves waiting tasks to the front, in the order given', async () => {
    const log = []
    const q = createTaskQueue(1)
    const keys = ['a', 'b', 'c', 'd']
    const tasks = keys.map(k => deferredTask(log, k))
    keys.forEach((k, i) => q.add(k, tasks[i].run))
    await flush()
    q.prioritize(['d', 'c'])
    for (const i of [0, 3, 2, 1]) { tasks[i].finish(); await flush() }
    expect(log).toEqual(['a', 'd', 'c', 'b'])
  })

  it('returns the pending promise for a key already queued, bumping it with `front`', async () => {
    const log = []
    const q = createTaskQueue(1)
    const a = deferredTask(log, 'a'), b = deferredTask(log, 'b'), c = deferredTask(log, 'c')
    q.add('a', a.run)
    q.add('b', b.run)
    const first = q.add('c', c.run)
    const again = q.add('c', () => 'never', { front: true })
    expect(again).toBe(first)
    a.finish(); await flush()
    expect(log).toEqual(['a', 'c'])
    c.finish(); b.finish()
    expect(await again).toBe('c')
  })

  it('keeps going after a task fails', async () => {
    const q = createTaskQueue(1)
    const failed = q.add('x', () => { throw new Error('boom') })
    const next = q.add('y', () => 'ok')
    await expect(failed).rejects.toThrow('boom')
    expect(await next).toBe('ok')
    expect(q.size).toBe(0)
  })
})
