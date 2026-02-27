import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { Transaction } from "@/wasm/core/kaspa";
import { getSigner } from "./utils";
import { ScriptOption } from "@/lib/wallet/wallet-interface";

export type KaspaSignTransactionRequest = {
  walletId: string;
  accountIndex: number;
  transactionJSON: string; // Serialized transaction data
  scripts?: ScriptOption[]; // Optional scripts for the transaction
  isLegacy: boolean; // Required to ensure correct signing
};

export type KaspaSignTransactionResponse = {
  signedTransactionJSON: string; // Serialized signed transaction data
};

export async function kaspaSignTransactionHandler(
  {
    walletId,
    accountIndex,
    transactionJSON,
    scripts,
    isLegacy,
  }: Message<KaspaSignTransactionRequest>,
  sendResponse: (response: KaspaSignTransactionResponse) => void,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const transaction = Transaction.deserializeFromSafeJSON(transactionJSON);

  const signer = await getSigner(walletId, accountIndex, isLegacy);
  const signedTransaction = await signer.signTx(transaction, scripts);
  sendResponse({
    signedTransactionJSON: signedTransaction.serializeToSafeJSON(),
  });
}
