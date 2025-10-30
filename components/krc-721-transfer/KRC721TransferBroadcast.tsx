import React, { useEffect } from "react";
import { captureException } from "@sentry/react";
import useRpcClientStateful from "@/hooks/useRpcClientStateful.ts";
import { useFormContext } from "react-hook-form";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import Header from "@/components/GeneralHeader.tsx";
import carriageImage from "@/assets/images/carriage.png";
import { KRC721TransferFormData } from "@/components/screens/KRC721Transfer.tsx";
import { transfer } from "@/lib/krc721.ts";
import useKRC721RecentTransfer from "@/hooks/krc721/useKRC721RecentTransfer";
import useKaspaHotWalletSigner from "@/hooks/wallet/useKaspaHotWalletSigner";

interface KRC721TransferBroadcastProps {
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
}

export default function KRC721TransferBroadcast({
  setOutTxs,
  onFail,
  onSuccess,
}: KRC721TransferBroadcastProps) {
  const calledOnce = useRef(false);
  const { addRecentAddress } = useRecentAddresses();
  const { addRecentKRC721Transfer } = useKRC721RecentTransfer();
  const { walletSettings } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { watch } = useFormContext<KRC721TransferFormData>();
  const { tick, tokenId, address, domain } = watch();
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
          tick,
          tokenId,
          to: address,
        },
      )) {
        if (result.status === "completed") {
          setOutTxs([result.commitTxId!, result.revealTxId!]);
        }
      }

      await addRecentKRC721Transfer({
        id: tokenId,
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
