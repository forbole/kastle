import type { Settings } from "@/contexts/SettingsContext";
import { selectWalletNetwork, ZKAS_MAINNET } from "@/lib/wallet-network";
import type { ZKasNetwork } from "./client";
import {
  canonicalHistoryDaemonOrigin,
  canonicalHistoryIndexOrigin,
  effectiveZKasDaemonOrigin,
} from "./history-config";

export type ZKasConnectionSources = {
  daemonUrl: string;
  indexUrl: string;
  expectedDaemon: string | null;
  expectedIndex: string | null;
};

export function selectZKasNetworkWithSources(
  settings: Settings,
  experimentalEnabled: boolean | null,
  sources: ZKasConnectionSources,
): Settings {
  if (
    (settings.zkasDaemonUrls?.mainnet ?? null) !== sources.expectedDaemon ||
    (settings.zkasHistoryIndexUrls?.mainnet ?? null) !== sources.expectedIndex
  )
    throw new Error(
      "ZKas sources changed in another window. Review and retry.",
    );
  const daemonUrl = canonicalHistoryDaemonOrigin(sources.daemonUrl);
  const indexUrl = canonicalHistoryIndexOrigin(sources.indexUrl);
  return selectWalletNetwork(
    {
      ...settings,
      zkasDaemonUrls: { ...settings.zkasDaemonUrls, mainnet: daemonUrl },
      zkasHistoryIndexUrls: {
        ...settings.zkasHistoryIndexUrls,
        mainnet: indexUrl,
      },
    },
    ZKAS_MAINNET,
    experimentalEnabled,
  );
}

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
