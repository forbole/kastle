import { useTokenPrices } from "@/hooks/kasplex/useTokenMetadata";
import { applyDecimal } from "@/lib/krc20.ts";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export default function usePortfolioPerformance() {
  const { account } = useWalletManager();
  const kaspaPrice = useKaspaPrice();
  const balance = account?.balance;
  const kaspaUsd = balance ? parseFloat(balance) * kaspaPrice.kaspaPrice : 0;
  const kaspaLastDayUsd = balance
    ? parseFloat(balance) * kaspaPrice.lastDayKaspaPrice
    : 0;

  const tokenList = useTokenListByAddress(account?.address, 5000);

  const { tokenPrices } = useTokenPrices(tokenList?.map((token) => token.id));

  // Get the balance per KRC20 token
  const balancePerTicker = tokenList?.reduce<Record<string, number>>(
    (acc, token) => {
      const { toFloat } = applyDecimal(token.dec);
      acc[token.id] = toFloat(parseInt(token.balance, 10));
      return acc;
    },
    {},
  );

  // Calculate the total balance in USD for KRC20 tokens
  const krc20TotalBalanceInUsd = Object.entries(
    balancePerTicker ?? {},
  ).reduce<number>((acc, [ticker, amount]) => {
    const usdPriceTicker = tokenPrices?.[ticker]?.price ?? 0;
    const totalTickerUsd = amount * usdPriceTicker;
    return acc + totalTickerUsd;
  }, 0);

  // Calculate last day balance for KRC20 tokens
  const krc20LastDayBalanceInUsd = Object.entries(
    balancePerTicker ?? {},
  ).reduce<number>((acc, [ticker, amount]) => {
    const usdPriceTicker = tokenPrices?.[ticker]?.lastDayPrice ?? 0;
    const totalTickerUsd = amount * usdPriceTicker;
    return acc + totalTickerUsd;
  }, 0);

  const totalBalance = krc20TotalBalanceInUsd + kaspaUsd;
  const totalLastDayBalance = krc20LastDayBalanceInUsd + kaspaLastDayUsd;

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
