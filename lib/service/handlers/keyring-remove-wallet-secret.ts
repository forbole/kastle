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

  await keyring.updateValue<WalletSecret[]>("wallets", (wallets) =>
    (wallets ?? []).filter((wallet) => wallet.id !== walletId),
  );

  sendResponse();
};
