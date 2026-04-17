// Backward-compatibility re-exports.
// Import directly from the source files for new code:
//   useErc20Prices / useErc20Price  → @/hooks/evm/useErc20Prices
//   useErc20Image                   → @/hooks/evm/useErc20Info
//   provider hooks                  → @/hooks/evm/provider/useZealousSwap
export {
  useZealousSwapTokensMetadata,
  useZealousSwapIgraTokensMetadata,
} from "@/hooks/evm/provider/useZealousSwap";
export type { Erc20PriceEntry } from "@/hooks/evm/useErc20Prices";
export { useErc20Prices, useErc20Price } from "@/hooks/evm/useErc20Prices";
export { useErc20Image } from "@/hooks/evm/useErc20Info";
