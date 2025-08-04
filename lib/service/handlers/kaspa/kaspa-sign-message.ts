import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { getCurrentSigner } from "./utils";

export type KaspaSignMessageRequest = {
  walletId: string;
  accountIndex: number;
  message: string;
};

export type KaspaSignMessageResponse = {
  signedMessage: string; // Serialized signed message
};

export async function kaspaSignMessageHandler(
  { walletId, accountIndex, message }: Message<KaspaSignMessageRequest>,
  sendResponse: (response: KaspaSignMessageResponse) => void,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const signer = await getCurrentSigner(walletId, accountIndex);
  const signedMessage = await signer.signMessage(message);
  sendResponse({ signedMessage });
}
