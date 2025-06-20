import Layer2AssetImage from "@/components/Layer2AssetImage";
import kasIcon from "@/assets/images/kas-icon.svg";
import { useNavigate } from "react-router-dom";
import { getChainImage } from "@/lib/layer2";
import useWalletManager from "@/hooks/useWalletManager";
import { twMerge } from "tailwind-merge";
import { useFormContext } from "react-hook-form";
import useErc20Balance from "@/hooks/evm/useErc20Balance";
import { Erc20Asset } from "@/contexts/EvmAssets";
import { formatToken } from "@/lib/utils.ts";

export default function Erc20SelectItem({
  asset,
  toggleShow,
}: {
  asset: Erc20Asset;
  toggleShow: () => void;
}) {
  const { wallet } = useWalletManager();
  const navigate = useNavigate();
  const { data } = useErc20Balance(
    asset.address,
    asset.decimals,
    asset.chainId,
  );
  const balance = data?.balance ?? "0";
  const { watch } = useFormContext<{
    userInput?: string;
    amount?: string;
  }>();

  const isLedger = wallet?.type === "ledger";
  const onClick = () => {
    if (isLedger) return;
    navigate(`/erc20/send/${asset.chainId}/${asset.address}`, {
      state: {
        step: "details",
        form: {
          userInput: watch("userInput"),
          amount: watch("amount"),
        },
      },
    });
    toggleShow();
  };

  return (
    <>
      {balance !== "0" && (
        <button
          type="button"
          className="flex items-center justify-between rounded-lg px-4 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-700"
          onClick={onClick}
        >
          <div
            className={twMerge(
              "flex items-start gap-2",
              isLedger && "opacity-40",
            )}
          >
            <Layer2AssetImage
              tokenImage={asset.image ?? kasIcon}
              tokenImageSize={24}
              chainImageSize={20}
              chainImage={getChainImage(asset.chainId)}
            />
            <span>{asset.symbol}</span>
          </div>
          {!isLedger && <span>{formatToken(parseFloat(balance))}</span>}
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
