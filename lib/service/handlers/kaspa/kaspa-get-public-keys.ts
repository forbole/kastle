import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";

export type KaspaGetPublicKeysRequest = {
  walletId: string;
  accountIndex: number;
  isLegacy: boolean; // Required to ensure correct key derivation
};

export type KaspaGetPublicKeysResponse = {
  publicKeys: string[]; // Serialized public keys
};

export async function kaspaGetPublicKeysHandler(
  { walletId, accountIndex, isLegacy }: Message<KaspaGetPublicKeysRequest>,
  sendResponse: (response: KaspaGetPublicKeysResponse) => void,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const signer = await getSigner(walletId, accountIndex, isLegacy);

  const publicKeys = await signer.getPublicKeys();
  sendResponse({ publicKeys });
}
