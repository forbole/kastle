import type { Settings } from "@/contexts/SettingsContext";
import { selectWalletNetwork, ZKAS_MAINNET } from "@/lib/wallet-network";
import type { ZKasNetwork } from "./client";
import { effectiveZKasDaemonOrigin } from "./history-config";

export function requireZKasDaemonUrl(
  settings: Settings | null | undefined,
  network: ZKasNetwork = "mainnet",
): string {
  if (!settings?.zkasDaemonUrls?.[network]) {
    throw new Error(
      "Add a ZKas wallet daemon before creating or importing a ZKas wallet",
    );
  }
  return effectiveZKasDaemonOrigin(settings, network);
}

export function hasConfiguredZKasDaemon(
  settings: Settings | null | undefined,
  network: ZKasNetwork = "mainnet",
): boolean {
  try {
    requireZKasDaemonUrl(settings, network);
    return true;
  } catch {
    return false;
  }
}

export function selectZKasNetworkWithDaemon(
  settings: Settings,
  experimentalEnabled: boolean | null,
  daemonUrl?: string,
  expectedCurrentDaemon?: string | null,
): Settings {
  if (
    expectedCurrentDaemon !== undefined &&
    (settings.zkasDaemonUrls?.mainnet ?? null) !== expectedCurrentDaemon
  ) {
    throw new Error("ZKas daemon changed in another window. Review and retry.");
  }
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
