import { useKns } from "@/hooks/kns/useKns";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { resolveRecipient } from "@/lib/names/resolveRecipient";

/** Send-form resolver bound to the current network; `.k` only when `dotk` is on. */
export function useResolveRecipient() {
  const { fetchDomainInfo } = useKns();
  const { networkId } = useRpcClientStateful();
  const { isDotkEnabled } = useFeatureFlags();

  return (input: string) =>
    resolveRecipient(input, {
      fetchDomainInfo,
      networkId: networkId ?? "mainnet",
      dotk: isDotkEnabled,
    });
}
