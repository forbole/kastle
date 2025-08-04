import { SignTypedDataParameters } from "viem";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";
import { Hex } from "viem";

export interface EvmSignTypedDataRequest {
  walletId: string;
  accountIndex: number;
  isLegacy: boolean;
  data: SignTypedDataParameters;
}

export interface EvmSignTypedDataResponse {
  signature: Hex;
}

export async function evmSignTypedDataHandler({
  walletId,
  accountIndex,
  isLegacy,
  data,
}: EvmSignTypedDataRequest): Promise<EvmSignTypedDataResponse> {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const signer = await getSigner(walletId, accountIndex, isLegacy);
  const signature = await signer.signTypedData(data);
  return { signature };
}
