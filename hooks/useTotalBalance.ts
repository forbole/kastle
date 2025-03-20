import { useTokensMetadata } from "@/hooks/useTokenMetadata.ts";

export default function useTotalBalance() {
  const { account } = useWalletManager();
  const kapsaPrice = useKaspaPrice();
  const balance = account?.balance;
  const { data: tokenListResponse } = useTokenListByAddress(
    account?.address,
    5000,
  );
  const kaspaUsd = balance ? parseFloat(balance) * kapsaPrice.kaspaPrice : 0;

  const balancePerTicker = tokenListResponse?.result.reduce<
    Record<string, string>
  >((acc, token) => {
    acc[token.tick] = token.balance;
    return acc;
  }, {});
  const tickers = Object.keys(balancePerTicker ?? {});

  const { toPriceInUsd } = useTokensMetadata(tickers);
  const priceInUsdPerTicker = toPriceInUsd();

  const totalTokenUsd = Object.entries(balancePerTicker ?? {}).reduce<number>(
    (acc, [ticker, amount]) => {
      const usdPriceTicker = priceInUsdPerTicker?.[ticker] ?? 0;
      const totalTickerUsd = parseFloat(amount) * usdPriceTicker;
      return acc + totalTickerUsd;
    },
    0,
  );

  return kaspaUsd + totalTokenUsd;
}
