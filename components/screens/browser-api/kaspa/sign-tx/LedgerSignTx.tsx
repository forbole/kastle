import { SignTxPayload } from "@/api/background/handlers/kaspa/utils";
import LedgerNotSupported from "@/components/screens/browser-api/kaspa/LedgerNotSupported";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import { hasScriptOptions } from "@/lib/wallet/sign-script.ts";

type LedgerSignTxProps = {
  requestId: string;
  payload: SignTxPayload;
  origin: string;
};

// Sign-only requests are refused on Ledger even when they carry no scripts:
// the signed transaction rebuilt by the Ledger account's toRpcTransaction has
// no UTXO entries, so returning it to the dApp fails safe-serialization AFTER
// the user has already signed on-device (device QA 2026-08-25) — a wasted
// hardware signature is worse than an upfront refusal. Unblock: KAS-002 items
// 2 and 3 (toRpcTransaction UTXO entries / derivation metadata).
// signAndBroadcastTx is unaffected: it submits via RPC without
// safe-serializing, and is device-verified end-to-end.
export default function LedgerSignTx({
  requestId,
  payload,
}: LedgerSignTxProps) {
  // Keep the two refusals distinct so the dApp is told the true reason.
  const scripted = hasScriptOptions(payload.scripts);
  const message = scripted
    ? "Ledger does not support advanced scripts signing"
    : "Ledger cannot complete sign-only requests yet. Use a dApp flow that signs and broadcasts.";

  ApiExtensionUtils.sendMessage(
    requestId,
    ApiUtils.createApiResponse(requestId, null, message),
  );

  return scripted ? (
    <LedgerNotSupported />
  ) : (
    <LedgerNotSupported
      subtitle="Sign-only requests are not supported on Ledger yet."
      detail="Ledger cannot complete sign-only requests yet. Use a dApp flow that signs and broadcasts, or switch to a non-Ledger account."
    />
  );
}
