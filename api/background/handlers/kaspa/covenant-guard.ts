import { ApiUtils } from "@/api/background/utils";
import { RPC_ERRORS, RpcError } from "@/api/message";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import {
  decodeCovenantRequest,
  uncheckedSignedInput,
} from "@/lib/kcc20/dapp-request";
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
export async function covenantRequestRefusal(
  txJson: string,
  scripts: ScriptOption[],
): Promise<RpcError | undefined> {
  try {
    const account = await ApiUtils.getCurrentAccount();
    if (!account?.address) return RPC_ERRORS.COVENANT_TX_UNDECODABLE;
    const { networkId } = await ApiUtils.getSettings();
    const rpc = await ApiUtils.connectKaspaRpcClient();
    try {
      const pieces = await walletKcc20Pieces(account.address, rpc, {
        network: networkId,
        standard: true,
      });
      const tx = deserializeTransaction(txJson);
      if (!decodeCovenantRequest(tx, pieces, networkId).ok)
        return RPC_ERRORS.COVENANT_TX_UNDECODABLE;
      const unchecked = uncheckedSignedInput(
        tx,
        pieces,
        // The signer's own parse: a malformed option throws, and refuses.
        normalizeScriptOptions(scripts).map((s) => s.inputIndex),
        account.address,
        networkId,
      );
      return unchecked
        ? {
            code: RPC_ERRORS.COVENANT_TX_UNDECODABLE.code,
            message: `Kastle will not sign this covenant transaction: ${unchecked}.`,
          }
        : undefined;
    } finally {
      await rpc.disconnect();
    }
  } catch {
    return RPC_ERRORS.COVENANT_TX_UNDECODABLE;
  }
}
