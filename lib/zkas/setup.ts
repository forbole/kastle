import type { Settings } from "@/contexts/SettingsContext";
import { selectWalletNetwork, ZKAS_MAINNET } from "@/lib/wallet-network";
import type { ZKasNetwork } from "./client";

export function requireZKasDaemonUrl(
  settings: Settings | null | undefined,
  network: ZKasNetwork = "mainnet",
): string {
  const url = settings?.zkasDaemonUrls?.[network]?.trim();
  if (!url) {
    throw new Error(
      "Add a ZKas wallet daemon before creating or importing a ZKas wallet",
    );
  }
  return url;
}

export function selectZKasNetworkWithDaemon(
  settings: Settings,
  experimentalEnabled: boolean | null,
  daemonUrl?: string,
): Settings {
  const current = daemonUrl
    ? {
        ...settings,
        zkasDaemonUrls: {
          ...settings.zkasDaemonUrls,
          mainnet: daemonUrl,
        },
      }
    : settings;
  requireZKasDaemonUrl(current, "mainnet");
  return selectWalletNetwork(current, ZKAS_MAINNET, experimentalEnabled);
}
