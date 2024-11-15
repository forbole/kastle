import { ExtensionService, Message } from "@/lib/service/extension-service.ts";

export type KeyringStatusResponse = {
  isInitialized: boolean;
  isUnlocked: boolean;
};

export const keyringStatusHandler = async (
  _: Message,
  sendResponse: (response: KeyringStatusResponse) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  sendResponse({
    isInitialized: await keyring.isInitialized(),
    isUnlocked: keyring.isUnlocked(),
  });
};
