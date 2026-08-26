/**
 * Explicit lifetimes for secret-bearing wasm-bindgen objects (`PrivateKey`,
 * `Keypair`, `XPrv`, `Mnemonic`).
 *
 * These types DO register with a `FinalizationRegistry` (see
 * `wasm/core/kaspa.js`, e.g. `PrivateKeyFinalization` at :6948), so they are not
 * stranded forever. But the JS GC only ever sees the small wrapper object and
 * has no visibility into the much larger WASM-side allocation behind it, so it
 * feels no pressure to collect and can run arbitrarily late. Freeing at last use
 * makes reclamation deterministic and bounds WASM linear-memory growth.
 *
 * IMPORTANT — what this does NOT do: `free()` deallocates, it does not zero the
 * bytes. The secret stays readable in linear memory until the allocator happens
 * to reuse the region. Actually wiping key material requires `zeroize` /
 * `ZeroizeOnDrop` on the Rust side, upstream in `@kcoin/kaspa-web3.js`. Do not
 * describe callers of this module as wiping keys from memory.
 */

type Freeable = { free: () => void };

/**
 * Runs `fn` with an `own()` registrar and frees everything registered once `fn`
 * returns or throws.
 *
 * Register an object at the moment it is created — `own(new XPrv(seed))` — so
 * that an exception later in the scope still frees it. Do NOT register an object
 * the scope hands back to its caller; the caller owns that one.
 *
 * Synchronous only: with an async `fn` the `finally` would fire at the first
 * `await`, freeing objects still in use. Every current caller is sync. This is
 * enforced at runtime below — an async/thenable `fn` throws instead of
 * silently freeing a live object.
 */
export function withOwned<T>(
  fn: (own: <O extends Freeable>(object: O) => O) => T,
): T {
  const owned: Freeable[] = [];

  try {
    const result = fn((object) => {
      owned.push(object);
      return object;
    });

    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      throw new Error(
        "withOwned() callback returned a thenable — withOwned is synchronous-only. " +
          "An async fn would free owned objects when the promise is *returned*, not " +
          "when it resolves: a silent use-after-free on a still-live object.",
      );
    }

    return result;
  } finally {
    for (const object of owned) {
      // this runs in a `finally`: a throw here would mask the real error
      try {
        object.free();
      } catch (error) {
        // Don't discard this: a genuine double-free raises a wasm trap here,
        // and silently swallowing it hides real bugs. One failed free must
        // not block freeing the rest, so log and keep going.
        console.error("withOwned: object.free() threw", error);
      }
    }
  }
}
