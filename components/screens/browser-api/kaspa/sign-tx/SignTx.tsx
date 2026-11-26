import {
  SIGN_PSKT_METHOD,
  SignTxPayload,
  admissionRefusal,
} from "@/api/background/handlers/kaspa/utils";
import { ApiExtensionUtils } from "@/api/extension";
import { IWallet } from "@/lib/wallet/wallet-interface.ts";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import SignConfirm from "@/components/screens/browser-api/kaspa/sign/SignConfirm";
import { ApiUtils } from "@/api/background/utils";
import useAnalytics from "@/hooks/useAnalytics";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  hasPartialOutputCommitment,
  hasScriptOptions,
  keepArrivedSignatures,
} from "@/lib/wallet/sign-script.ts";

export const PARTIAL_OUTPUT_WARNING =
  "This request signs with a sighash type that commits to only part of the transaction outputs. The outputs it does not cover are not protected by your signature and can still be changed after you approve.";

type SignTxProps = {
  wallet: IWallet;
  requestId: string;
  payload: SignTxPayload;
  origin: string;
};

export default function SignTx({
  wallet,
  requestId,
  payload,
  origin,
}: SignTxProps) {
  const { rpcClient } = useRpcClientStateful();
  const { emitKasSignTx } = useAnalytics();
  // Set by the background (signTx.ts), never by the dApp.
  const psktRequest =
    new URLSearchParams(window.location.search).get("method") ===
    SIGN_PSKT_METHOD;
  const { account, wallet: selectedWallet } = useWalletManager();

  const handleConfirm = async () => {
    if (!rpcClient || !wallet) {
      return;
    }

    // Bound to the account the guard checked: another one never signs it.
    const refusal = admissionRefusal(
      payload,
      selectedWallet?.id,
      account?.index,
    );
    if (refusal) {
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, refusal),
      );
      window.close();
      return;
    }

    try {
      const tx = deserializeTransaction(payload.txJson);
      // The Ledger signer refuses any truthy `scripts` value, so the schema's
      // empty default must reach it as undefined (script-free signing).
      const scripts = hasScriptOptions(payload.scripts)
        ? payload.scripts
        : undefined;
      // signPskt: an input the request does not name keeps its signatureScript.
      const signed = psktRequest
        ? await keepArrivedSignatures(tx, (t) => wallet.signTx(t, scripts))
        : await wallet.signTx(tx, scripts);
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, signed.serializeToSafeJSON()),
      );
      emitKasSignTx({ origin, status: "success" });
    } catch (err) {
      emitKasSignTx({ origin, status: "failed" });
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(
          requestId,
          null,
          "Failed to sign transaction: " + (err as any).toString(),
        ),
      );
    } finally {
      window.close();
    }
  };

  const handleCancel = async () => {
    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, null, "User denied"),
    );
    window.close();
  };

  return (
    <>
      <SignConfirm
        confirm={handleConfirm}
        cancel={handleCancel}
        payload={payload}
        warning={
          hasPartialOutputCommitment(payload.scripts)
            ? PARTIAL_OUTPUT_WARNING
            : undefined
        }
        psktRequest={psktRequest}
      />
    </>
  );
}
