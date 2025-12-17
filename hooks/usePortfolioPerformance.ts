import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBalance from "./wallet/useKaspaBalance";
import {
  useKrc20TotalPriceInUsdLastDay,
  useKrc20TotalPriceInUsd,
} from "./kasplex/useKrc20Prices";

export default function usePortfolioPerformance() {
  const { account } = useWalletManager();
  const kaspaPrice = useKaspaPrice();
  const balance = useKaspaBalance(account?.address) ?? 0;
  const kaspaUsd = balance * kaspaPrice.kaspaPrice;
  const kaspaLastDayUsd = balance ? balance * kaspaPrice.lastDayKaspaPrice : 0;

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
