import { expect, test } from "@playwright/test";
import type { Settings } from "@/contexts/SettingsContext";
import { NetworkType } from "@/lib/network-type";
import {
  getSelectedWalletNetwork,
  getVisibleWalletNetworks,
  isZKasActive,
  selectWalletNetwork,
  ZKAS_MAINNET,
} from "@/lib/wallet-network";

const initialSettings = {
  networkId: NetworkType.Mainnet,
  preview: false,
  activeChain: "kaspa",
} as Settings;

test("ZKas is absent until Experimental features is enabled", () => {
  expect(getVisibleWalletNetworks(initialSettings, null)).toEqual([
    NetworkType.Mainnet,
    NetworkType.TestnetT10,
  ]);
  expect(() => selectWalletNetwork(initialSettings, ZKAS_MAINNET, null)).toThrow(/experimental/i);
  expect(getVisibleWalletNetworks({ ...initialSettings, preview: true }, null)).toContain(ZKAS_MAINNET);
});

test("network switching keeps Kaspa transport and ZKas selection distinct", () => {
  const testnet = selectWalletNetwork(initialSettings, NetworkType.TestnetT10, null);
  const zkas = selectWalletNetwork({ ...testnet, preview: true }, ZKAS_MAINNET, true);
  expect(zkas.networkId).toBe(NetworkType.Mainnet);
  expect(getSelectedWalletNetwork(zkas, true)).toBe(ZKAS_MAINNET);
  expect(isZKasActive(zkas, true)).toBe(true);

  const kaspa = selectWalletNetwork(zkas, NetworkType.Mainnet, true);
  expect(getSelectedWalletNetwork(kaspa, true)).toBe(NetworkType.Mainnet);
  expect(isZKasActive(kaspa, true)).toBe(false);
});

test("disabling Experimental features revokes the active ZKas selection", () => {
  const zkas = selectWalletNetwork({ ...initialSettings, preview: true }, ZKAS_MAINNET, true);
  const disabled = { ...zkas, preview: false };
  expect(isZKasActive(disabled, true)).toBe(false);
  expect(getSelectedWalletNetwork(disabled, true)).toBe(NetworkType.Mainnet);
  expect(isZKasActive({ ...zkas, networkId: NetworkType.TestnetT10 }, true)).toBe(false);
});

test("a stale settings write cannot reauthorize ZKas after the toggle is turned off", () => {
  const enabled = selectWalletNetwork({ ...initialSettings, preview: true }, ZKAS_MAINNET, true);
  const disabledFlag = false;
  // A second window may write an old whole-settings snapshot after the toggle is off.
  expect(isZKasActive(enabled, disabledFlag)).toBe(false);
  expect(getSelectedWalletNetwork(enabled, disabledFlag)).toBe(NetworkType.Mainnet);
  expect(getVisibleWalletNetworks(enabled, disabledFlag)).not.toContain(ZKAS_MAINNET);
  expect(() => selectWalletNetwork(enabled, ZKAS_MAINNET, disabledFlag)).toThrow(/experimental/i);
});
