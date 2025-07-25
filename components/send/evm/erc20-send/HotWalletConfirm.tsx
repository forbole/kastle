import { ConfirmStep } from "@/components/send/evm/erc20-send/ConfirmStep";
import { Erc20Asset } from "@/contexts/EvmAssets";
import useEvmHotWalletSigner from "@/hooks/evm/useEvmHotWalletSigner";

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
  const walletSigner = useEvmHotWalletSigner();

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
