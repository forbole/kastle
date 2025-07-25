import { useTokensMetadata } from "@/hooks/kasplex/useTokenMetadata";
import { applyDecimal } from "@/lib/krc20.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export default function useTotalBalance() {
  const { account } = useWalletManager();
  const kaspaPrice = useKaspaPrice();
  const balance = account?.balance;
  const kaspaUsd = balance ? parseFloat(balance) * kaspaPrice.kaspaPrice : 0;

  const tokenList = useTokenListByAddress(account?.address, 5000);

  const balancePerTicker = tokenList?.reduce<Record<string, number>>(
    (acc, token) => {
      const { toFloat } = applyDecimal(token.dec);
      const id = token.id;

      acc[id] = toFloat(parseInt(token.balance, 10));
      return acc;
    },
    {},
  );
  const tokenIds = Object.keys(balancePerTicker ?? {});
  const { toPriceInUsd } = useTokensMetadata(tokenIds);
  const priceInUsdPerTicker = toPriceInUsd();

  const totalTokenUsd = Object.entries(balancePerTicker ?? {}).reduce<number>(
    (acc, [tokenId, amount]) => {
      const tokenUsdPrice = priceInUsdPerTicker?.[tokenId] ?? 0;
      const totalTickerUsd = amount * tokenUsdPrice;
      return acc + totalTickerUsd;
    },
    0,
  );

  return kaspaUsd + totalTokenUsd;
}
