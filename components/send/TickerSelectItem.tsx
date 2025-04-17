import { TokenListResponse } from "@/hooks/useTokenListByAddress.ts";
import { applyDecimal } from "@/lib/krc20.ts";
import kasIcon from "@/assets/images/kas-icon.svg";
import React, { useEffect } from "react";
import { twMerge } from "tailwind-merge";
import { useTokenMetadata } from "@/hooks/useTokenMetadata.ts";

interface TickerSelectItemProps {
  token: NonNullable<TokenListResponse["result"]>[number];
  selectTicker: (ticker: string) => void;
  supported?: boolean;
}

export default function TickerSelectItem({
  token,
  selectTicker,
  supported = true,
}: TickerSelectItemProps) {
  const { data: tokenMetadata } = useTokenMetadata(token.tick);
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const { toFloat } = applyDecimal(token.dec);
  const balance = parseInt(token.balance, 10);

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  return (
    <button
      type="button"
      className="flex items-center justify-between rounded-lg px-4 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-700"
      onClick={() => {
        if (supported) selectTicker(token.tick);
      }}
    >
      <div
        className={twMerge(
          "flex items-center gap-2",
          !supported && "opacity-40",
        )}
      >
        <img
          alt="castle"
          className="h-[24px] w-[24px] rounded-full"
          src={imageUrl}
          onError={onImageError}
        />
        <span>{token.tick}</span>
      </div>
      {supported && <span>{toFloat(balance).toLocaleString()}</span>}
      {!supported && (
        <span className="rounded-full bg-[#1C333C] p-2 px-4 text-xs text-white">
          Not supported with Ledger
        </span>
      )}
    </button>
  );
}
