import { ExtensionService, Message } from "@/lib/service/extension-service.ts";

export const keyringInitialize = async (
  message: Message<{ password: string }>,
  sendResponse: (response: void) => void,
) => {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  await keyring.initialize(message.password);

  sendResponse();
};
