import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import useWalletManager from "@/hooks/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Transaction } from "@/wasm/core/kaspa";
import SignConfirm from "@/components/screens/browser-api/kaspa/sign/SignConfirm";
import { useState } from "react";
import Broadcasting from "@/components/screens/browser-api/kaspa/sign-and-broadcast/Broadcasting";
import { sleep } from "@/lib/utils";
import Success from "@/components/screens/browser-api/kaspa/sign-and-broadcast/Success";
import Error from "@/components/screens/browser-api/kaspa/sign-and-broadcast/Error";
import { ApiUtils } from "@/api/background/utils";

type SignAndBroadcastProps = {
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
};

export default function SignAndBroadcast({
  wallet,
  requestId,
  payload,
}: SignAndBroadcastProps) {
  const [isBroadcasting, setBroadcasting] = useState(false);
  const [state, setState] = useState<
    "confirm" | "broadcasting" | "success" | "error"
  >("confirm");
  const { rpcClient } = useRpcClientStateful();
  const { account } = useWalletManager();
  const [txIds, setTxIds] = useState<string[]>([]);

  const transaction = Transaction.deserializeFromSafeJSON(payload.txJson);

  const handleConfirm = async () => {
    if (!rpcClient || !wallet || !account || isBroadcasting) {
      return;
    }

    try {
      setBroadcasting(true);
      const signedTx = await wallet.signTx(transaction, payload.scripts);
      const { transactionId: txId } = await rpcClient.submitTransaction({
        transaction: signedTx,
      });
      setState("broadcasting");

      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, txId),
      );

      setTxIds([txId]);
      await sleep(1000);
      setState("success");
    } catch (err) {
      setState("error");
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(
          requestId,
          null,
          "Failed to sign and broadcast transaction: " +
            (err as any).toString(),
        ),
      );
    } finally {
      setBroadcasting(false);
    }
  };

  const handleCancel = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, null, "User cancelled"),
    );
    window.close();
  };

  return (
    <>
      {state === "confirm" && (
        <SignConfirm
          payload={payload}
          cancel={handleCancel}
          confirm={handleConfirm}
        />
      )}

      {state === "broadcasting" && <Broadcasting />}
      {state === "success" && <Success transactionIds={txIds} />}
      {state === "error" && <Error transactionIds={txIds} />}
    </>
  );
}
