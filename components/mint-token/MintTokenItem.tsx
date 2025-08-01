import React, { useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { DeployFormData } from "@/components/screens/full-pages/MintToken.tsx";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { applyDecimal } from "@/lib/krc20.ts";
import { useTokenMetadata } from "@/hooks/kasplex/useTokenMetadata.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";

interface MintTokenItemProps {
  token?: any;
}

export default function MintTokenItem({ token }: MintTokenItemProps) {
  const { setValue } = useFormContext<DeployFormData>();

  const { data: tokenMetadata } = useTokenMetadata(token.tick);
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const { toFloat } = applyDecimal(token.dec);
  const balance = parseInt(token.balance, 10);
  const { data: tokenInfo } = useTokenInfo(token.id);

  const onImageError = () => {
    setImageUrl(kasIcon);
  };

  useEffect(() => {
    if (tokenMetadata?.iconUrl) {
      setImageUrl(tokenMetadata.iconUrl);
    }
  }, [tokenMetadata?.iconUrl]);

  const isMintMode = tokenInfo?.result?.[0]?.mod === "mint";

  return (
    isMintMode && (
      <button
        type="button"
        className="flex items-center justify-between rounded-lg px-4 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-700"
        onClick={() => setValue("ticker", token.id, { shouldValidate: true })}
      >
        <div className="flex items-center gap-2">
          <img
            alt="castle"
            className="h-[24px] w-[24px] rounded-full"
            src={imageUrl}
            onError={onImageError}
          />
          <span>{token.id}</span>
        </div>
        <span>{toFloat(balance).toLocaleString()}</span>
      </button>
    )
  );
}
