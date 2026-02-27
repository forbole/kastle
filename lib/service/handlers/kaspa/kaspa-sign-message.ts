import { ExtensionService, Message } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";

export type KaspaSignMessageRequest = {
  walletId: string;
  accountIndex: number;
  message: string;
  isLegacy: boolean; // Required to ensure correct signing
};

export type KaspaSignMessageResponse = {
  signedMessage: string; // Serialized signed message
};

export async function kaspaSignMessageHandler(
  {
    walletId,
    accountIndex,
    message,
    isLegacy,
  }: Message<KaspaSignMessageRequest>,
  sendResponse: (response: KaspaSignMessageResponse) => void,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const signer = await getSigner(walletId, accountIndex, isLegacy);
  const signedMessage = await signer.signMessage(message);
  sendResponse({ signedMessage });
}
