import { ExtensionService } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";
import { Hex } from "viem";

export type EvmGetPublicKeyRequest = {
  walletId: string;
  accountIndex: number;
  isLegacy: boolean;
  isKastleLegacy: boolean;
};

export type EvmGetPublicKeyResponse = {
  publicKey: Hex; // Serialized public key
};

export async function evmGetPublicKeyHandler(
  { walletId, accountIndex, isLegacy, isKastleLegacy }: EvmGetPublicKeyRequest,
  sendResponse: (response: EvmGetPublicKeyResponse) => void,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const signer = await getSigner(
    walletId,
    accountIndex,
    isLegacy,
    isKastleLegacy,
  );

  const publicKey = await signer.getPublicKey();
  sendResponse({ publicKey });
}
