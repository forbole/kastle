import Layer2AssetImage from "@/components/Layer2AssetImage";
import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import { useNavigate } from "react-router-dom";
import { getChainImage, getChainName } from "@/lib/layer2";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { twMerge } from "tailwind-merge";
import useErc20Balance from "@/hooks/evm/useErc20Balance";
import { Erc20Asset } from "@/contexts/EvmAssets";
import { formatToken, textEllipsis } from "@/lib/utils.ts";
import HoverTooltip from "@/components/HoverTooltip";
import { useErc20Image } from "@/hooks/evm/useZealousSwapMetadata";

export default function Erc20SelectItem({ asset }: { asset: Erc20Asset }) {
  const { wallet } = useWalletManager();
  const navigate = useNavigate();
  const { data } = useErc20Balance(asset.address, asset.chainId);
  const balance = data?.balance ?? "0";
  const { logoUrl } = useErc20Image(asset.chainId, asset.address);

  const isLedger = wallet?.type === "ledger";
  const onClick = () => {
    if (isLedger) return;
    navigate(`/erc20/send/${asset.chainId}/${asset.address}`);
  };

  return (
    <>
      {balance !== "0" && (
        <button
          type="button"
          className="flex items-center justify-between rounded-lg px-3 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-800"
          onClick={onClick}
        >
          <div
            className={twMerge(
              "flex items-start gap-3",
              isLedger && "opacity-40",
            )}
          >
            <HoverTooltip text={getChainName(asset.chainId)} place="right">
              <Layer2AssetImage
                tokenImage={asset.image ?? logoUrl}
                chainImage={getChainImage(asset.chainId)}
                chainImageBottomPosition={-2}
                chainImageSize={16}
              />
            </HoverTooltip>
            <div className="flex flex-col items-start">
              <span>{asset.symbol}</span>
              <span className="text-xs text-daintree-400">
                {textEllipsis(asset.address)}
              </span>
            </div>
          </div>
          {!isLedger && <span>{formatToken(balance)}</span>}
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
