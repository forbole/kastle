import kasIcon from "@/assets/images/kas-icon.svg";
import { formatToken, formatTokenPrice, formatUSD } from "@/lib/utils.ts";
import React, { useEffect, useState } from "react";
import { TokenMetadata, useKasFyi } from "@/hooks/useKasFyi.ts";
import { useNavigate } from "react-router-dom";
import { applyDecimal } from "@/lib/krc20.ts";

type TokenListItemProps = { token: TokenListItem };

export default function TokenListItem({ token }: TokenListItemProps) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { fetchTokenMetadataByTicker } = useKasFyi();
  const [tokenMetadata, setTokenMetadata] = useState<TokenMetadata>();
  const [imageUrl, setImageUrl] = useState(kasIcon);

  const showBalance = !settings?.hideBalances;

  const decimal = applyDecimal(token.dec);
  const balanceNumber = decimal(
    token.balance ? parseInt(token.balance, 10) : 0,
  );
  const tokenPrice = tokenMetadata?.price?.priceInUsd ?? 0;

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    const fetchTokenMetadata = async () => {
      const tokenMetadata = await fetchTokenMetadataByTicker(token.tick);
      setTokenMetadata(tokenMetadata);
    };

    fetchTokenMetadata();
  }, []);

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
          <span>{formatTokenPrice(0)}</span>
          <span>
            ≈ {showBalance ? formatUSD(balanceNumber * tokenPrice) : "$*****"}{" "}
            USD
          </span>
        </div>
      </div>
    </div>
  );
}
