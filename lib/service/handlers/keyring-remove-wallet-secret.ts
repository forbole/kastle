import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { WalletSecret } from "@/types/WalletSecret.ts";

export type KeyringRemoveWalletSecretRequest = { walletId: string };

export const keyringRemoveWalletSecret = async (
  { walletId }: Message<KeyringRemoveWalletSecretRequest>,
  sendResponse: (response: void) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const walletSecrets =
    (await keyring.getValue<WalletSecret[]>("wallets")) ?? [];
  const wallets = walletSecrets.filter((w) => w.id !== walletId);

  await keyring.setValue<WalletSecret[]>("wallets", wallets);

  sendResponse();
};
