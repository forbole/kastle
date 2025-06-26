import { TokenItem } from "@/hooks/kasplex/useTokenListByAddress";
import { applyDecimal } from "@/lib/krc20.ts";
import kasIcon from "@/assets/images/kas-icon.svg";
import { twMerge } from "tailwind-merge";
import { useTokenMetadata } from "@/hooks/kasplex/useTokenMetadata";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import { textEllipsis } from "@/lib/utils";

interface KRC20SelectItemProps {
  token: TokenItem;
  selectToken: (tokenId: string) => void;
  supported?: boolean;
}

export default function KRC20SelectItem({
  token,
  selectToken,
  supported = true,
}: KRC20SelectItemProps) {
  const { data: tokenMetadata } = useTokenMetadata(token.id);
  const { toFloat } = applyDecimal(token.dec);
  const balance = parseInt(token.balance, 10);
  const { data: tokenInfoResponse } = useTokenInfo(token.id);
  const tokenInfo = tokenInfoResponse?.result?.[0];
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;

  return (
    <button
      type="button"
      className="flex items-center justify-between rounded-lg px-4 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-700"
      onClick={() => {
        if (supported) selectToken(token.id);
      }}
    >
      <div
        className={twMerge(
          "flex items-start gap-2",
          !supported && "opacity-40",
        )}
      >
        <Layer2AssetImage
          tokenImage={tokenMetadata?.iconUrl}
          tokenImageSize={24}
          chainImageSize={20}
          chainImage={kasIcon}
        />
        <div className="flex flex-col items-start">
          <span>{tokenName}</span>
          {tokenInfo?.mod === "issue" && (
            <span className="text-xs text-daintree-400">
              {textEllipsis(token.id)}
            </span>
          )}
        </div>
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
