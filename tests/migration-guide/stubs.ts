import { useEffect, useState } from "react";

// What the spec reads back. `?eligible=1` makes the migration hook expose URL.
export const URL_FROM_HOOK = "https://katbridge.com/migrate";

declare global {
  interface Window {
    __migrationGuide: {
      opened: string[];
      tabs: { url?: string }[];
      bridgeMounts: number;
      dashboardMounts: number;
    };
  }
}

window.__migrationGuide = {
  opened: [],
  tabs: [],
  bridgeMounts: 0,
  dashboardMounts: 0,
};

(globalThis as unknown as { chrome: unknown }).chrome = {
  tabs: {
    create: (props: { url?: string }) => {
      window.__migrationGuide.tabs.push(props);
      return Promise.resolve({});
    },
  },
};

const eligible = new URLSearchParams(location.search).get("eligible") === "1";

export function useAnalytics() {
  return {
    emitKcc20MigrationOpened: (source: string) =>
      window.__migrationGuide.opened.push(source),
  };
}

export function useRpcClientStateful() {
  return { networkId: "mainnet" };
}

export function useWalletManager() {
  return { account: { address: "kaspa:qtestaddress" } };
}

// Like the real hook, flags arrive in a mount effect: the first render is
// never enabled, even for an eligible wallet.
export function useKcc20Migration({
  address,
  isMainnet,
}: {
  address?: string;
  isMainnet: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(true), []);
  const enabled = loaded && eligible && isMainnet && !!address;
  return {
    enabled,
    config: { url: URL_FROM_HOOK, tokens: [] },
    migratableHeld: enabled ? [{ tick: "NACHO" }] : [],
  };
}
