// tests/activity-money/stubs.tsx, plus: W1's EVM address, a wxt storage seeded
// from window.__stored (what measure.mjs wrote after a real W1 read), and the
// KCC-20 owner keys (the wasm is not loaded here).
export * from "../../../tests/activity-money/stubs";

export const useEvmAddress = () => "0x178F82eD0c5a5B924CD72529d0267Be5b452C337";
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
