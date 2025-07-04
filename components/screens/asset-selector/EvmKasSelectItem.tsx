import Layer2AssetImage from "@/components/Layer2AssetImage";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import { useNavigate } from "react-router-dom";
import { getChainImage, getChainName } from "@/lib/layer2";
import useWalletManager from "@/hooks/useWalletManager";
import { twMerge } from "tailwind-merge";
import { formatToken } from "@/lib/utils.ts";
import HoverTooltip from "@/components/HoverTooltip";

export default function EvmKasSelectItem({
  chainId,
}: {
  chainId: `0x${string}`;
}) {
  const { wallet } = useWalletManager();
  const navigate = useNavigate();
  const { data } = useEvmKasBalance(chainId);
  const kasBalance = data?.balance ?? "0";

  const isLedger = wallet?.type === "ledger";
  const onClick = () => {
    if (isLedger) return;
    navigate(`/evm-kas/send/${chainId}`);
  };

  return (
    <>
      {kasBalance !== "0" && (
        <button
          type="button"
          className="flex items-center justify-between rounded-lg px-3 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-600"
          onClick={onClick}
        >
          <div
            className={twMerge(
              "flex items-start gap-3",
              isLedger && "opacity-40",
            )}
          >
            <HoverTooltip text={getChainName(chainId)} place="right">
              <Layer2AssetImage
                tokenImage={kasIcon}
                chainImage={getChainImage(chainId)}
              />
            </HoverTooltip>
            <span>KAS</span>
          </div>
          {!isLedger && <span>{formatToken(parseFloat(kasBalance))}</span>}
          {isLedger && (
            <span className="rounded-full bg-[#1C333C] p-2 px-4 text-xs text-white">
              Not supported with Ledger
            </span>
          )}
        </button>
      )}
    </>
  );
}
