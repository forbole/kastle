import { ConfirmStep } from "@/components/send/kas-send/ConfirmStep";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";

type HotWalletConfirmProps = {
  onNext: () => void;
  onBack: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
};

export default function HotWalletConfirm({
  onNext,
  onBack,
  setOutTxs,
  onFail,
}: HotWalletConfirmProps) {
  const walletSigner = useKaspaHotWalletSigner();

  return (
    <ConfirmStep
      onNext={onNext}
      setOutTxs={setOutTxs}
      onFail={onFail}
      onBack={onBack}
      walletSigner={walletSigner}
    />
  );
}
