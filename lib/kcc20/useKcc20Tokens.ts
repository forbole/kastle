import { useContext } from "react";
import useSWR from "swr";
import { useSettings } from "@/hooks/useSettings.ts";
import { useFeatureFlags } from "@/hooks/useFeatureFlags.ts";
import { RpcClientContext } from "@/contexts/RpcClientContext.tsx";
import { restApis } from "@/components/screens/Settings";
import { fetchKcc20Tokens, KRON_HOSTS } from "@/lib/kcc20";

export default function useKcc20Tokens(address?: string) {
  const [settings] = useSettings();
  const { rpcClient } = useContext(RpcClientContext);
  const { isKcc20StandardEnabled } = useFeatureFlags();
  const network = settings?.networkId;
  // Stored settings may carry a network KRON does not serve: no fetch.
  const enabled = address && rpcClient && network && network in KRON_HOSTS;

  const { data, error, isLoading } = useSWR(
    // Network in the key so a switch never shows the other network's rows.
    enabled ? ["kcc20Tokens", network, address, isKcc20StandardEnabled] : null,
    () =>
      fetchKcc20Tokens(address!, rpcClient!, restApis[network!], {
        standard: isKcc20StandardEnabled,
        network,
      }),
    { refreshInterval: 30_000 },
  );
  return {
    data: data?.tokens,
    // Flag on: legacy rows failed to load, so `data` holds standard rows only.
    legacyUnavailable: data?.legacyUnavailable ?? false,
    error,
    isLoading,
  };
}
