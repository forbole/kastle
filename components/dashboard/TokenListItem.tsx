import kasIcon from "@/assets/images/kas-icon.svg";
import { formatToken, formatTokenPrice, formatUSD } from "@/lib/utils.ts";
import React, { useEffect, useState } from "react";
import { useTokenMetadata } from "@/hooks/useTokenMetadata.ts";
import { useNavigate } from "react-router-dom";
import { applyDecimal } from "@/lib/krc20.ts";
import { TokenListResponse } from "@/hooks/useTokenListByAddress.ts";

type TokenListItemProps = { token: TokenListResponse["result"][number] };

export default function TokenListItem({ token }: TokenListItemProps) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { data: tokenMetadata, toPriceInUsd } = useTokenMetadata(token.tick);
  const [imageUrl, setImageUrl] = useState(kasIcon);

  const showBalance = !settings?.hideBalances;

  const { toFloat } = applyDecimal(token.dec);
  const balanceNumber = toFloat(
    token.balance ? parseInt(token.balance, 10) : 0,
  );
  const tokenPrice = toPriceInUsd();

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
      onClick={() => navigate(`/token-asset/${token.tick}`)}
    >
      <img
        alt="castle"
        className="h-[40px] w-[40px] rounded-full"
        src={imageUrl}
        onError={onImageError}
      />
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-center justify-between text-base text-white">
          <span>{token.tick}</span>
          <span>{showBalance ? formatToken(balanceNumber) : "*****"}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-daintree-400">
          <span>{formatTokenPrice(tokenPrice)}</span>
          <span>
            ≈ {showBalance ? formatUSD(balanceNumber * tokenPrice) : "$*****"}{" "}
            USD
          </span>
        </div>
      </div>
    </div>
  );
}
