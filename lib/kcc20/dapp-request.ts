import { addressFromScriptPublicKey, Transaction } from "@/wasm/core/kaspa";
import type { Kcc20Family } from "./index";

/** A KCC-20 piece the wallet holds, as the dApp sign guard matches it against a request's inputs. */
export type WalletKcc20Piece = {
  outpoint: { transactionId: string; index: number };
  covenantId: string;
  family: Kcc20Family;
  extensionCommitment?: string;
  amount: bigint;
  // "" when unknown; display only.
  symbol: string;
  decimals?: number;
};

export type DappTokenMovement = {
  inputIndex: number;
  // hex, no 0x
  covenantId: string;
  family: Kcc20Family;
  // standard only
  extensionCommitment?: string;
  // "" -> the UI shows the short covenant id
  symbol: string;
  // undefined -> the UI shows base units and says so
  decimals?: number;
  // base units, from the piece state
  amount: bigint;
  destinations: { address: string; outputIndex: number }[];
};

export type DappCovenantDecode =
  | { ok: true; movements: DappTokenMovement[] }
  | { ok: false; reason: string };

/**
 * The wallet's KCC-20 pieces a dApp transaction spends, each with the outputs
 * its input authorizes. Zero movements is a valid answer: a buy, a launch or a
 * liquidity withdrawal spends only KAS. Pure: no fetches, no storage.
 */
export function decodeCovenantRequest(
  tx: Transaction,
  pieces: WalletKcc20Piece[],
  // addressFromScriptPublicKey needs the network to spell an address.
  network: string,
): DappCovenantDecode {
  try {
    const held = new Map(
      pieces.map((p) => [`${p.outpoint.transactionId}:${p.outpoint.index}`, p]),
    );
    const outputs = tx.outputs;
    const movements: DappTokenMovement[] = [];
    tx.inputs.forEach((input, inputIndex) => {
      const { transactionId, index } = input.previousOutpoint;
      const piece = held.get(`${transactionId}:${index}`);
      if (!piece) return;
      const destinations: DappTokenMovement["destinations"] = [];
      outputs.forEach((output, outputIndex) => {
        if (output.covenant?.authorizingInput !== inputIndex) return;
        // An unresolvable script is skipped, never given an invented address.
        const address = addressFromScriptPublicKey(
          output.scriptPublicKey,
          network,
        )?.toString();
        if (address) destinations.push({ address, outputIndex });
      });
      movements.push({
        inputIndex,
        covenantId: piece.covenantId,
        family: piece.family,
        ...(piece.extensionCommitment !== undefined && {
          extensionCommitment: piece.extensionCommitment,
        }),
        symbol: piece.symbol,
        ...(piece.decimals !== undefined && { decimals: piece.decimals }),
        amount: piece.amount,
        destinations,
      });
    });
    return { ok: true, movements };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
