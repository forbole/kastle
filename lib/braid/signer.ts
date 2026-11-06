import type { Signer } from "@braid_swap/sdk";
import { schnorrSighash } from "@dotk/sdk-tx";
import { schnorr } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/hashes/utils";
import { hex, signV1Input } from "@/lib/kcc20/sign-v1";
import { braidWalletJsonToTx } from "@/lib/braid/adapter";
import { LegacyHotWalletAccount } from "@/lib/wallet/account/hot-wallet-account";
import { HotWalletPrivateKey } from "@/lib/wallet/account/hot-wallet-private-key";
import { KCC20_LEDGER_UNSUPPORTED_MESSAGE } from "@/lib/wallet/sign-script";
import {
  type IWallet,
  LedgerUnsupportedError,
} from "@/lib/wallet/wallet-interface";

/** A pre-sign check failed: nothing was signed. */
export class BraidSignRefusal extends Error {
  // The bare check that failed, so the background can hand it to the popup.
  readonly reason: string;
  constructor(message: string) {
    super(`Braid deposit not signed: ${message}`);
    this.name = "BraidSignRefusal";
    this.reason = message;
  }
}

const refuse = (message: string): never => {
  throw new BraidSignRefusal(message);
};

/** What the SDK hands `signDeposit`. */
export type BraidDeposit = Parameters<Signer["signDeposit"]>[0];

/**
 * Braid SDK signer over a Kastle account key. Signs exactly the deposit's
 * `signInputs`, each only after its locally recomputed v1 SIGHASH_ALL digest
 * matches the one the SDK prepared, and answers 64-byte Schnorr signatures
 * that verify under `xOnlyPk`. The key buffer is zeroed after use.
 * Build it for an account with `braidSignerFor`, which refuses Ledger.
 */
export function kastleBraidSigner(
  getKey: () => Promise<Uint8Array>,
  xOnlyPk: string,
): Signer {
  const pk = xOnlyPk.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(pk))
    refuse("public key is not 32-byte x-only hex");

  return {
    async getPublicKey() {
      return pk;
    },

    async signDeposit(p: BraidDeposit) {
      if (p.userPublicKey?.toLowerCase() !== pk) {
        refuse("the deposit was prepared for another key");
      }
      const tx = braidWalletJsonToTx(p.walletJson);
      if (tx.version !== 1) refuse(`transaction version ${tx.version}, not 1`);

      const indices = p.signInputs;
      if (!Array.isArray(indices) || !indices.length)
        refuse("no inputs to sign");
      if (new Set(indices).size !== indices.length)
        refuse("an input is listed twice");
      const digests = indices.map((i) => {
        if (!Number.isInteger(i) || i < 0 || i >= tx.inputs.length) {
          refuse(`input ${i} is not in the transaction`);
        }
        if (tx.inputs[i].signatureScript !== "")
          refuse(`input ${i} is not blank`);
        const digest = schnorrSighash(tx, i);
        const prepared = p.sighashes?.[i];
        if (
          typeof prepared !== "string" ||
          prepared.toLowerCase() !== hex(digest)
        ) {
          refuse(`input ${i} sighash does not match the prepared one`);
        }
        return digest;
      });

      const priv = await getKey();
      try {
        const out: Record<number, string> = {};
        indices.forEach((i, n) => {
          const sig = signV1Input(tx, i, priv).slice(2, 130);
          if (!schnorr.verify(sig, digests[n], pk)) {
            refuse(`input ${i} signature does not verify under the wallet key`);
          }
          out[i] = sig;
        });
        return out;
      } finally {
        priv.fill(0);
      }
    },
  };
}

/**
 * The Braid signer for a Kastle account. Only a hot key can sign: Ledger
 * cannot return a raw signature for a deposit input, so any other account
 * is refused here, before a deposit can reach it.
 */
export function braidSignerFor(account: IWallet, xOnlyPk: string): Signer {
  if (
    !(account instanceof LegacyHotWalletAccount) &&
    !(account instanceof HotWalletPrivateKey)
  ) {
    throw new LedgerUnsupportedError(KCC20_LEDGER_UNSUPPORTED_MESSAGE);
  }
  return kastleBraidSigner(async () => {
    // The key is read only after every pre-sign check passed.
    const key = account.getPrivateKeyString();
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error("Braid: the account key is not 32-byte hex");
    }
    return hexToBytes(key);
  }, xOnlyPk);
}
