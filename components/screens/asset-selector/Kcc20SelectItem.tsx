import { Kcc20Token } from "@/lib/kcc20";
import { twMerge } from "tailwind-merge";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import { textEllipsis } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import HoverTooltip from "@/components/HoverTooltip";
import { CHAIN_BADGES } from "@/ui/popup/kcc20/AssetImage";
import { KCC20_FAMILY_LABELS } from "@/ui/popup/kcc20/labels";
import { formatBalance } from "@/components/send/kcc20-send/formatBalance";

export type SendableKcc20Token = Kcc20Token & {
  meta: NonNullable<Kcc20Token["meta"]>;
};

interface Kcc20SelectItemProps {
  token: SendableKcc20Token;
}

export default function Kcc20SelectItem({ token }: Kcc20SelectItemProps) {
  const navigate = useNavigate();
  const { wallet } = useWalletManager();
  // Ledger cannot sign v1 covenant transactions.
  const isLedger = wallet?.type === "ledger";

  return (
    <>
      <button
        type="button"
        className="flex items-center justify-between rounded-lg px-3 py-2 text-base font-medium text-daintree-200 hover:bg-daintree-800"
        onClick={() => {
          if (!isLedger) {
            // A token id can have one row per extension commitment; the route names the row.
            navigate(
              `/kcc20/send/${token.covenantId}${
                token.extensionCommitment
                  ? `?ext=${token.extensionCommitment}`
                  : ""
              }`,
            );
          }
        }}
      >
        <div
          className={twMerge(
            "flex items-center gap-3",
            isLedger && "opacity-40",
          )}
        >
          <HoverTooltip text={KCC20_FAMILY_LABELS[token.family]} place="right">
            <Layer2AssetImage
              tokenImage={token.meta.logoURI}
              chainImage={CHAIN_BADGES.kcc20}
              chainImageSize={16}
              chainImageBottomPosition={-2}
            />
          </HoverTooltip>
          <div className="flex flex-col items-start">
            <span>{token.meta.symbol}</span>
            <span className="text-xs text-daintree-400">
              {textEllipsis(token.covenantId)}
            </span>
          </div>
        </div>
        {/* Spendable, not held: the send screen caps the amount at this. */}
        {!isLedger && (
          <span>{formatBalance(token.spendable, token.meta.decimals)}</span>
        )}
        {isLedger && (
          <span className="rounded-full bg-[#1C333C] p-2 px-4 text-xs text-white">
            Not supported with Ledger
          </span>
        )}
      </button>
    </>
  );
}
