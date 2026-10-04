import { useNavigate } from "react-router-dom";
import { useFormContext } from "react-hook-form";
import type { TransferPlanned } from "@dotk/sdk-tx";
import Header from "@/components/GeneralHeader.tsx";
import signImage from "@/assets/images/sign.png";
import { formatCurrency, formatToken } from "@/lib/utils.ts";
import useKaspaPrice from "@/hooks/useKaspaPrice.ts";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import type { DotkTransferFormData } from "@/components/dotk-transfer/DotkTransfer.tsx";

type DotkTransferConfirmProps = {
  plan: TransferPlanned;
  onNext?: () => void;
  onBack?: () => void;
};

export default function DotkTransferConfirm({
  plan,
  onNext,
  onBack,
}: DotkTransferConfirmProps) {
  const navigate = useNavigate();
  const { account } = useWalletManager();
  const { watch } = useFormContext<DotkTransferFormData>();
  const { name, domain } = watch();
  const kaspaPrice = useKaspaPrice();

  const feeKas = Number(plan.fee) / 1e8;
  const { amount: feesCurrency, code: feesCurrencyCode } = useCurrencyValue(
    feeKas * kaspaPrice.kaspaPrice,
  );

  return (
    <>
      <Header
        title="Confirm"
        onClose={() => navigate("/dashboard")}
        onBack={onBack}
      />

      <div className="flex h-full flex-col gap-2">
        <img
          alt="castle"
          className="aspect-[686/240] w-full max-w-[343px] self-center"
          src={signImage}
        />

        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <div className="flex gap-1 text-base font-medium">
            <span>Transfer</span>
            <span className="text-icy-blue-400">{name}</span>
            <span>from</span>
          </div>
          <span className="break-all text-xs text-daintree-400">
            {account?.address}
          </span>
        </div>
        {/* The recipient the user typed, never the deed script address. */}
        <div className="flex flex-col gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <span className="text-base font-medium">
            To
            {!!domain && ` - ${domain}`}
          </span>
          <span className="break-all text-xs text-daintree-400">
            {plan.recipient}
          </span>
        </div>
        {plan.cards.subnamesDropped.length > 0 && (
          <div className="rounded-lg border border-red-500/40 bg-daintree-800 p-4 text-sm text-red-500">
            {plan.cards.subnamesDropped.length} subname
            {plan.cards.subnamesDropped.length > 1 ? "s" : ""} will end with
            this transfer.
          </div>
        )}
        <div className="flex justify-between gap-2 rounded-lg border border-daintree-700 bg-daintree-800 p-4">
          <span className="text-base font-medium">Fee</span>
          <div className="flex flex-col items-end break-all">
            <span className="text-base font-medium text-white">
              {formatToken(feeKas, 3)} KAS
            </span>
            <span className="text-xs text-daintree-400">
              {formatCurrency(feesCurrency, feesCurrencyCode)}
            </span>
          </div>
        </div>

        <div className="mt-auto">
          <button
            onClick={onNext}
            className="mt-auto flex w-full items-center justify-center gap-2 rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white transition-colors hover:bg-icy-blue-600"
          >
            Confirm
          </button>
        </div>
      </div>
    </>
  );
}
