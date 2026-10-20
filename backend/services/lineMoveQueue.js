/**
 * Coalesce line moves into per-player re-prediction runs.
 *
 * One odds refresh can move dozens of lines across a game, and several games
 * refresh within the same minute, so names are collected for `delayMs` (30s)
 * and then handed to `run(names)` once; names added while a run is in
 * progress wait for the next run. Pure scheduling: the runner is injected
 * (batchPredictionCron supplies the real one), so this is unit-testable with
 * a fake clock.
 */
export function createLineMoveQueue({ run, delayMs = 30 * 1000, setTimer = setTimeout, clearTimer = clearTimeout, log = console } = {}) {
  const pending = new Set();
  let timer = null;
  let running = null;

  async function flush() {
    if (timer) { clearTimer(timer); timer = null; }
    if (running) return running;
    if (!pending.size) return null;
    const names = [...pending];
    pending.clear();
    running = Promise.resolve()
      .then(() => run(names))
      .catch(err => { log.error?.('[LineMove] run failed:', err.message); return null; })
      .finally(() => {
        running = null;
        // Moves that arrived mid-run get their own (debounced) run
        if (pending.size) schedule();
      });
    return running;
  }

  function schedule() {
    if (timer || running) return;
    timer = setTimer(() => { timer = null; flush(); }, delayMs);
    timer?.unref?.();
  }

  return {
    /** Queue players whose lines moved. */
    add(names) {
      for (const n of names || []) if (n) pending.add(n);
      if (pending.size) schedule();
    },
    /** Run now (tests, shutdown). Resolves with the run's result, or null when idle. */
    flush,
    get size() { return pending.size; },
    get running() { return running !== null; }
  };
}
