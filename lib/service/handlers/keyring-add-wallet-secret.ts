import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { WalletSecret } from "@/types/WalletSecret.ts";

export type KeyringAddWalletSecretRequest = WalletSecret;

export const keyringAddWalletSecret = async (
  walletSecret: Message<KeyringAddWalletSecretRequest>,
  sendResponse: (response: void) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const wallets = (await keyring.getValue<WalletSecret[]>("wallets")) ?? [];
  await keyring.setValue<WalletSecret[]>("wallets", [...wallets, walletSecret]);

  sendResponse();
};
