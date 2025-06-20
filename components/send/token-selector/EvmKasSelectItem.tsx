import Layer2AssetImage from "@/components/Layer2AssetImage";
import kasIcon from "@/assets/images/kas-icon.svg";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import { useNavigate } from "react-router-dom";
import { getChainImage } from "@/lib/layer2";
import useWalletManager from "@/hooks/useWalletManager";
import { twMerge } from "tailwind-merge";
import { useFormContext } from "react-hook-form";

export default function EvmKasSelectItem({
  chainId,
}: {
  chainId: `0x${string}`;
}) {
  const { wallet } = useWalletManager();
  const navigate = useNavigate();
  const { data } = useEvmKasBalance(chainId);
  const kasBalance = data?.balance ?? "0";
  const { watch } = useFormContext<{
    userInput?: string;
    address?: string;
    amount?: string;
  }>();

  const isLedger = wallet?.type === "ledger";
  const onClick = () => {
    if (isLedger) return;
    navigate(`/evm-kas/send/${chainId}`, {
      state: {
        step: "details",
        form: {
          userInput: watch("userInput"),
          address: watch("address"),
          amount: watch("amount"),
        },
      },
    });
  };

  return (
    <>
      {kasBalance !== "0" && (
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
              tokenImage={kasIcon}
              tokenImageSize={24}
              chainImageSize={20}
              chainImage={getChainImage(chainId)}
            />
            <span>KAS</span>
          </div>
          {!isLedger && <span>{kasBalance.toLocaleString()}</span>}
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
