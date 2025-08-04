import { Keyring } from "@/lib/keyring-manager.ts";
import { keyringStatusHandler } from "@/lib/service/handlers/keyring-status.ts";
import { keyringInitialize } from "@/lib/service/handlers/keyring-initialize.ts";
import { keyringUnlock } from "@/lib/service/handlers/keyring-unlock.ts";
import { keyringLock } from "@/lib/service/handlers/keyring-lock.ts";
import { AutoLockManager } from "@/lib/auto-lock-manager.ts";
import { keyringAddWalletSecret } from "@/lib/service/handlers/keyring-add-wallet-secret.ts";
import { keyringGetWalletSecret } from "@/lib/service/handlers/keyring-get-wallet-secret.ts";
import { keyringReset } from "@/lib/service/handlers/keyring-reset.ts";
import { keyringRemoveWalletSecret } from "@/lib/service/handlers/keyring-remove-wallet-secret.ts";
import { reopenPopup } from "@/lib/service/handlers/reopenPopup.ts";
import { keyringCheckPassword } from "@/lib/service/handlers/keyring-check-password.ts";
import { keyringChangePassword } from "@/lib/service/handlers/keyring-change-password.ts";
import { kaspaSignTransactionHandler } from "./handlers/kaspa/kaspa-sign-transaction";
import { kaspaSignMessageHandler } from "./handlers/kaspa/kaspa-sign-message.ts";
import { kaspaGetPublicKeysHandler } from "./handlers/kaspa/kaspa-get-public-keys.ts";
import { ErrorMessage } from "./handlers/message.ts";
import { evmGetPublicKeyHandler } from "./handlers/evm/evm-get-public-key.ts";
import { evmSignTransactionHandler } from "./handlers/evm/evm-sign-transaction.ts";
import { evmSignTypedDataHandler } from "./handlers/evm/evm-sign-typed-data.ts";
import { evmSignMessageHandler } from "./handlers/evm/evm-sign-message.ts";

export enum Method {
  KEYRING_STATUS = "KEYRING_STATUS",
  KEYRING_INITIALIZE = "KEYRING_INITIALIZE",
  KEYRING_UNLOCK = "KEYRING_UNLOCK",
  KEYRING_LOCK = "KEYRING_LOCK",
  KEYRING_ADD_WALLET_SECRET = "KEYRING_ADD_WALLET_SECRET",
  KEYRING_REMOVE_WALLET_SECRET = "KEYRING_REMOVE_WALLET_SECRET",
  KEYRING_GET_WALLET_SECRET = "KEYRING_GET_WALLET_SECRET",
  KEYRING_RESET = "KEYRING_RESET",
  KEYRING_CHECK_PASSWORD = "KEYRING_CHECK_PASSWORD",
  KEYRING_CHANGE_PASSWORD = "KEYRING_CHANGE_PASSWORD",
  REOPEN_POPUP = "REOPEN_POPUP",

  KASPA_SIGN_TRANSACTION = "KEYRING_KASPA_SIGN_TRANSACTION",
  KASPA_SIGN_MESSAGE = "KEYRING_KASPA_SIGN_MESSAGE",
  KASPA_GET_PUBLIC_KEYS = "KEYRING_KASPA_GET_PUBLIC_KEYS",

  EVM_SIGN_TRANSACTION = "KEYRING_EVM_SIGN_TRANSACTION",
  EVM_SIGN_MESSAGE = "KEYRING_EVM_SIGN_MESSAGE",
  EVM_SIGN_TYPED_DATA = "KEYRING_EVM_SIGN_TYPED_DATA",
  EVM_GET_PUBLIC_KEY = "KEYRING_EVM_GET_PUBLIC_KEY",
}

export type Message<T = object> = {
  method: Method;
} & T;

export class ExtensionService {
  private static instance: ExtensionService | null = null;
  private readonly keyring = new Keyring();
  private readonly autoLockManager = new AutoLockManager();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  private readonly handlers: Record<Method, Function>;

  constructor() {
    this.handlers = {
      [Method.KEYRING_STATUS]: keyringStatusHandler,
      [Method.KEYRING_INITIALIZE]: keyringInitialize,
      [Method.KEYRING_UNLOCK]: keyringUnlock,
      [Method.KEYRING_LOCK]: keyringLock,
      [Method.KEYRING_ADD_WALLET_SECRET]: keyringAddWalletSecret,
      [Method.KEYRING_REMOVE_WALLET_SECRET]: keyringRemoveWalletSecret,
      [Method.KEYRING_GET_WALLET_SECRET]: keyringGetWalletSecret,
      [Method.KEYRING_CHECK_PASSWORD]: keyringCheckPassword,
      [Method.KEYRING_CHANGE_PASSWORD]: keyringChangePassword,
      [Method.KEYRING_RESET]: keyringReset,
      [Method.REOPEN_POPUP]: reopenPopup,

      [Method.KASPA_SIGN_TRANSACTION]: kaspaSignTransactionHandler,
      [Method.KASPA_SIGN_MESSAGE]: kaspaSignMessageHandler,
      [Method.KASPA_GET_PUBLIC_KEYS]: kaspaGetPublicKeysHandler,

      [Method.EVM_SIGN_TRANSACTION]: evmSignTransactionHandler,
      [Method.EVM_SIGN_TYPED_DATA]: evmSignTypedDataHandler,
      [Method.EVM_GET_PUBLIC_KEY]: evmGetPublicKeyHandler,
      [Method.EVM_SIGN_MESSAGE]: evmSignMessageHandler,
    };
  }

  public static getInstance(): ExtensionService {
    if (!ExtensionService.instance) {
      ExtensionService.instance = new ExtensionService();
    }
    return ExtensionService.instance;
  }

  public startListening(): void {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!this.isMethod(message)) {
        return;
      }

      const handler = this.handlers[message.method];

      // FIXME improve typings
      handler(message, sendResponse).catch((error: Error) => {
        console.error(`Error handling message ${message.method}:`, error);
        sendResponse({
          error: error.message,
        } as ErrorMessage);
      });
      return true;
    });

    this.autoLockManager.listen();
  }

  public getKeyring(): Keyring {
    return this.keyring;
  }

  private isMethod(value: any): value is Message {
    return (
      typeof value === "object" &&
      "method" in value &&
      Object.values(Method).includes(value.method)
    );
  }
}
