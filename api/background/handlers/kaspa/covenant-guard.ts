import { ApiUtils } from "@/api/background/utils";
import { RPC_ERRORS, RpcError } from "@/api/message";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  CovenantScanRefusal,
  decodeCovenantRequest,
  uncheckedSignedInput,
} from "@/lib/kcc20/dapp-request";
import { accountFingerprint } from "./utils";
import { walletKcc20Pieces } from "@/lib/kcc20/wallet-pieces";
import type { ScriptOption } from "@/lib/wallet/wallet-interface.ts";
import { normalizeScriptOptions } from "@/lib/wallet/sign-script";

/**
 * Why a covenant (version 1+) dApp request must be refused, or undefined when
 * it decodes against the wallet's KCC-20 pieces and every input the wallet
 * would sign is its own plain coin or a verified piece. Fail closed: any
 * failure refuses rather than open a screen that cannot tell.
 * The popup re-runs the decode itself; nothing here reaches it.
 * Standard pieces are always scanned (kascov, mainnet only): the
 * standard-family flag gates display, not this guard.
 */
export const COVENANT_TOKENS_UNREADABLE: RpcError = {
  code: RPC_ERRORS.COVENANT_TX_UNDECODABLE.code,
  message: "Kastle could not read your tokens — try again",
};

/**
 * The one admission path for both handlers: a refusal, or the fingerprint of
 * the account the request was checked for. The popup compares it with the
 * selected account before signing (admissionRefusal).
 */
export async function covenantAdmission(
  txJson: string,
  scripts: ScriptOption[],
): Promise<{ refusal: RpcError } | { admittedFor: string }> {
  try {
    const wallet = await ApiUtils.getCurrentWallet();
    const account = await ApiUtils.getCurrentAccount();
    if (!wallet || !account?.address)
      return { refusal: RPC_ERRORS.COVENANT_TX_UNDECODABLE };
    const { networkId } = await ApiUtils.getSettings();
    const rpc = await ApiUtils.connectKaspaRpcClient();
    try {
      // An outage is not a bad request: say so, distinctly. A scan that
      // finished but must not be signed against says why; retrying won't help.
      const pieces = await walletKcc20Pieces(account.address, rpc, {
        network: networkId,
        standard: true,
      }).catch((e) => (e instanceof CovenantScanRefusal ? e : undefined));
      if (pieces instanceof CovenantScanRefusal)
        return {
          refusal: {
            code: RPC_ERRORS.COVENANT_TX_UNDECODABLE.code,
            message: `${pieces.message}.`,
          },
        };
      if (!pieces) return { refusal: COVENANT_TOKENS_UNREADABLE };
      const tx = deserializeTransaction(txJson);
      if (!decodeCovenantRequest(tx, pieces, networkId).ok)
        return { refusal: RPC_ERRORS.COVENANT_TX_UNDECODABLE };
      const unchecked = uncheckedSignedInput(
        tx,
        pieces,
        // The signer's own parse: a malformed option throws, and refuses.
        normalizeScriptOptions(scripts).map((s) => s.inputIndex),
        account.address,
        networkId,
        wallet.type === "ledger",
      );
      return unchecked
        ? {
            refusal: {
              code: RPC_ERRORS.COVENANT_TX_UNDECODABLE.code,
              message: `Kastle will not sign this covenant transaction: ${unchecked}.`,
            },
          }
        : { admittedFor: accountFingerprint(wallet.id, account.index) };
    } finally {
      await rpc.disconnect();
    }
  } catch {
    return { refusal: RPC_ERRORS.COVENANT_TX_UNDECODABLE };
  }
}
