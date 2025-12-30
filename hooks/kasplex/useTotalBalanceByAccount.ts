import { useKrc20TotalPriceInUsd } from "./useKrc20Prices";
import { useTokenListByAddress } from "@/hooks/kasplex/useTokenListByAddress";
import { Account } from "@/contexts/WalletManagerContext.tsx";
import useKaspaPrice from "@/hooks/useKaspaPrice";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";
import { useErc20Prices } from "@/hooks/evm/useZealousSwapMetadata";
import {
  useEvmKasBalances,
  useEvmKasBalancesByAddress,
} from "@/hooks/evm/useEvmKasBalance";
import { useErc20BalancesByAddress } from "@/hooks/evm/useErc20Balance";
import { publicKeyToAddress } from "viem/utils";

export default function useTotalBalanceByAccount(account?: Account) {
  const kaspaPrice = useKaspaPrice();
  const tokenList = useTokenListByAddress(account?.address, 5000);

  const balance = useKaspaBalance(account?.address);
  const kaspaUsd = balance ? balance * kaspaPrice.kaspaPrice : 0;

  const { totalUsd: totalTokenUsd } = useKrc20TotalPriceInUsd(tokenList);

  const evmAddress = account?.evmPublicKey
    ? publicKeyToAddress(account.evmPublicKey)
    : undefined;

  // Layer 2 balances
  const { data: erc20Balances } = useErc20BalancesByAddress(evmAddress);
  const { data: priceTokens } = useErc20Prices();
  const { data: evmKasBalances } = useEvmKasBalancesByAddress(evmAddress);

  // Calculate ERC20 total in USD
  const totalErc20Usd =
    erc20Balances && priceTokens
      ? erc20Balances.reduce((acc, balanceItem) => {
          if ("error" in balanceItem) return acc;
          const priceToken = priceTokens.find(
            (t) =>
              t.address.toLowerCase() ===
              balanceItem.tokenAddress.toLowerCase(),
          );
          if (!priceToken?.price) return acc;
          return acc + balanceItem.balance * priceToken.price;
        }, 0)
      : 0;

  // Calculate EVM KAS total in USD
  const totalEvmKasUsd = evmKasBalances
    ? Object.values(evmKasBalances).reduce(
        (acc, { balance }) => acc + parseFloat(balance) * kaspaPrice.kaspaPrice,
        0,
      )
    : 0;

  return kaspaUsd + totalTokenUsd + totalErc20Usd + totalEvmKasUsd;
}
