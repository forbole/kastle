import { PublicKey, ScriptBuilder, Transaction } from "@/wasm/core/kaspa";
import { SIGN_TYPE } from "@/lib/kaspa.ts";

export type PaymentOutput = {
  address: string;
  amount: string; // KAS
};

export type ScriptOption = {
  inputIndex: number;
  scriptHex?: string;
  signType?: SignType;
};

export type CommitRevealResult = {
  status: "committing" | "revealing" | "completed";
  commitTxId?: string;
  revealTxId?: string;
  revealTxIds?: string[];
};

export type SignType = keyof typeof SIGN_TYPE;

export interface IWallet {
  getPublicKey(): PublicKey | Promise<PublicKey>;

  getPublicKeys(): string[] | Promise<string[]>;

  signTx(tx: Transaction, scripts?: ScriptOption[]): Promise<Transaction>;

  // Raw 65-byte SIGHASH_ALL signature (sig64 || 0x01) for one input, for
  // callers that place it inside a script themselves. Never mutates `tx`.
  signInputDigest(tx: Transaction, inputIndex: number): Promise<Uint8Array>;

  signMessage(message: string): string | Promise<string>;
}

export interface IWalletWithGetAddress extends IWallet {
  getAddress(): string | Promise<string>;
}

export class LedgerUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerUnsupportedError";
  }
}
