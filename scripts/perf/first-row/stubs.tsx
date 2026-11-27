// tests/activity-money/stubs.tsx, plus: the wallet run.mjs was given
// (window.__wallet, so the hook reads the keys it seeded), a wxt storage seeded
// from window.__stored (what measure.mjs wrote after a real read), and the
// KCC-20 owner keys (the wasm is not loaded here).
export * from "../../../tests/activity-money/stubs";

const wallet = () =>
  (window as unknown as { __wallet: { kaspa: string; evm: string } }).__wallet;
export const useEvmAddress = () => wallet().evm;
export const useWalletManager = () => ({
  account: { address: wallet().kaspa },
});
const seeded = () =>
  (window as unknown as { __stored: Record<string, string> }).__stored;
export const storage = {
  getItem: async (k: string) => seeded()[k] ?? null,
  setItem: async () => {},
  removeItem: async () => {},
  watch: () => () => {},
};
export const standardOwnerKey = () => new Uint8Array(32);
export const ownerStrings = () => ["owner", "presence:owner", "p2pkh:owner"];
// components/screens/Settings is stubbed whole; the bridge mappers read this one.
export const explorerTxLinks = { mainnet: "https://explorer.kaspa.org/txs/" };
