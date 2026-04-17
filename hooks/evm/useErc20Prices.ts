import { Address, Hex, numberToHex } from "viem";
import { igraMainnet, kasplexMainnet } from "@/lib/layer2";
import {
  useZealousSwapIgraTokensMetadata,
  useZealousSwapTokensMetadata,
} from "@/hooks/evm/provider/useZealousSwap";

export type Erc20PriceEntry = {
  chainId: Hex;
  address: Address;
  price: number;
};

/** Unified price list across all supported EVM chains */
export function useErc20Prices() {
  const kasplex = useZealousSwapTokensMetadata();
  const igra = useZealousSwapIgraTokensMetadata();

  const isLoading = kasplex.isLoading || igra.isLoading;
  const error = kasplex.error ?? igra.error;

  const kasplexEntries: Erc20PriceEntry[] =
    kasplex.data?.tokens.map((t) => ({
      chainId: numberToHex(kasplexMainnet.id),
      address: t.address.toLowerCase() as Address,
      price: t.price ?? 0,
    })) ?? [];

  const igraEntries: Erc20PriceEntry[] =
    igra.data?.tokens.map((t) => ({
      chainId: numberToHex(igraMainnet.id),
      address: t.address.toLowerCase() as Address,
      price: t.price ?? 0,
    })) ?? [];

  return {
    data: [...kasplexEntries, ...igraEntries],
    error,
    isLoading,
  };
}

export function useErc20Price(chainId?: Hex, contractAddress?: Address) {
  const { data, error, isLoading } = useErc20Prices();

  if (!chainId || !contractAddress) {
    return { price: 0, error: undefined, isLoading: false };
  }

  const normalizedAddress = contractAddress.toLowerCase() as Address;
  const entry = data.find(
    (t) => t.chainId === chainId && t.address === normalizedAddress,
  );

  return {
    price: entry?.price ?? 0,
    error,
    isLoading,
  };
}
