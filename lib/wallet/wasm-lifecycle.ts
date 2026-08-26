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
 * Synchronous only: with an async `fn`, `fn` itself returns at the first
 * `await` — before any code past it has run. Every current caller is sync.
 * This is enforced at runtime below — an async/thenable `fn` throws instead
 * of silently freeing a live object.
 *
 * That guard only protects against freeing too early if it also skips
 * cleanup on the thenable path: a `finally` runs on every exit, including a
 * throw, so freeing there would still free objects the suspended callback's
 * continuation hasn't used yet — the exact use-after-free this exists to
 * catch, just paired with a thrown error instead of silent. Leaking on this
 * misuse path is the deliberate tradeoff: it can only leak on a code path
 * that's supposed to never execute (an async `fn`), never on the normal
 * synchronous one.
 */
function freeAll(owned: Freeable[]): void {
  // LIFO: last-registered (most likely derived from an earlier one) freed
  // first, matching Rust's own reverse-declaration drop order for the
  // objects this module wraps.
  for (let i = owned.length - 1; i >= 0; i--) {
    try {
      owned[i].free();
    } catch (error) {
      // A genuine double-free raises a wasm trap here. Don't let one failed
      // free block freeing the rest, but don't discard it either.
      console.error("withOwned: object.free() threw", error);
    }
  }
}

export function withOwned<T>(
  fn: (own: <O extends Freeable>(object: O) => O) => T,
): T {
  const owned: Freeable[] = [];
  let result: T;

  try {
    result = fn((object) => {
      owned.push(object);
      return object;
    });
  } catch (error) {
    freeAll(owned);
    throw error;
  }

  if (
    result !== null &&
    (typeof result === "object" || typeof result === "function") &&
    typeof (result as { then?: unknown }).then === "function"
  ) {
    // Do NOT free here — see the doc comment above.
    throw new Error(
      "withOwned() callback returned a thenable — withOwned is synchronous-only. " +
        "An async fn would free owned objects when the promise is *returned*, not " +
        "when it resolves: a silent use-after-free on a still-live object.",
    );
  }

  freeAll(owned);
  return result;
}
