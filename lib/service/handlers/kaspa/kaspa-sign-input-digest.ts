import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";
import { deserializeTransaction } from "@/lib/kaspa-compat";
import { bytesToHex } from "@noble/hashes/utils";

export type KaspaSignInputDigestRequest = {
  walletId: string;
  accountIndex: number;
  networkId: string;
  transactionJSON: string; // Serialized transaction data
  inputIndex: number;
  isLegacy: boolean; // Required to ensure correct signing
};

export type KaspaSignInputDigestResponse = {
  signatureHex: string; // 65 bytes: 64-byte Schnorr signature || SIGHASH_ALL
};

export async function kaspaSignInputDigestHandler(
  {
    walletId,
    accountIndex,
    transactionJSON,
    inputIndex,
    isLegacy,
  }: Message<KaspaSignInputDigestRequest>,
  sendResponse: (response: KaspaSignInputDigestResponse) => void,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const transaction = deserializeTransaction(transactionJSON);

  const signer = await getSigner(walletId, accountIndex, isLegacy);
  const signature = await signer.signInputDigest(transaction, inputIndex);
  sendResponse({ signatureHex: bytesToHex(signature) });
}
