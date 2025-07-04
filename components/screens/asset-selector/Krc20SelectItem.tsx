import { TokenItem } from "@/hooks/kasplex/useTokenListByAddress";
import { applyDecimal } from "@/lib/krc20.ts";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { twMerge } from "tailwind-merge";
import { useTokenMetadata } from "@/hooks/kasplex/useTokenMetadata";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import { textEllipsis } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import useWalletManager from "@/hooks/useWalletManager";
import HoverTooltip from "@/components/HoverTooltip";

interface KRC20SelectItemProps {
  token: TokenItem;
}

export default function KRC20SelectItem({ token }: KRC20SelectItemProps) {
  const navigate = useNavigate();
  const { wallet } = useWalletManager();

  const { data: tokenMetadata } = useTokenMetadata(token.id);
  const { toFloat } = applyDecimal(token.dec);
  const balance = parseInt(token.balance, 10);
  const { data: tokenInfoResponse } = useTokenInfo(token.id);
  const tokenInfo = tokenInfoResponse?.result?.[0];
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;
  const isLedger = wallet?.type === "ledger";

  return (
    <>
      <button
        type="button"
        className="flex items-center justify-between rounded-lg px-3 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-600"
        onClick={() => {
          if (!isLedger) navigate(`/krc20/send/${token.id}`);
        }}
      >
        <div
          className={twMerge(
            "flex items-start gap-3",
            isLedger && "opacity-40",
          )}
        >
          <HoverTooltip text="KRC20" place="right">
            <Layer2AssetImage
              tokenImage={tokenMetadata?.iconUrl}
              chainImage={kasIcon}
            />
          </HoverTooltip>
          <div className="flex flex-col items-start">
            <span>{tokenName}</span>
            {tokenInfo?.mod === "issue" && (
              <span className="text-xs text-daintree-400">
                {textEllipsis(token.id)}
              </span>
            )}
          </div>
        </div>
        {!isLedger && <span>{toFloat(balance).toLocaleString()}</span>}
        {isLedger && (
          <span className="rounded-full bg-[#1C333C] p-2 px-4 text-xs text-white">
            Not supported with Ledger
          </span>
        )}
      </button>
    </>
  );
}
