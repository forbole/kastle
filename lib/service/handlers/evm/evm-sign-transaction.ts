import { SerializedTransactionReturnType } from "viem";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";
import { Hex, parseTransaction } from "viem";

export interface EvmSignTransactionRequest {
  walletId: string;
  accountIndex: number;
  isLegacy: boolean;
  transaction: SerializedTransactionReturnType;
}

export interface EvmSignTransactionResponse {
  signedTransaction: Hex;
}

export async function evmSignTransactionHandler({
  walletId,
  accountIndex,
  isLegacy,
  transaction,
}: EvmSignTransactionRequest): Promise<EvmSignTransactionResponse> {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const signer = await getSigner(walletId, accountIndex, isLegacy);

  const signedTransaction = await signer.signTransaction(
    parseTransaction(transaction),
  );
  return { signedTransaction };
}
