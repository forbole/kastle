import { useContext } from "react";
import useSWR from "swr";
import { useSettings } from "@/hooks/useSettings.ts";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { RpcClientContext } from "@/contexts/RpcClientContext.tsx";
import { restApis } from "@/components/screens/Settings";
import { fetchKcc20Tokens } from "@/lib/kcc20";

export default function useKcc20Tokens(address?: string) {
  const [settings] = useSettings();
  const { rpcClient } = useContext(RpcClientContext);
  const enabled =
    address && rpcClient && settings?.networkId === NetworkType.Mainnet;

  const { data, error, isLoading } = useSWR(
    enabled ? ["kcc20Tokens", address] : null,
    () => fetchKcc20Tokens(address!, rpcClient!, restApis[NetworkType.Mainnet]),
    { refreshInterval: 30_000 },
  );
  return { data, error, isLoading };
}
