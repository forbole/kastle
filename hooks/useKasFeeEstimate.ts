import { useCallback } from "react";
import useSWR from "swr";
import { createTransactions, kaspaToSompi } from "@/wasm/core/kaspa";
import { calcRevealInputFee } from "@/lib/kaspaFee";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { isShortfall, planTransfer, TransferShortfall } from "@/lib/sendFee";

const BASE_FEE = "0.004";

export interface KasFeeEstimateOptions {
  scriptsHexes?: string[];
  extraOutputCount?: number;
  // KAS send only: price this amount with the app's UTXO selection instead of
  // the 1 KAS probe, and report the batch fee and transaction count.
  amountSompi?: bigint;
  priorityFee?: bigint;
}

// Fetching 11,449 entries per keystroke is what this saves: the amount-aware
// estimate reruns on every amount, the entries are shared for 5 s.
export function useUtxoEntries(address: string | undefined) {
  const { rpcClient, networkId, isConnected } = useRpcClientStateful();
  const key =
    isConnected && rpcClient && address
      ? ["utxoEntries", address, networkId]
      : null;
  return useSWR(
    key,
    async () => (await rpcClient!.getUtxosByAddresses([address!])).entries,
    {
      dedupingInterval: 5_000,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}

export type KasSendFeeEstimate = {
  fee: number;
  paymentFee: number;
  // the payment leg priced without its priority fee: the multiplier's base
  paymentFeeBase: number;
  transactionCount: number;
  shortfall?: TransferShortfall["reason"];
};

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
  const {
    scriptsHexes,
    extraOutputCount = 0,
    amountSompi,
    priorityFee,
  } = options;
  // Present (even while undefined) only on the KAS send; every other caller
  // keeps the 1 KAS self-send probe and never fetches the entries here.
  const amountAware = "amountSompi" in options;
  const estimate = useKasFeeEstimateHelper(options);
  const { wallet, account } = useWalletManager();
  const { isConnected, networkId } = useRpcClientStateful();
  const send = useKasSendFeeEstimate({
    address: amountAware ? account?.address : undefined,
    amountSompi,
    priorityFee,
    allowSplit: wallet?.type !== "ledger",
  });

  const scriptsKey = scriptsHexes?.join(",") ?? "";
  const key =
    !amountAware && isConnected && account?.address
      ? [
          "kasFeeEstimate",
          account.address,
          networkId,
          scriptsKey,
          extraOutputCount,
        ]
      : null;

  const {
    data: probeFee,
    isLoading: probeLoading,
    error: probeError,
    mutate: refetch,
  } = useSWR(key, estimate, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  if (amountAware) {
    return {
      fee: send.estimate?.fee,
      paymentFee: send.estimate?.paymentFee,
      paymentFeeBase: send.estimate?.paymentFeeBase,
      transactionCount: send.estimate?.transactionCount,
      shortfall: send.estimate?.shortfall,
      loading: send.loading,
      error: send.error,
      refetch,
    };
  }
  return {
    fee: probeFee,
    paymentFee: probeFee,
    // the probe is built at priority fee 0
    paymentFeeBase: probeFee,
    transactionCount: undefined,
    shortfall: undefined,
    loading: probeLoading,
    error: probeError,
    refetch,
  };
}

/**
 * The fee of the KAS send itself: `planTransfer` over the cached entries, so
 * `fee` is the batch's summary.fees and `paymentFee` the payment leg's fee.
 * The other fee displays (KRC-20, KNS, KRC-721, commit-reveal, Bridge) never
 * pass `amountSompi`, so they keep the probe.
 */
function useKasSendFeeEstimate({
  address,
  amountSompi,
  priorityFee = 0n,
  allowSplit,
}: {
  address: string | undefined;
  amountSompi?: bigint;
  priorityFee?: bigint;
  allowSplit: boolean;
}) {
  const { networkId } = useRpcClientStateful();
  const { data: entries } = useUtxoEntries(address);

  const key =
    entries && address && networkId && amountSompi !== undefined
      ? [
          "kasSendFeeEstimate",
          address,
          networkId,
          amountSompi.toString(),
          priorityFee.toString(),
          entries.length,
          allowSplit,
        ]
      : null;

  const { data, isValidating, error } = useSWR(
    key,
    async (): Promise<KasSendFeeEstimate> => {
      const plan = await planTransfer({
        entries: entries!,
        amountSompi: amountSompi!,
        outputAddress: address!,
        changeAddress: address!,
        priorityFee,
        networkId: networkId!,
        allowSplit,
      });
      if (isShortfall(plan)) {
        return {
          fee: 0,
          paymentFee: 0,
          paymentFeeBase: 0,
          transactionCount: 0,
          shortfall: plan.reason,
        };
      }
      return {
        fee: Number(plan.fee),
        paymentFee: Number(plan.paymentFee),
        paymentFeeBase: Number(plan.paymentFeeBase),
        transactionCount: plan.transactionCount,
      };
    },
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  // keepPreviousData would hand an empty amount the last amount's fee.
  // isValidating, not isLoading: it is also true while kept data stands in
  // for the new amount's, which validation must not trust.
  return {
    estimate: key ? data : undefined,
    loading: isValidating,
    error: key ? error : undefined,
    entries,
  };
}
