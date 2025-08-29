import { ExtensionService } from "@/lib/service/extension-service.ts";
import { getSigner } from "./utils";
import { Hex } from "viem";

export type EvmSignMessageRequest = {
  walletId: string;
  accountIndex: number;
  isLegacy: boolean;
  message: string;
};

export type EvmSignMessageResponse = {
  signature: Hex; // Serialized message signature
};

export async function evmSignMessageHandler(
  { walletId, accountIndex, isLegacy, message }: EvmSignMessageRequest,
  sendResponse: (response: EvmSignMessageResponse) => void,
) {
  const extensionService = ExtensionService.getInstance();
  const keyring = extensionService.getKeyring();

  const isInitialized = await keyring.isInitialized();
  const isUnlocked = keyring.isUnlocked();

  if (!isInitialized || !isUnlocked) {
    throw new Error("Keyring not initialized or locked");
  }

  const signer = await getSigner(walletId, accountIndex, isLegacy);

  const signature = await signer.signMessage(message);
  sendResponse({ signature });
}
