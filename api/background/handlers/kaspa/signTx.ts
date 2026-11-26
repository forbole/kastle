import { Handler } from "@/api/background/utils";
import { ApiRequestWithHost, RPC_ERRORS, RpcErrorCode } from "@/api/message";
import { ApiUtils } from "@/api/background/utils";
import {
  SIGN_PSKT_METHOD,
  SignPsktPayloadSchema,
  SignTxPayload,
  SignTxPayloadSchema,
  accountFingerprint,
  isCovenantTxJson,
} from "./utils";
import { covenantAdmission } from "./covenant-guard";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import { psktSignOptions } from "@/lib/wallet/sign-script";

const INVALID_TX_DATA = "Invalid transaction data";

type Prepared = SignTxPayload | { error: unknown };

/**
 * The one sign-request flow behind signTx and signPskt: initialised check,
 * host check, `prepare` (the action's payload as the signTx payload the popup
 * signs, or the error to answer with), covenant admission, popup.
 */
const signTxFlow =
  (
    prepare: (payload: unknown) => Promise<Prepared>,
    method?: typeof SIGN_PSKT_METHOD,
  ): Handler =>
  async (tabId: number, message: ApiRequestWithHost, sendResponse: any) => {
    // Check if extension is initialized
    if (!(await ApiUtils.isInitialized())) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          "Extension is not initialized",
        ),
      );
      return;
    }

    // Check if host is connected, if not, return error
    if (!(await ApiUtils.isHostConnected(message.host))) {
      sendResponse(
        ApiUtils.createApiResponse(message.id, null, "Host not connected"),
      );
      return;
    }

    const prepared = await prepare(message.payload);
    if ("error" in prepared) {
      sendResponse(
        ApiUtils.createApiResponse(message.id, null, prepared.error),
      );
      return;
    }

    // Version 0 never fetches; a covenant request opens only once every input
    // it signs is checked.
    // The admission is bound to the account it ran for (admittedFor). `prepare`
    // may bind one itself (signPskt, every version); signTx's prepare drops any
    // value the dApp sent, so a version-0 signTx stays unbound.
    const admission = isCovenantTxJson(prepared.txJson)
      ? await covenantAdmission(prepared.txJson, prepared.scripts)
      : undefined;
    if (admission && "refusal" in admission) {
      sendResponse(
        ApiUtils.createApiResponse(message.id, null, admission.refusal),
      );
      return;
    }
    // The account switched between prepare's checks and the admission's.
    if (
      admission &&
      prepared.admittedFor !== undefined &&
      prepared.admittedFor !== admission.admittedFor
    ) {
      sendResponse(
        ApiUtils.createApiResponse(
          message.id,
          null,
          RPC_ERRORS.COVENANT_ACCOUNT_CHANGED,
        ),
      );
      return;
    }
    const payload = {
      ...prepared,
      admittedFor: admission?.admittedFor ?? prepared.admittedFor,
    };

    const url = new URL(browser.runtime.getURL("/popup.html"));
    url.hash = "/sign-tx";
    url.searchParams.set("requestId", message.id);
    url.searchParams.set("payload", JSON.stringify(payload));
    // Set here only, never from the dApp: the screen says who asked.
    if (method) url.searchParams.set("method", method);
    if (message.host) {
      url.searchParams.set("origin", message.host);
    }

    // Open the popup and wait for the response
    const response = await ApiUtils.openPopupAndListenForResponse(
      message.id,
      url.toString(),
      tabId,
    );
    sendResponse(response);
  };

/** signTxHandler to serve BrowserMessageType.SIGN_TX message */
export const signTxHandler = signTxFlow(async (payload) => {
  const result = SignTxPayloadSchema.safeParse(payload);
  // admittedFor is the wallet's to set, never the dApp's.
  return result.success
    ? { ...result.data, admittedFor: undefined }
    : { error: INVALID_TX_DATA };
});

/**
 * Kasware-compatible signPskt (SIGN_PSKT): the same popup and signer as
 * signTx, with signInputs mapped to script options and every input the
 * request would leave unsigned refused up front (psktSignOptions).
 * txJsonString reaches the popup unchanged; it returns serializeToSafeJSON.
 */
export const signPsktHandler = signTxFlow(async (payload) => {
  const result = SignPsktPayloadSchema.safeParse(payload);
  if (!result.success) return { error: INVALID_TX_DATA };
  const { txJsonString, options } = result.data;

  let tx;
  try {
    tx = deserializeTransaction(txJsonString);
  } catch {
    return { error: INVALID_TX_DATA };
  }

  const wallet = await ApiUtils.getCurrentWallet();
  const account = await ApiUtils.getCurrentAccount();
  if (!wallet || !account?.address) return { error: RPC_ERRORS.INTERNAL_ERROR };
  try {
    return {
      txJson: txJsonString,
      scripts: psktSignOptions(tx, options?.signInputs, account.address),
      // The hole check ran for this account; the confirm refuses any other
      // (admissionRefusal), version 0 included.
      admittedFor: accountFingerprint(wallet.id, account.index),
    };
  } catch (e) {
    return {
      error: {
        code: RpcErrorCode.INVALID_PARAMS,
        message: e instanceof Error ? e.message : String(e),
      },
    };
  }
}, SIGN_PSKT_METHOD);
