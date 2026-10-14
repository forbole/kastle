import { Info } from "lucide-react";
import PageHeader from "@/ui/general/PageHeader";
import Button from "@/ui/general/Button";
import NetworkTypeChip from "./NetworkTypeChip";
import { KCC20_LABELS, NetworkType } from "./labels";

export interface SendConfirmPageProps {
  /** Sign / Ledger artwork above the cards; the caller picks per wallet type. */
  illustration?: string;
  senderAddress: string;
  recipientAddress: string;
  network: NetworkType;
  /** Display-ready, e.g. "1,608.32787 NACHO". */
  amount: string;
  amountFiat?: string;
  estFee: string;
  estFeeFiat?: string;
  /** Opens the extension's existing PriorityFeeSelection sheet; the row is inert without it. */
  onEstFeePress?: () => void;
  isConfirmDisabled?: boolean;
  isConfirmLoading?: boolean;
  onConfirm: () => void;
  onBack?: () => void;
  onClose?: () => void;
}

function AddressCard({
  title,
  address,
  network,
}: {
  title: string;
  address: string;
  network: NetworkType;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-card-border bg-white/5 p-3">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">{title}</span>
        <NetworkTypeChip network={network} />
      </div>
      <span className="break-all text-sm text-daintree-300">{address}</span>
    </div>
  );
}

function ValueColumn({ value, fiat }: { value: string; fiat?: string }) {
  return (
    <div className="flex min-w-0 flex-col items-end gap-1 text-right">
      <span className="break-all text-base font-semibold">{value}</span>
      {fiat && <span className="text-sm text-daintree-300">{fiat}</span>}
    </div>
  );
}

export default function SendConfirmPage({
  illustration,
  senderAddress,
  recipientAddress,
  network,
  amount,
  amountFiat,
  estFee,
  estFeeFiat,
  onEstFeePress,
  isConfirmDisabled = false,
  isConfirmLoading = false,
  onConfirm,
  onBack,
  onClose,
}: SendConfirmPageProps) {
  // Mobile's swipe-to-confirm has no popup equivalent; the confirm button stands in.
  return (
    <div className="flex h-full flex-col bg-icy-blue-950 font-sans text-white">
      <PageHeader
        title={KCC20_LABELS.confirmTitle}
        onBack={onBack}
        showClose={!!onClose}
        onClose={onClose}
      />

      <div className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4">
        {illustration && (
          <img
            alt=""
            src={illustration}
            className="aspect-[686/240] w-full max-w-[343px] self-center"
          />
        )}

        <AddressCard
          title={KCC20_LABELS.sendFrom}
          address={senderAddress}
          network={network}
        />
        <AddressCard
          title={KCC20_LABELS.sendTo}
          address={recipientAddress}
          network={network}
        />

        <div className="flex flex-col rounded-2xl border border-card-border bg-white/5">
          <div className="flex items-start justify-between gap-4 border-b border-card-border p-3">
            <span className="text-base font-semibold">
              {KCC20_LABELS.amount}
            </span>
            <ValueColumn value={amount} fiat={amountFiat} />
          </div>
          <button
            type="button"
            disabled={!onEstFeePress}
            onClick={onEstFeePress}
            className="flex items-start justify-between gap-4 rounded-b-2xl p-3 text-left enabled:hover:bg-white/5"
          >
            <span className="flex items-center gap-2 text-base font-semibold">
              {KCC20_LABELS.estFee}
              <Info aria-hidden="true" className="size-3.5" strokeWidth={2} />
            </span>
            <ValueColumn value={estFee} fiat={estFeeFiat} />
          </button>
        </div>
      </div>

      <div className="px-4 pb-6 pt-3">
        <Button
          variant="primary"
          size="md"
          disabled={isConfirmDisabled}
          loading={isConfirmLoading}
          onClick={onConfirm}
        >
          {KCC20_LABELS.confirm}
        </Button>
      </div>
    </div>
  );
}
