import { TokenListResponse } from "@/hooks/useTokenListByAddress.ts";
import { applyDecimal } from "@/lib/krc20.ts";
import kasIcon from "@/assets/images/kas-icon.svg";
import React, { useEffect } from "react";

interface TickerSelectItemProps {
  token: TokenListResponse["result"][number];
}

export default function TickerSelectItem({ token }: TickerSelectItemProps) {
  const { data: tokenMetadata } = useTokenMetadata(token.tick);
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const decimal = applyDecimal(token.dec);
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
    >
      <div className="flex items-center gap-2">
        <img
          alt="castle"
          className="h-[24px] w-[24px] rounded-full"
          src={imageUrl}
          onError={onImageError}
        />
        <span>{token.tick}</span>
      </div>
      <span>{decimal(balance).toLocaleString()}</span>
    </button>
  );
}
