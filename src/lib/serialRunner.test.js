import { describe, it, expect } from 'vitest'
import { createSerialRunner } from './serialRunner.js'

const tick = () => new Promise(r => setTimeout(r, 0))

describe('createSerialRunner', () => {
  it('never runs the task twice at once, and folds the requests made meanwhile into one more run', async () => {
    let running = 0, maxRunning = 0, runs = 0
    let release
    const task = async () => {
      running++; maxRunning = Math.max(maxRunning, running); runs++
      await new Promise(r => { release = r })
      running--
    }
    const trigger = createSerialRunner(task)
    trigger(); trigger(); trigger() // 1 run + 2 requests while it runs
    await tick()
    expect(runs).toBe(1)
    release(); await tick(); await tick()
    expect(runs).toBe(2) // the two pending requests became ONE more run
    release(); await tick(); await tick()
    expect(runs).toBe(2)
    expect(maxRunning).toBe(1)
  })

  it('keeps working after a failing run', async () => {
    let runs = 0
    const trigger = createSerialRunner(async () => { runs++; if (runs === 1) throw new Error('boom') })
    trigger(); await tick(); await tick()
    trigger(); await tick(); await tick()
    expect(runs).toBe(2)
  })
})
