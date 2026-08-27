/**
 * Ensures only one invocation of a tracked async function is "in flight" at
 * a time, and lets other callbacks (e.g. a UI toggle) be wrapped so they
 * become no-ops while that call is running.
 *
 * Motivating case: a hardware Ledger device can only service one APDU
 * exchange at a time. If a UI action can trigger a second, overlapping call
 * against the same transport while a first call is still awaiting device
 * responses (e.g. toggling "Legacy" mid-load on the Ledger Manage Accounts
 * screen), both calls collide and fail. Guarding the triggering UI action
 * while the tracked call is in flight prevents the second call from ever
 * starting, which is simpler and more verifiable than cancelling the first.
 */
export type SingleFlightGuard = {
  /** Whether a `track`-wrapped call is currently in flight. */
  isRunning: () => boolean;
  /**
   * Wrap an async function so `isRunning()` is true for the duration of
   * each call (including while awaiting), and false again once it settles
   * (success or failure).
   */
  track: <Args extends unknown[], R>(
    fn: (...args: Args) => Promise<R>,
  ) => (...args: Args) => Promise<R>;
  /**
   * Wrap a callback so it does nothing while a tracked call is running.
   */
  guard: <Args extends unknown[]>(
    fn: (...args: Args) => void,
  ) => (...args: Args) => void;
};

/**
 * Create a new guard. `onChange`, if provided, is invoked whenever the
 * running state flips (useful for mirroring the flag into React state so a
 * UI can re-render, e.g. to visually disable a control).
 */
export function createSingleFlightGuard(
  onChange?: (running: boolean) => void,
): SingleFlightGuard {
  let running = false;

  const setRunning = (value: boolean) => {
    if (running === value) return;
    running = value;
    onChange?.(running);
  };

  return {
    isRunning: () => running,

    track:
      <Args extends unknown[], R>(fn: (...args: Args) => Promise<R>) =>
      async (...args: Args) => {
        setRunning(true);
        try {
          return await fn(...args);
        } finally {
          setRunning(false);
        }
      },

    guard:
      <Args extends unknown[]>(fn: (...args: Args) => void) =>
      (...args: Args) => {
        if (running) return;
        fn(...args);
      },
  };
}
