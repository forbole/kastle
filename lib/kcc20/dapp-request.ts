import {
  addressFromScriptPublicKey,
  payToAddressScript,
  Transaction,
  TransactionInput,
} from "@/wasm/core/kaspa";
import type { Kcc20Family } from "./index";

/** Where the standard family can be read (kascov serves mainnet only). */
export const canReadStandardKcc20 = (network: string) => network === "mainnet";

/** A KCC-20 piece the wallet holds, as the dApp sign guard matches it against a request's inputs. */
/**
 * A scan that finished but must not be signed against: a token cap, a held-back
 * cell list, a claimed-versus-verified mismatch. Its message is the refusal the
 * dApp sees; retrying will not change it, unlike a failed read.
 */
export class CovenantScanRefusal extends Error {}

/** Refusal text when a Ledger account is asked to sign a covenant request with a foreign input. */
export const LEDGER_FOREIGN_INPUT =
  "this request needs a signer that can verify the pieces, and a Ledger signs every input of the transaction";

export type WalletKcc20Piece = {
  outpoint: { transactionId: string; index: number };
  covenantId: string;
  family: Kcc20Family;
  extensionCommitment?: string;
  amount: bigint;
  // sompi the node holds on the outpoint, never the request's claim
  value: bigint;
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
  // base units, from the piece state: the WHOLE piece leaving, not the net
  amount: bigint;
  // sompi the piece's UTXO holds (node-checked), moving with the token
  value: bigint;
  // address null: the output is authorized but its script spells no address.
  destinations: { address: string | null; outputIndex: number }[];
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
      // The page's entry and the verified piece must agree, or the fee is the page's alone.
      if (input.utxo?.amount !== piece.value)
        throw new Error(
          `input ${inputIndex} states ${input.utxo?.amount ?? "no"} sompi; the verified piece holds ${piece.value}`,
        );
      const destinations: DappTokenMovement["destinations"] = [];
      outputs.forEach((output, outputIndex) => {
        if (output.covenant?.authorizingInput !== inputIndex) return;
        // An unresolvable script is kept as null, never given an invented address.
        const address =
          addressFromScriptPublicKey(
            output.scriptPublicKey,
            network,
          )?.toString() || null;
        destinations.push({ address, outputIndex });
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
        value: piece.value,
        destinations,
      });
    });
    return { ok: true, movements };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * The one ownership rule: the input spends a UTXO locked to the wallet's own
 * P2PK script (`payToAddressScript(address).script`), which is what the
 * signer's unscripted fallback signs. Shared by this guard and signPskt.
 */
export const paysWalletScript = (
  input: TransactionInput,
  walletScript: string,
) => input.utxo?.scriptPublicKey.script === walletScript;

/**
 * Why the wallet must not sign: an input it is asked to sign with a script
 * (`scripted`) that is neither its own plain P2PK coin nor a verified piece.
 * Unscripted inputs are signed only when the key owns them (the P2PK
 * fallback), so they are the wallet's plain coins by construction.
 * Undefined: every signed input is checked. Pure.
 * `ledger`: the Ledger signer signs EVERY input (ledger-account.ts), so the
 * fallback assumption does not hold: any input that is not the wallet's own
 * script, scripted or not, refuses.
 */
export function uncheckedSignedInput(
  tx: Transaction,
  pieces: WalletKcc20Piece[],
  scripted: number[],
  walletAddress: string,
  network: string,
  ledger = false,
): string | undefined {
  const held = new Set(
    pieces.map((p) => `${p.outpoint.transactionId}:${p.outpoint.index}`),
  );
  const walletScript = payToAddressScript(walletAddress).script;
  const inputs = tx.inputs;
  for (const i of scripted) if (!inputs[i]) return `input ${i} does not exist`;
  const signed = new Set(scripted);
  // Every input visited: the P2PK fallback signs a wallet-script input unscripted.
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    if (ledger && !paysWalletScript(input, walletScript))
      return `${LEDGER_FOREIGN_INPUT} (input ${i} is not your own coin)`;
    const { transactionId, index } = input.previousOutpoint;
    if (held.has(`${transactionId}:${index}`)) continue;
    const utxo = input.utxo;
    // A lied-about entry only breaks the signature: the sighash commits to it.
    const covenantId = utxo?.entry.covenantId?.toString();
    const mine = paysWalletScript(input, walletScript);
    // Wallet script plus a covenant id is token state, not a plain coin.
    if (mine && !covenantId) continue;
    // Neither scripted nor ours: another party's input, never signed here.
    if (!mine && !signed.has(i)) continue;
    if (!covenantId)
      return `input ${i} is not your own coin or a KCC-20 token Kastle verified`;
    return canReadStandardKcc20(network)
      ? `input ${i} spends a token state (${covenantId}) that is not one Kastle verified as yours`
      : `input ${i} spends a token state (${covenantId}) and Kastle cannot check standard KCC-20 tokens on ${network}`;
  }
}
