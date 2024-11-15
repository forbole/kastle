import { ExtensionService, Message } from "@/lib/service/extension-service.ts";

export type KeyringUnlockResponse = { success: boolean };

export const keyringUnlock = async (
  message: Message<{ password: string }>,
  sendResponse: (response: KeyringUnlockResponse) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const success = await keyring.unlock(message.password);

  sendResponse({ success });
};
