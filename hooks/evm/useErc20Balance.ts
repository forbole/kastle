import useSWR from "swr";
import { createPublicClient, http } from "viem";

export default function useERC20Balance(
  address: string,
  chainId: number,
): {
  balance: string;
  isLoading: boolean;
} {
  return { balance, isLoading };
}
