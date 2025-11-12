import { SignTypedDataParameters } from "viem";
import { ExtensionService } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";
import { Hex } from "viem";
import z from "zod";

export const signTypedDataSchema = z.custom<SignTypedDataParameters>();

export interface EvmSignTypedDataRequest {
  walletId: string;
  accountIndex: number;
  data: string;

  isLegacy: boolean;
  isKastleLegacy: boolean;
}

export interface EvmSignTypedDataResponse {
  signature: Hex;
}

export async function evmSignTypedDataHandler(
  {
    walletId,
    accountIndex,
    isLegacy,
    isKastleLegacy,
    data,
  }: EvmSignTypedDataRequest,
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
    throw new Error(
      `Invalid data: ${parsed.error ? parsed.error.message : "Unknown validation error"}`,
    );
  }

  const signer = await getSigner(
    walletId,
    accountIndex,
    isLegacy,
    isKastleLegacy,
  );
  const signature = await signer.signTypedData(parsed.data);
  sendResponse({ signature });
}
