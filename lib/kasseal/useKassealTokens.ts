import useSWR from "swr";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import {
  fetchKassealToken,
  fetchKassealTokens,
  kassealBaseUrl,
  kassealNetworkOf,
} from "./api";

export default function useKassealTokens(search?: string) {
  const { networkId } = useRpcClientStateful();
  const network = kassealNetworkOf(networkId);
  const { data, error, isLoading } = useSWR(
    network ? ["kassealTokens", network, search ?? ""] : null,
    () => fetchKassealTokens(kassealBaseUrl(network!), { search }),
    { refreshInterval: 30_000 },
  );
  return { data, error, isLoading };
}

export function useKassealToken(covenantId?: string) {
  const { networkId } = useRpcClientStateful();
  const network = kassealNetworkOf(networkId);
  const { data, error, isLoading, mutate } = useSWR(
    network && covenantId ? ["kassealToken", network, covenantId] : null,
    () => fetchKassealToken(kassealBaseUrl(network!), covenantId!),
    { refreshInterval: 15_000 },
  );
  return { data, error, isLoading, mutate };
}
