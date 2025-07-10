import { ConfirmStep } from "@/components/send/evm/erc20-send/ConfirmStep";
import { Erc20Asset } from "@/contexts/EvmAssets";
import useWalletSigner from "@/hooks/evm/useWalletSigner";

type HotWalletConfirmProps = {
  asset: Erc20Asset;
  onNext: () => void;
  onBack: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
};

export default function HotWalletConfirm({
  asset,
  onNext,
  onBack,
  setOutTxs,
  onFail,
}: HotWalletConfirmProps) {
  const walletSigner = useWalletSigner();

  return (
    <ConfirmStep
      asset={asset}
      onNext={onNext}
      setOutTxs={setOutTxs}
      onFail={onFail}
      onBack={onBack}
      walletSigner={walletSigner}
    />
  );
}
