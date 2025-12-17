import { applyDecimal } from "@/lib/krc20.ts";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBalance from "./wallet/useKaspaBalance";
import useKrc20TotalPriceInUsd from "./kasplex/useKrc20TotalPriceInUsd";
import { useKrc20TotalPriceInUsdLastDay } from "./kasplex/useKrc20TotalPriceInUsdLastDay";

export default function usePortfolioPerformance() {
  const { account } = useWalletManager();
  const kaspaPrice = useKaspaPrice();
  const balance = useKaspaBalance(account?.address) ?? 0;
  const kaspaUsd = balance * kaspaPrice.kaspaPrice;
  const kaspaLastDayUsd = balance ? balance * kaspaPrice.lastDayKaspaPrice : 0;

  const tokenList = useTokenListByAddress(account?.address, 5000);
  const { totalUsd: tokensUsd } = useKrc20TotalPriceInUsd(
    tokenList?.map((token) => token.id) || [],
  );
  const { totalUsd: tokensUsdLastDay } = useKrc20TotalPriceInUsdLastDay(
    tokenList?.map((token) => token.id) || [],
  );

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
