import { SignTypedDataParameters } from "viem";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";
import { Hex } from "viem";
import z from "zod";

export const signTypedDataSchema = z.custom<SignTypedDataParameters>();

export interface EvmSignTypedDataRequest {
  walletId: string;
  accountIndex: number;
  isLegacy: boolean;
  data: string;
}

export interface EvmSignTypedDataResponse {
  signature: Hex;
}

export async function evmSignTypedDataHandler(
  { walletId, accountIndex, isLegacy, data }: EvmSignTypedDataRequest,
  sendResponse: (response: EvmSignTypedDataResponse) => void,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const parsed = signTypedDataSchema.safeParse(JSON.parse(data));

  if (!parsed.success) {
    throw new Error("Invalid data");
  }

  const signer = await getSigner(walletId, accountIndex, isLegacy);
  const signature = await signer.signTypedData(parsed.data);
  sendResponse({ signature });
}
