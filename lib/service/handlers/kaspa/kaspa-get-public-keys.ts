import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { getSigner, getCurrentSigner } from "./utils";

export type KaspaGetPublicKeysRequest = {
  walletId: string;
  accountIndex: number;
  isLegacy?: boolean;
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

  const signer =
    isLegacy !== undefined
      ? await getSigner(walletId, accountIndex, isLegacy)
      : await getCurrentSigner(walletId, accountIndex);

  const publicKeys = await signer.getPublicKeys();
  sendResponse({ publicKeys });
}
