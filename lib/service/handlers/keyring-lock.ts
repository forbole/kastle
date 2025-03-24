import { ExtensionService, Message } from "@/lib/service/extension-service.ts";

export const keyringLock = async (
  _: Message,
  sendResponse: (response: void) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  await keyring.lock();

  sendResponse();
};
