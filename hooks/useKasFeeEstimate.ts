import useSWR from "swr";
import { createTransactions, kaspaToSompi } from "@/wasm/core/kaspa";
import { calcRevealInputFee } from "@/lib/kaspaFee";
import useWalletManager from "@/hooks/wallet/useWalletManager";

const BASE_FEE = "0.004";

export interface KasFeeEstimateOptions {
  scriptsHexes?: string[];
}

export function useKasFeeEstimateHelper() {
  const { account } = useWalletManager();
  const { rpcClient, networkId, isConnected } = useRpcClientStateful();

  const estimate = async (opts?: KasFeeEstimateOptions): Promise<number> => {
    if (!isConnected || !rpcClient || !networkId || !account?.address) return 0;

    const address = account.address;
    const { entries } = await rpcClient.getUtxosByAddresses([address]);
    if (!entries.length) return 0;

    let baseFee: bigint;
    try {
      const { transactions } = await createTransactions({
        entries,
        outputs: [{ address, amount: kaspaToSompi("0.2")! }],
        priorityFee: 0n,
        changeAddress: address,
        networkId,
      });
      baseFee = transactions[0].feeAmount;
    } catch {
      baseFee = kaspaToSompi(BASE_FEE) ?? 0n;
    }

    if (opts?.scriptsHexes?.length) {
      const scriptExtra = opts.scriptsHexes.reduce(
        (sum, hex) => sum + calcRevealInputFee(hex),
        0n,
      );
      return Number(baseFee + scriptExtra);
    }

    return Number(baseFee);
  };

  return { estimate };
}

export function useKasFeeEstimate(opts?: KasFeeEstimateOptions) {
  const { estimate } = useKasFeeEstimateHelper();
  const { account } = useWalletManager();
  const { isConnected, networkId } = useRpcClientStateful();

  const scriptsKey = opts?.scriptsHexes?.join(",") ?? "";
  const key =
    isConnected && account?.address
      ? ["kasFeeEstimate", account.address, networkId, scriptsKey]
      : null;

  const {
    data: fee,
    isLoading: loading,
    error,
    mutate: refetch,
  } = useSWR(key, () => estimate(opts), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  return { fee, loading, error, refetch };
}
