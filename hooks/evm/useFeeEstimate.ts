import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { http, createPublicClient, numberToHex } from "viem";
import useSWR from "swr";
import useEvmAddress from "./useEvmAddress";

type estimatePayload = {
  account: `0x${string}`;
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
    const { maxFeePerGas } = gasFees;

    // Replace with actual fee estimation logic
    const gasEstimated = await client.estimateGas(payload);

    return maxFeePerGas * gasEstimated;
  };
};

export default function useFeeEstimate(
  chainId?: `0x${string}`,
  payload?: estimatePayload,
) {
  const evmAddress = useEvmAddress();

  const isLoading = !evmAddress || !chainId || !payload;
  return useSWR(
    isLoading
      ? null
      : `feeEstimate:${chainId}-${evmAddress}-${payload.to}-${payload.value ?? ""}-${payload.data ?? ""}`,
    isLoading ? null : fetcher(chainId, payload),
    {
      refreshInterval: 10000, // Refresh every 10 seconds
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );
}
