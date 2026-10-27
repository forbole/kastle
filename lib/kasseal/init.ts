import type { KassealNetwork } from "@kassealhq/sdk";

/** The SDK's Kaspa instance and network are page-global; a second network needs a reload. */
export class KassealReloadRequired extends Error {
  constructor(
    readonly active: KassealNetwork,
    readonly requested: KassealNetwork,
  ) {
    super(
      `Kasseal is loaded for ${active}; reopen the wallet to use ${requested}`,
    );
    this.name = "KassealReloadRequired";
  }
}

let active: KassealNetwork | undefined;
let ready: Promise<void> | undefined;

/**
 * Loads the per-network web entry, which brings its own pinned rusty-kaspa
 * 2.1.0 WASM (Kastle's vendored 2.0.1 fails the SDK's version gate). Popup
 * only: MV3 service workers forbid the dynamic import of its artifact chunks.
 */
export function initKasseal(network: KassealNetwork): Promise<void> {
  if (active && active !== network) {
    return Promise.reject(new KassealReloadRequired(active, network));
  }
  if (!ready) {
    active = network;
    const entry =
      network === "mainnet"
        ? import("@kassealhq/sdk/web/mainnet")
        : import("@kassealhq/sdk/web/testnet-10");
    // Curve presets ship as split artifacts; load them all before any build.
    ready = entry.then((m) => m.initWeb({ preload: "all" }));
    // A failed load (offline, integrity) may be retried on the next call.
    ready.catch(() => {
      active = undefined;
      ready = undefined;
    });
  }
  return ready;
}
