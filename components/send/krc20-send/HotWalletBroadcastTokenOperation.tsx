import { Broadcasting } from "@/components/send/Broadcasting";
import { useFormContext } from "react-hook-form";
import { TokenOperationFormData } from "@/components/send/krc20-send/Krc20Transfer";
import { useEffect } from "react";
import { captureException } from "@sentry/react";
import useRecentAddresses from "@/hooks/useRecentAddresses.ts";
import { transfer } from "@/lib/krc20.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { IWallet } from "@/lib/wallet/wallet-interface";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";

type HotWalletSendingProps = {
  walletSigner: IWallet;
  setOutTxs: (value: string[] | undefined) => void;
  onFail: () => void;
  onSuccess: () => void;
};

export default function HotWalletBroadcastTokenOperation({
  walletSigner,
  setOutTxs,
  onFail,
  onSuccess,
}: HotWalletSendingProps) {
  const { addRecentAddress } = useRecentAddresses();
  const { watch } = useFormContext<TokenOperationFormData>();
  const calledOnce = useRef(false);
  const opData = watch("opData");
  const domain = watch("domain");
  const { walletSettings } = useWalletManager();
  const { rpcClient, networkId } = useRpcClientStateful();

  const broadcastOperation = async () => {
    if (!rpcClient || !networkId) {
      return;
    }

    try {
      const accountIndex = walletSettings?.selectedAccountIndex;
      if (accountIndex === null || accountIndex === undefined) {
        throw new Error("No account selected");
      }

      for await (const result of await transfer(
        walletSigner,
        rpcClient,
        networkId,
        {
          tick: opData.tick,
          amt: opData.amt,
          to: opData.to,
        },
      )) {
        if (result.status === "completed") {
          setOutTxs([result.commitTxId, result.revealTxId]);
        }
      }

      const tokenOperationRecipientAddress = opData?.to;
      if (tokenOperationRecipientAddress) {
        await addRecentAddress({
          kaspaAddress: tokenOperationRecipientAddress,
          usedAt: new Date().getTime(),
          domain,
        });
      }

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

  return <Broadcasting onSuccess={onSuccess} />;
}
