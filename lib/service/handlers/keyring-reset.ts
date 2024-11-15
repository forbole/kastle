import { ExtensionService, Message } from "@/lib/service/extension-service.ts";

export const keyringReset = async (
  _: Message<void>,
  sendResponse: (response: void) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  await keyring.clear();

  sendResponse();
};
