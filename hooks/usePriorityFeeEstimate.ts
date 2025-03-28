import { IGetFeeEstimateResponse } from "@/wasm/core/kaspa";
import { useEffect } from "react";

export default function usePriorityFeeEstimate(
  amount: bigint,
  address?: string,
) {
  const { rpcClient } = useRpcClientStateful();
  const [feeEstimate, setFeeEstimate] = useState<IGetFeeEstimateResponse>();

  useEffect(() => {
    const fetchFeeEstimate = async () => {
      if (!rpcClient) return;

      const estimate = await rpcClient.getFeeEstimate({});
      setFeeEstimate(estimate);
    };

    fetchFeeEstimate();
  }, [address, amount]);

  return feeEstimate;
}
