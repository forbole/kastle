import { DiagnosticReport } from "@/lib/diagnostics";
import { ConfirmStep } from "@/components/send/evm/evm-kas-send/ConfirmStep";
import useEvmHotWalletSigner from "@/hooks/wallet/useEvmHotWalletSigner";

type HotWalletConfirmProps = {
  chainId: `0x${string}`;
  onNext: () => void;
  onBack: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: (report?: DiagnosticReport | null) => void;
};

export default function HotWalletConfirm({
  chainId,
  onNext,
  onBack,
  setOutTxs,
  onFail,
}: HotWalletConfirmProps) {
  const walletSigner = useEvmHotWalletSigner();

  return (
    <ConfirmStep
      chainId={chainId}
      onNext={onNext}
      setOutTxs={setOutTxs}
      onFail={onFail}
      onBack={onBack}
      walletSigner={walletSigner}
    />
  );
}
