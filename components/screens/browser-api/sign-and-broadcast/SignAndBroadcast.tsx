import { ApiResponse, SignTxPayload } from "@/api/message";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import useWalletManager from "@/hooks/useWalletManager";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import { Transaction } from "@/wasm/core/kaspa";
import SignConfirm from "@/components/screens/browser-api/sign/SignConfirm";
import { useState } from "react";
import Broadcasting from "@/components/screens/browser-api/sign-and-broadcast/Broadcasting";
import { sleep } from "@/lib/utils";
import Success from "@/components/screens/browser-api/sign-and-broadcast/Success";
import Error from "@/components/screens/browser-api/sign-and-broadcast/Error";
import LedgerConfirm from "@/components/screens/ledger-connect/LedgerConfirm";

type SignAndBroadcastProps = {
  walletType: string;
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
};

export default function SignAndBroadcast({
  walletType,
  wallet,
  requestId,
  payload,
}: SignAndBroadcastProps) {
  const [isBroadcasting, setBroadcasting] = useState(false);
  const [state, setState] = useState<
    "confirm" | "signing" | "broadcasting" | "success" | "error"
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
      setState("signing");
      const signedTx = await wallet.signTx(transaction, payload.scripts);
      const { transactionId: txId } = await rpcClient.submitTransaction({
        transaction: signedTx,
      });
      setState("broadcasting");

      await ApiExtensionUtils.sendMessage(
        requestId,
        new ApiResponse(requestId, txId),
      );

      setTxIds([txId]);
      await sleep(2000);
      setState("success");
    } catch (err) {
      setState("error");
      await ApiExtensionUtils.sendMessage(
        requestId,
        new ApiResponse(
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
      new ApiResponse(requestId, null, "User cancelled"),
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

      {state === "signing" && walletType === "ledger" && (
        <LedgerConfirm showClose={false} showPrevious={false} />
      )}

      {state === "signing" && walletType !== "ledger" && <Broadcasting />}

      {state === "broadcasting" && <Broadcasting />}
      {state === "success" && <Success transactionIds={txIds} />}
      {state === "error" && <Error transactionIds={txIds} />}
    </>
  );
}
