import { useTokensMetadata } from "@/hooks/useTokenMetadata.ts";
import { applyDecimal } from "@/lib/krc20.ts";

export default function useTotalBalance() {
  const { account } = useWalletManager();
  const kapsaPrice = useKaspaPrice();
  const balance = account?.balance;
  const kaspaUsd = balance ? parseFloat(balance) * kapsaPrice.kaspaPrice : 0;

  const { data: tokenListResponse } = useTokenListByAddress(
    account?.address,
    5000,
  );

  const balancePerTicker = tokenListResponse?.result.reduce<
    Record<string, number>
  >((acc, token) => {
    const { toFloat } = applyDecimal(token.dec);
    acc[token.tick] = toFloat(parseInt(token.balance, 10));
    return acc;
  }, {});
  const tickers = Object.keys(balancePerTicker ?? {});
  const { toPriceInUsd } = useTokensMetadata(tickers);
  const priceInUsdPerTicker = toPriceInUsd();

  const totalTokenUsd = Object.entries(balancePerTicker ?? {}).reduce<number>(
    (acc, [ticker, amount]) => {
      const usdPriceTicker = priceInUsdPerTicker?.[ticker] ?? 0;
      const totalTickerUsd = amount * usdPriceTicker;
      return acc + totalTickerUsd;
    },
    0,
  );

  return kaspaUsd + totalTokenUsd;
}
