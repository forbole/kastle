import { ExtensionService, Message } from "@/lib/service/extension-service.ts";

export type KeyringCheckPasswordRequest = { password: string };
export type KeyringCheckPasswordResponse = { success: boolean };

export const keyringCheckPassword = async (
  message: Message<KeyringCheckPasswordRequest>,
  sendResponse: (response: KeyringCheckPasswordResponse) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const success = await keyring.checkPassword(message.password);

  sendResponse({ success });
};
