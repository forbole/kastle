import { sendMessage } from "@/lib/utils.ts";
import { KeyringStatusResponse } from "@/lib/service/handlers/keyring-status.ts";
import { Method } from "@/lib/service/extension-service.ts";
import { KeyringUnlockResponse } from "@/lib/service/handlers/keyring-unlock.ts";
import {
  KeyringGetWalletSecretRequest,
  KeyringGetWalletSecretResponse,
} from "@/lib/service/handlers/keyring-get-wallet-secret.ts";
import { KeyringAddWalletSecretRequest } from "@/lib/service/handlers/keyring-add-wallet-secret.ts";
import { KeyringRemoveWalletSecretRequest } from "@/lib/service/handlers/keyring-remove-wallet-secret.ts";

export const getKeyringStatus = () =>
  sendMessage<KeyringStatusResponse>(Method.KEYRING_STATUS);

export default function useKeyring() {
  return {
    getKeyringStatus,

    keyringInitialize: (password: string) =>
      sendMessage<void>(Method.KEYRING_INITIALIZE, { password }),

    keyringUnlock: (password: string) =>
      sendMessage<KeyringUnlockResponse>(Method.KEYRING_UNLOCK, { password }),

    keyringLock: () => sendMessage<void>(Method.KEYRING_LOCK),

    keyringReset: () => sendMessage<void>(Method.KEYRING_RESET),

    addWalletSecret: (
      keyringAddWalletSecretRequest: KeyringAddWalletSecretRequest,
    ) =>
      sendMessage(
        Method.KEYRING_ADD_WALLET_SECRET,
        keyringAddWalletSecretRequest,
      ),

    removeWalletSecret: (
      keyringGetWalletSecretRequest: KeyringRemoveWalletSecretRequest,
    ) =>
      sendMessage(
        Method.KEYRING_REMOVE_WALLET_SECRET,
        keyringGetWalletSecretRequest,
      ),

    getWalletSecret: (
      keyringGetWalletSecretRequest: KeyringGetWalletSecretRequest,
    ) =>
      sendMessage<KeyringGetWalletSecretResponse>(
        Method.KEYRING_GET_WALLET_SECRET,
        keyringGetWalletSecretRequest,
      ),
  };
}
