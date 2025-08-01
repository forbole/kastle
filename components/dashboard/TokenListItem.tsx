import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import {
  formatCurrency,
  formatToken,
  formatTokenPrice,
  symbolForCurrencyCode,
} from "@/lib/utils.ts";
import React, { useEffect, useState } from "react";
import { useTokenMetadata } from "@/hooks/kasplex/useTokenMetadata";
import { useNavigate } from "react-router-dom";
import { applyDecimal } from "@/lib/krc20.ts";
import { TokenItem } from "@/hooks/kasplex/useTokenListByAddress";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import Layer2AssetImage from "../Layer2AssetImage";

type TokenListItemProps = {
  token: TokenItem;
};

export default function TokenListItem({ token }: TokenListItemProps) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { data: tokenMetadata, toPriceInUsd } = useTokenMetadata(token.id);
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const { data: tokenInfoResponse } = useTokenInfo(token.id);

  const showBalance = !settings?.hideBalances;

  const { toFloat } = applyDecimal(token.dec);
  const balanceNumber = toFloat(
    token.balance ? parseInt(token.balance, 10) : 0,
  );
  const fiatTokenPrice = toPriceInUsd();
  const fiatBalance = balanceNumber * fiatTokenPrice;
  const { amount: tokenPriceCurrency, code: tokenPriceCurrencyCode } =
    useCurrencyValue(fiatTokenPrice);
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(fiatBalance);

  useEffect(() => {
    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  const tokenInfo = tokenInfoResponse?.result?.[0];
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
      onClick={() => navigate(`/token-asset/${token.id}`)}
    >
      <Layer2AssetImage tokenImage={imageUrl} chainImage={kasIcon} />
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-start justify-between text-base text-white">
          <div className="flex flex-col gap-1">
            <span>{tokenName}</span>
          </div>
          <span>{showBalance ? formatToken(balanceNumber) : "*****"}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-daintree-400">
          <span>
            {formatTokenPrice(tokenPriceCurrency, tokenPriceCurrencyCode)}
          </span>
          <span>
            ≈{" "}
            {showBalance
              ? formatCurrency(totalBalanceCurrency, currencyCode)
              : `${symbolForCurrencyCode(currencyCode)}*****`}
          </span>
        </div>
      </div>
    </div>
  );
}
