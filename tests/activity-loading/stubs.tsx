// The first-row harness stubs, plus a page-driven wallet, feed fetcher and
// storage (window.__harness, set by tests/activity-loading.spec.ts).
import { useSyncExternalStore } from "react";
export * from "../../scripts/perf/first-row/stubs";

type Harness = {
  kaspa: string;
  evm: string;
  /** hold: settles on release(); fail: throws; ok: answers `live`. */
  mode: "hold" | "fail" | "ok";
  live: unknown;
  calls: number;
  release?: () => void;
  stored: Record<string, string>;
  /** Storage keys whose read never settles. */
  slow: string[];
};
const h = () => (window as unknown as { __harness: Harness }).__harness;

const subscribe = (cb: () => void) => {
  addEventListener("harness-wallet", cb);
  return () => removeEventListener("harness-wallet", cb);
};
export const useWalletManager = () => ({
  account: { address: useSyncExternalStore(subscribe, () => h().kaspa) },
});
export const useEvmAddress = () =>
  useSyncExternalStore(subscribe, () => h().evm);

export async function fetchActivityFeed() {
  const s = h();
  s.calls++;
  if (s.mode === "hold") await new Promise<void>((r) => (s.release = r));
  if (h().mode === "fail") throw new Error("upstream down");
  return h().live;
}

export const storage = {
  getItem: (k: string) =>
    h().slow.includes(k)
      ? new Promise(() => {})
      : Promise.resolve(h().stored[k] ?? null),
  setItem: async () => {},
  removeItem: async () => {},
  watch: () => () => {},
};
