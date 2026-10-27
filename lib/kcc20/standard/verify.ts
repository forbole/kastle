import { covenantSelect } from "@kronsdk/kron-sdk";
import { hexToBytes } from "@noble/hashes/utils";
import {
  addressFromScriptPublicKey,
  payToScriptHashScript,
  RpcClient,
} from "@/wasm/core/kaspa";
import { classifyRedeem, isStandardOwnedBy } from "../classify";
import { liveEntries } from "../live-entries";
import type { KascovCell } from "../providers/kascov";
import type { KCC20State } from "./state";
import type { KronNetwork } from "../index";

export type StandardPiece = {
  tokenId: string;
  outpoint: { transactionId: string; index: number };
  state: KCC20State;
  family: "kcc20-standard";
  // Native KAS the node holds on the outpoint.
  value: bigint;
};

/**
 * The cells our own node and decoder prove: a standard program, held by the
 * node at its P2SH address under `covenantId`, whose decoded amount matches
 * the cell and whose owner is this wallet. Any failed check drops the cell.
 */
export async function verifyStandardCells({
  cells,
  covenantId,
  rpc,
  walletPubkey32,
  network = "mainnet",
}: {
  cells: KascovCell[];
  covenantId: string;
  rpc: RpcClient;
  walletPubkey32: Uint8Array;
  network?: KronNetwork;
}): Promise<StandardPiece[]> {
  const covid = covenantSelect.normalizedCovenantId(covenantId);
  if (!covid) return [];
  const decoded = cells.flatMap((cell) => {
    try {
      const redeem = hexToBytes(cell.programHex);
      const classified = classifyRedeem(redeem);
      if (classified.family !== "kcc20-standard") return [];
      const p2sh = addressFromScriptPublicKey(
        payToScriptHashScript(redeem),
        network,
      )?.toString();
      return p2sh ? [{ cell, state: classified.state, p2sh }] : [];
    } catch {
      // Not a decodable program: nothing to count.
      return [];
    }
  });
  if (decoded.length === 0) return [];

  const live = await liveEntries(rpc, [...new Set(decoded.map((d) => d.p2sh))]);
  return decoded.flatMap(({ cell, state, p2sh }) => {
    const hit = covenantSelect.selectCovenantTokenOutpoint(
      live,
      cell.outpoint,
      covid,
    );
    if (hit?.address !== p2sh) return [];
    if (state.amount !== cell.amount) return [];
    if (!isStandardOwnedBy(state, walletPubkey32)) return [];
    return [
      {
        tokenId: covid,
        outpoint: cell.outpoint,
        state,
        family: "kcc20-standard" as const,
        value: hit.amount,
      },
    ];
  });
}
