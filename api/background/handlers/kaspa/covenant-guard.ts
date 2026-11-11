import { ApiUtils } from "@/api/background/utils";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import { decodeCovenantRequest } from "@/lib/kcc20/dapp-request";
import { walletKcc20Pieces } from "@/lib/kcc20/wallet-pieces";

/**
 * Whether a covenant (version 1+) dApp request decodes against the wallet's
 * KCC-20 pieces, so the confirm screen can show what it moves. Any failure is
 * false: the handler refuses rather than open a screen that cannot tell.
 * The popup re-runs the decode itself; nothing here reaches it.
 * Standard pieces are always scanned (kascov, mainnet only): the
 * standard-family flag gates display, not this guard.
 */
export async function canDecodeCovenantRequest(
  txJson: string,
): Promise<boolean> {
  try {
    const account = await ApiUtils.getCurrentAccount();
    if (!account?.address) return false;
    const { networkId } = await ApiUtils.getSettings();
    const rpc = await ApiUtils.connectKaspaRpcClient();
    try {
      const pieces = await walletKcc20Pieces(account.address, rpc, {
        network: networkId,
        standard: true,
      });
      return decodeCovenantRequest(
        deserializeTransaction(txJson),
        pieces,
        networkId,
      ).ok;
    } finally {
      await rpc.disconnect();
    }
  } catch {
    return false;
  }
}
