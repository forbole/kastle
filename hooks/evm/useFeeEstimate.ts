import useWalletManager from "@/hooks/useWalletManager";
import { toEvmAddress } from "@/lib/utils";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { http, createPublicClient, numberToHex } from "viem";
import useSWR from "swr";

type estimatePayload = {
  to: `0x${string}`;
  value?: bigint;
  data?: `0x${string}`;
};

const fetcher = (chainId: `0x${string}`, payload: estimatePayload) => {
  return async () => {
    const chain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
      (c) => numberToHex(c.id) === chainId,
    );
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const client = createPublicClient({
      chain,
      transport: http(),
    });

    const gasFees = await client.estimateFeesPerGas();
    const { maxPriorityFeePerGas } = gasFees;

    // Replace with actual fee estimation logic
    const gasEstimated = await client.estimateGas(payload);

    return maxPriorityFeePerGas * gasEstimated;
  };
};

export default function useFeeEstimate(
  chainId?: `0x${string}`,
  payload?: estimatePayload,
) {
  const { account } = useWalletManager();
  const publicKey = account?.publicKeys?.[0];
  const evmAddress = publicKey ? toEvmAddress(publicKey) : undefined;

  const isLoading = !evmAddress || !chainId || !payload;
  return useSWR(
    isLoading
      ? null
      : `feeEstimate:${chainId}-${evmAddress}-${JSON.stringify(payload)}`,
    isLoading ? null : fetcher(chainId, payload),
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}
