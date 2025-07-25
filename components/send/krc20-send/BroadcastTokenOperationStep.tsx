import HotWalletBroadcastTokenOperation from "@/components/send/krc20-send/HotWalletBroadcastTokenOperation";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";

interface SendingProps {
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
}

export default function BroadcastTokenOperationStep({
  setOutTxs,
  onFail,
  onSuccess,
}: SendingProps) {
  const walletSigner = useKaspaHotWalletSigner();

  return (
    <>
      {/* FIXME Ledger support */}
      {walletSigner && (
        <HotWalletBroadcastTokenOperation
          walletSigner={walletSigner}
          setOutTxs={setOutTxs}
          onFail={onFail}
          onSuccess={onSuccess}
        />
      )}
    </>
  );
}
