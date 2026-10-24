// Runs an async task one at a time. A trigger while it runs doesn't start a second copy:
// it asks for ONE more run once the current one ends (any number of triggers meanwhile
// fold into that single extra run). Used by the pool deck sync (TournamentPoolView.jsx),
// where two overlapping saves of a brand-new deck would each create a deck on decks-api.
export function createSerialRunner(task) {
  let running = false
  let again = false
  const run = async () => {
    running = true
    try {
      await task()
    } catch {
      // the task reports its own errors; a failed run must not block the next ones
    } finally {
      running = false
      if (again) { again = false; run() }
    }
  }
  return () => {
    if (running) { again = true; return }
    run()
  }
}
