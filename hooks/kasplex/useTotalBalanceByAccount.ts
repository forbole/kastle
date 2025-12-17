import { useKrc20TotalPriceInUsd } from "./useKrc20Prices";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import { Account } from "@/contexts/WalletManagerContext.tsx";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";

export default function useTotalBalanceByAccount(account?: Account) {
  const kaspaPrice = useKaspaPrice();
  const tokenList = useTokenListByAddress(account?.address, 5000);

  const balance = useKaspaBalance(account?.address);
  const kaspaUsd = balance ? balance * kaspaPrice.kaspaPrice : 0;

  const { totalUsd: totalTokenUsd } = useKrc20TotalPriceInUsd(tokenList);

  return kaspaUsd + totalTokenUsd;
}
