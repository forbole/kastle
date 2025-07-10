import { useEffect, useState } from "react";
import { ConfirmStep } from "@/components/send/evm/evm-kas-send/ConfirmStep";
import { IWallet } from "@/lib/ethereum/wallet/wallet-interface";
import useWalletManager from "@/hooks/useWalletManager.ts";
import useKeyring from "@/hooks/useKeyring";
import { LegacyAccountFactory } from "@/lib/ethereum/wallet/account-factory";
import useWalletSigner from "@/hooks/evm/useWalletSigner";

type HotWalletConfirmProps = {
  chainId: `0x${string}`;
  onNext: () => void;
  onBack: () => void;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
};

export default function HotWalletConfirm({
  chainId,
  onNext,
  onBack,
  setOutTxs,
  onFail,
}: HotWalletConfirmProps) {
  const walletSigner = useWalletSigner();

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
