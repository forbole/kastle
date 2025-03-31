import { ExtensionService, Message } from "@/lib/service/extension-service.ts";

export type KeyringChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};
export type KeyringChangePasswordResponse = { success: boolean };

export const keyringChangePassword = async (
  message: Message<KeyringChangePasswordRequest>,
  sendResponse: (response: KeyringChangePasswordResponse) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const success = await keyring.changePassword(
    message.currentPassword,
    message.newPassword,
  );

  sendResponse({ success });
};
