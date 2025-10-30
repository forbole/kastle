import React, { useEffect } from "react";
import { captureException } from "@sentry/react";
import useRpcClientStateful from "@/hooks/useRpcClientStateful.ts";
import { transfer } from "@/lib/kns";
import { useFormContext } from "react-hook-form";
import { KNSTransferFormData } from "@/components/screens/KNSTransfer.tsx";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import useKNSRecentTransfer from "@/hooks/kns/useKNSRecentTransfer";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import Header from "@/components/GeneralHeader.tsx";
import carriageImage from "@/assets/images/carriage.png";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";

interface KNSTransferBroadcastProps {
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
}

export default function KNSTransferBroadcast({
  setOutTxs,
  onFail,
  onSuccess,
}: KNSTransferBroadcastProps) {
  const calledOnce = useRef(false);
  const { addRecentAddress } = useRecentAddresses();
  const { addRecentKNSTransfer } = useKNSRecentTransfer();
  const { walletSettings } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { watch } = useFormContext<KNSTransferFormData>();
  const { assetId, address, domain, isDomain } = watch();
  const walletSigner = useKaspaHotWalletSigner();

  const broadcastOperation = async () => {
    try {
      if (!walletSigner) {
        throw new Error("Wallet signer is not initialized");
      }

      const selectedWalletId = walletSettings?.selectedWalletId;
      const selectedAccountIndex = walletSettings?.selectedAccountIndex;
      if (!selectedWalletId || typeof selectedAccountIndex !== "number") {
        throw new Error("No account selected");
      }

      if (!rpcClient || !networkId) {
        throw new Error("No rpc client not connected");
      }

      if (!address) {
        throw new Error("Missing recipient address");
      }

      for await (const result of await transfer(
        walletSigner,
        rpcClient,
        networkId,
        {
          ...(isDomain && { p: "domain" }),
          id: assetId,
          to: address,
        },
      )) {
        if (result.status === "completed") {
          setOutTxs([result.commitTxId!, result.revealTxId!]);
        }
      }

      await addRecentKNSTransfer({
        id: assetId,
        from: await walletSigner.getAddress(),
        at: new Date().getTime(),
      });

      await addRecentAddress({
        kaspaAddress: address,
        usedAt: new Date().getTime(),
        domain,
      });

      onSuccess();
    } catch (e) {
      captureException(e);
      console.error(e);
      onFail();
    }
  };

  useEffect(() => {
    if (calledOnce.current) return;
    calledOnce.current = true;

    broadcastOperation();
  }, []);

  return (
    <>
      <Header title="Transferring" showPrevious={false} showClose={false} />

      <div className="mt-10 flex h-full flex-col items-center gap-4">
        <img
          alt="castle"
          className="h-[120px] w-[299px] self-center"
          src={carriageImage}
        />
        <span className="text-xl font-semibold text-daintree-400">
          Transferring...
        </span>
      </div>
    </>
  );
}
