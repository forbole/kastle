import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { WalletSecret } from "@/types/WalletSecret.ts";

export type KeyringGetWalletSecretRequest = {
  walletId: string;
  password: string;
};

export type KeyringGetWalletSecretResponse = {
  walletSecret: WalletSecret;
};

export const keyringGetWalletSecret = async (
  { walletId, password }: Message<KeyringGetWalletSecretRequest>,
  sendResponse: (response: KeyringGetWalletSecretResponse) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const isValid = await keyring.checkPassword(password);
  if (!isValid) {
    throw new Error("Invalid password");
  }

  const wallets = (await keyring.getValue<WalletSecret[]>("wallets")) ?? [];
  const walletSecret = wallets.find((w) => w.id === walletId);

  if (!walletSecret) {
    throw new Error(`Unable to find wallet secret for wallet ID ${walletId}`);
  }

  sendResponse({ walletSecret });
};
