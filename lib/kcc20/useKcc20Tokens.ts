import { useContext } from "react";
import useSWR from "swr";
import { useSettings } from "@/hooks/useSettings.ts";
import { useFeatureFlags } from "@/hooks/useFeatureFlags.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { RpcClientContext } from "@/contexts/RpcClientContext.tsx";
import { restApis } from "@/components/screens/Settings";
import { fetchKcc20Tokens } from "@/lib/kcc20";

export default function useKcc20Tokens(address?: string) {
  const [settings] = useSettings();
  const { rpcClient } = useContext(RpcClientContext);
  const { isKcc20StandardEnabled } = useFeatureFlags();
  const enabled =
    address && rpcClient && settings?.networkId === NetworkType.Mainnet;

  const { data, error, isLoading } = useSWR(
    enabled ? ["kcc20Tokens", address, isKcc20StandardEnabled] : null,
    () =>
      fetchKcc20Tokens(address!, rpcClient!, restApis[NetworkType.Mainnet], {
        standard: isKcc20StandardEnabled,
      }),
    { refreshInterval: 30_000 },
  );
  return { data, error, isLoading };
}
