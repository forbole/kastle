import { SIGHASH_ALL, schnorrSighash, type Tx } from "@dotk/sdk-tx";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

/** Lowercase hex of `b`, without a `0x` prefix. */
export const hex = (b: Uint8Array) => bytesToHex(b);

/**
 * P2PK signature script (`41 ‖ sig64 ‖ 01`) for input `index` of `tx`:
 * BIP-340 Schnorr over its SIGHASH_ALL digest. The caller owns `priv`.
 */
export function signV1Input(tx: Tx, index: number, priv: Uint8Array): string {
  const sig = new Uint8Array(65);
  sig.set(schnorr.sign(schnorrSighash(tx, index), priv));
  sig[64] = SIGHASH_ALL;
  return "41" + hex(sig);
}
