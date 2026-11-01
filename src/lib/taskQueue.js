// A keyed task queue running at most `concurrency` tasks at once, FIFO, where waiting tasks
// can be moved to the front. Used to render unique faces a couple at a time instead of all
// at once: each render gets the CPU to itself, so the first faces land much sooner, and
// the one about to be revealed can jump the line.
export function createTaskQueue(concurrency = 2) {
  const waiting = [] // [{ key, run, resolve, reject }]
  const byKey = new Map() // key -> promise, while waiting or running
  let running = 0

  function pump() {
    while (running < concurrency && waiting.length) {
      const task = waiting.shift()
      running++
      Promise.resolve()
        .then(task.run)
        .then(task.resolve, task.reject)
        .finally(() => {
          running--
          byKey.delete(task.key)
          pump()
        })
    }
  }

  return {
    // Queues `run` under `key`; a key already waiting or running returns its pending promise.
    add(key, run, { front = false } = {}) {
      if (byKey.has(key)) {
        if (front) this.prioritize([key])
        return byKey.get(key)
      }
      const promise = new Promise((resolve, reject) => {
        const task = { key, run, resolve, reject }
        if (front) waiting.unshift(task)
        else waiting.push(task)
      })
      byKey.set(key, promise)
      pump()
      return promise
    },
    // Moves the waiting tasks among `keys` to the front, in the order given.
    prioritize(keys) {
      const moved = []
      for (const key of keys) {
        const i = waiting.findIndex(t => t.key === key)
        if (i >= 0) moved.push(waiting.splice(i, 1)[0])
      }
      waiting.unshift(...moved)
    },
    get size() { return waiting.length + running },
  }
}
