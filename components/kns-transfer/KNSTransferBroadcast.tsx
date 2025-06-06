import React, { useEffect } from "react";
import { captureException } from "@sentry/react";
import { AccountFactory } from "@/lib/wallet/wallet-factory.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful.ts";
import { transfer } from "@/lib/kns";
import { useFormContext } from "react-hook-form";
import { KNSTransferFormData } from "@/components/screens/KNSTransfer.tsx";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import useKNSRecentTransfer from "@/hooks/useKNSRecentTransfer.ts";
import useWalletManager from "@/hooks/useWalletManager.ts";
import Header from "@/components/GeneralHeader.tsx";
import carriageImage from "@/assets/images/carriage.png";

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
  const { getWalletSecret } = useKeyring();
  const { rpcClient, networkId } = useRpcClientStateful();
  const { watch } = useFormContext<KNSTransferFormData>();
  const { assetId, address, domain, isDomain } = watch();

  const broadcastOperation = async () => {
    try {
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

      const { walletSecret } = await getWalletSecret({
        walletId: selectedWalletId,
      });

      const accountFactory = new AccountFactory(rpcClient, networkId);
      const account =
        walletSecret.type === "mnemonic"
          ? accountFactory.createFromMnemonic(
              walletSecret.value,
              selectedAccountIndex,
            )
          : accountFactory.createFromPrivateKey(walletSecret.value);

      for await (const result of transfer(account, {
        ...(isDomain && { p: "domain" }),
        id: assetId,
        to: address,
      })) {
        if (result.status === "completed") {
          setOutTxs([result.commitTxId!, result.revealTxId!]);
        }
      }

      await addRecentKNSTransfer({
        id: assetId,
        from: await account.getAddress(),
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
