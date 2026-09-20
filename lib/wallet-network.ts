import type { Settings } from "@/contexts/SettingsContext";
import { NetworkType } from "@/lib/network-type";

export const ZKAS_MAINNET = "zkas-mainnet" as const;
export const ZKAS_EXPERIMENTAL_KEY = "local:zkas-experimental-enabled";
export type WalletNetwork = NetworkType | typeof ZKAS_MAINNET;

export function isZKasActive(
  settings: Settings | null | undefined,
  experimentalEnabled: boolean | null,
): boolean {
  // A missing flag preserves the choice in wallets created before this gate existed.
  // Once the toggle is touched, its explicit value wins over stale settings writes.
  return (
    settings?.preview === true &&
    experimentalEnabled !== false &&
    settings.activeChain === "zkas" &&
    settings.networkId === NetworkType.Mainnet
  );
}

export function getSelectedWalletNetwork(
  settings: Settings,
  experimentalEnabled: boolean | null,
): WalletNetwork {
  return isZKasActive(settings, experimentalEnabled)
    ? ZKAS_MAINNET
    : settings.networkId;
}

export function getVisibleWalletNetworks(
  settings: Settings,
  experimentalEnabled: boolean | null,
): WalletNetwork[] {
  return settings.preview === true && experimentalEnabled !== false
    ? [NetworkType.Mainnet, NetworkType.TestnetT10, ZKAS_MAINNET]
    : [NetworkType.Mainnet, NetworkType.TestnetT10];
}

export function selectWalletNetwork(
  settings: Settings,
  network: WalletNetwork,
  experimentalEnabled: boolean | null,
): Settings {
  if (network === ZKAS_MAINNET) {
    if (settings.preview !== true || experimentalEnabled === false) {
      throw new Error("Enable Experimental features to use ZKas");
    }
    return { ...settings, networkId: NetworkType.Mainnet, activeChain: "zkas" };
  }
  return { ...settings, networkId: network, activeChain: "kaspa" };
}
