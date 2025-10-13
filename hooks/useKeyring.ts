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
import {
  KeyringCheckPasswordRequest,
  KeyringCheckPasswordResponse,
} from "@/lib/service/handlers/keyring-check-password.ts";
import {
  KeyringChangePasswordRequest,
  KeyringChangePasswordResponse,
} from "@/lib/service/handlers/keyring-change-password.ts";
import { ErrorMessage } from "@/lib/service/handlers/message";

export const getKeyringStatus = () =>
  sendMessage<KeyringStatusResponse>(Method.KEYRING_STATUS);

export default function useKeyring() {
  return {
    getKeyringStatus,

    keyringInitialize: async (password: string) => {
      const response = await sendMessage<void | ErrorMessage>(
        Method.KEYRING_INITIALIZE,
        { password },
      );
      if (response && "error" in response) {
        throw new Error(response.error);
      }
    },

    keyringUnlock: async (password: string) => {
      const response = await sendMessage<KeyringUnlockResponse | ErrorMessage>(
        Method.KEYRING_UNLOCK,
        {
          password,
        },
      );
      if (response && "error" in response) {
        throw new Error(response.error);
      }
      return response;
    },

    keyringLock: () => sendMessage<void>(Method.KEYRING_LOCK),

    keyringCheckPassword: async (
      keyringCheckPasswordRequest: KeyringCheckPasswordRequest,
    ) => {
      const response = await sendMessage<
        KeyringCheckPasswordResponse | ErrorMessage
      >(Method.KEYRING_CHECK_PASSWORD, keyringCheckPasswordRequest);
      if (response && "error" in response) {
        throw new Error(response.error);
      }
      return response;
    },

    keyringChangePassword: async (
      keyringChangePasswordRequest: KeyringChangePasswordRequest,
    ) => {
      const response = await sendMessage<
        KeyringChangePasswordResponse | ErrorMessage
      >(Method.KEYRING_CHANGE_PASSWORD, keyringChangePasswordRequest);

      if (response && "error" in response) {
        throw new Error(response.error);
      }
      return response;
    },

    keyringReset: async () => {
      const response = await sendMessage<void | ErrorMessage>(
        Method.KEYRING_RESET,
      );
      if (response && "error" in response) {
        throw new Error(response.error);
      }
    },

    addWalletSecret: async (
      keyringAddWalletSecretRequest: KeyringAddWalletSecretRequest,
    ) => {
      const response = await sendMessage<void | ErrorMessage>(
        Method.KEYRING_ADD_WALLET_SECRET,
        keyringAddWalletSecretRequest,
      );

      if (response && "error" in response) {
        throw new Error(response.error);
      }
    },

    removeWalletSecret: async (
      keyringGetWalletSecretRequest: KeyringRemoveWalletSecretRequest,
    ) => {
      const response = await sendMessage<void | ErrorMessage>(
        Method.KEYRING_REMOVE_WALLET_SECRET,
        keyringGetWalletSecretRequest,
      );
      if (response && "error" in response) {
        throw new Error(response.error);
      }
    },

    getWalletSecret: async (
      keyringGetWalletSecretRequest: KeyringGetWalletSecretRequest,
    ) => {
      const response = await sendMessage<
        KeyringGetWalletSecretResponse | ErrorMessage
      >(Method.KEYRING_GET_WALLET_SECRET, keyringGetWalletSecretRequest);

      if ("error" in response) {
        throw new Error(response.error);
      }

      return response;
    },
  };
}
