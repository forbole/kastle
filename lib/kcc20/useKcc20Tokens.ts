import { useContext } from "react";
import useSWR from "swr";
import { useSettings } from "@/hooks/useSettings.ts";
import { RpcClientContext } from "@/contexts/RpcClientContext.tsx";
import { restApis } from "@/components/screens/Settings";
import { fetchKcc20Tokens, KRON_HOSTS } from "@/lib/kcc20";

export default function useKcc20Tokens(address?: string) {
  const [settings] = useSettings();
  const { rpcClient } = useContext(RpcClientContext);
  const networkId = settings?.networkId;
  // Stored settings may carry a network KRON does not serve: no fetch.
  const hosts =
    networkId && networkId in KRON_HOSTS ? KRON_HOSTS[networkId] : undefined;
  const enabled = address && rpcClient && hosts;

  const { data, error, isLoading } = useSWR(
    // Network in the key so a switch never shows the other network's rows.
    enabled ? ["kcc20Tokens", networkId, address] : null,
    () =>
      fetchKcc20Tokens(address!, rpcClient!, restApis[networkId!], networkId!),
    { refreshInterval: 30_000 },
  );
  return { data, error, isLoading };
}
