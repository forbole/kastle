import useKrc20TotalPriceInUsd from "./useKrc20TotalPriceInUsd";
import { applyDecimal } from "@/lib/krc20.ts";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import { Account } from "@/contexts/WalletManagerContext.tsx";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";

export default function useTotalBalanceByAccount(account?: Account) {
  const kaspaPrice = useKaspaPrice();
  const tokenList = useTokenListByAddress(account?.address, 5000);

  const balance = useKaspaBalance(account?.address);
  const kaspaUsd = balance ? balance * kaspaPrice.kaspaPrice : 0;

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
  const { totalUsd: totalTokenUsd } = useKrc20TotalPriceInUsd(tokenIds);

  return kaspaUsd + totalTokenUsd;
}
