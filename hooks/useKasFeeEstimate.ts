import { useCallback } from "react";
import useSWR from "swr";
import { createTransactions, kaspaToSompi } from "@/wasm/core/kaspa";
import { calcRevealInputFee } from "@/lib/kaspaFee";
import useWalletManager from "@/hooks/wallet/useWalletManager";

const BASE_FEE = "0.004";

export interface KasFeeEstimateOptions {
  scriptsHexes?: string[];
  extraOutputCount?: number;
}

export function useKasFeeEstimateHelper(options: KasFeeEstimateOptions = {}) {
  const { scriptsHexes, extraOutputCount = 0 } = options;
  const { account } = useWalletManager();
  const { rpcClient, networkId, isConnected } = useRpcClientStateful();

  return useCallback(async (): Promise<number> => {
    if (!isConnected || !rpcClient || !networkId || !account?.address) return 0;

    const address = account.address;
    const { entries } = await rpcClient.getUtxosByAddresses([address]);
    if (!entries.length) return 0;

    const dummyOutputs = Array.from({ length: extraOutputCount }, () => ({
      address,
      amount: kaspaToSompi("1")!,
    }));

    let baseFee: bigint;
    try {
      const { transactions } = await createTransactions({
        entries,
        outputs: dummyOutputs,
        priorityFee: 0n,
        changeAddress: address,
        networkId,
      });
      baseFee = transactions[0].feeAmount;
    } catch {
      baseFee = kaspaToSompi(BASE_FEE) ?? 0n;
    }

    if (scriptsHexes?.length) {
      const scriptExtra = scriptsHexes.reduce(
        (sum, hex) => sum + calcRevealInputFee(hex),
        0n,
      );
      return Number(baseFee + scriptExtra);
    }

    return Number(baseFee);
  }, [
    account?.address,
    extraOutputCount,
    isConnected,
    networkId,
    rpcClient,
    scriptsHexes,
  ]);
}

export function useKasFeeEstimate(options: KasFeeEstimateOptions = {}) {
  const { scriptsHexes, extraOutputCount = 0 } = options;
  const estimate = useKasFeeEstimateHelper(options);
  const { account } = useWalletManager();
  const { isConnected, networkId } = useRpcClientStateful();

  const scriptsKey = scriptsHexes?.join(",") ?? "";
  const key =
    isConnected && account?.address
      ? [
          "kasFeeEstimate",
          account.address,
          networkId,
          scriptsKey,
          extraOutputCount,
        ]
      : null;

  const {
    data: fee,
    isLoading: loading,
    error,
    mutate: refetch,
  } = useSWR(key, estimate, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  return { fee, loading, error, refetch };
}
