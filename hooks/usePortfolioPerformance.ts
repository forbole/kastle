import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBalance from "./wallet/useKaspaBalance";
import {
  useKrc20TotalPriceInUsdLastDay,
  useKrc20TotalPriceInUsd,
} from "./kasplex/useKrc20Prices";
import { useEvmKasBalancesByAddress } from "./evm/useEvmKasBalance";
import { publicKeyToAddress } from "viem/utils";

export default function usePortfolioPerformance() {
  const { account } = useWalletManager();
  const kaspaPrice = useKaspaPrice();
  const balance = useKaspaBalance(account?.address) ?? 0;

  // Layer2 tokens
  const evmAddress = account?.evmPublicKey
    ? publicKeyToAddress(account.evmPublicKey)
    : undefined;

  const { data: evmKasBalances } = useEvmKasBalancesByAddress(evmAddress);
  // TODO: Add ERC20 tokens performance calculation if last day price data is available

  const kaspaBalance =
    balance +
    Object.values(evmKasBalances ?? {}).reduce(
      (acc, { balance }) => acc + parseFloat(balance),
      0,
    );
  const kaspaUsd = kaspaBalance * kaspaPrice.kaspaPrice;
  const kaspaLastDayUsd = kaspaBalance * kaspaPrice.lastDayKaspaPrice;

  const tokenList = useTokenListByAddress(account?.address, 5000);

  const { totalUsd: tokensUsd } = useKrc20TotalPriceInUsd(tokenList);
  const { totalUsd: tokensUsdLastDay } =
    useKrc20TotalPriceInUsdLastDay(tokenList);

  const totalBalance = tokensUsd + kaspaUsd;
  const totalLastDayBalance = tokensUsdLastDay + kaspaLastDayUsd;

  const performance = totalBalance - totalLastDayBalance;
  const performanceInPercent =
    totalBalance === 0
      ? "0.00"
      : ((performance / totalBalance) * 100).toFixed(2);

  return {
    performance,
    performanceInPercent,
  };
}
