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
import { zkasCheckSelection, zkasGetAccount, zkasGetSelectedAddress, zkasGetSwitchAccounts, zkasGetCredentials, zkasSign, zkasPaymentStatus, zkasPaymentAcquire, zkasPaymentSubmitting, zkasPaymentUncertain, zkasPaymentSuccess, zkasPaymentRelease, zkasPaymentClear, zkasPaymentAbortBeforeFetch, zkasConnectionRemove, zkasPreviewSeed, zkasImportSeed } from "./handlers/zkas";
import { Method } from "./methods";
import { isTrustedZKasSender } from "./zkas-sender";
import { zkasDappCheck, zkasDappComplete, zkasDappPendingGet } from "./handlers/zkas-dapp";
export { Method } from "./methods";

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
      [Method.ZKAS_GET_ACCOUNT]: zkasGetAccount,
      [Method.ZKAS_GET_SELECTED_ADDRESS]: zkasGetSelectedAddress,
      [Method.ZKAS_GET_SWITCH_ACCOUNTS]: zkasGetSwitchAccounts,
      [Method.ZKAS_PREVIEW_SEED]: zkasPreviewSeed,
      [Method.ZKAS_IMPORT_SEED]: zkasImportSeed,
      [Method.ZKAS_GET_CREDENTIALS]: zkasGetCredentials,
      [Method.ZKAS_CHECK_SELECTION]: zkasCheckSelection,
      [Method.ZKAS_SIGN]: zkasSign,
      [Method.ZKAS_PAYMENT_STATUS]: zkasPaymentStatus,
      [Method.ZKAS_PAYMENT_ACQUIRE]: zkasPaymentAcquire,
      [Method.ZKAS_PAYMENT_SUBMITTING]: zkasPaymentSubmitting,
      [Method.ZKAS_PAYMENT_UNCERTAIN]: zkasPaymentUncertain,
      [Method.ZKAS_PAYMENT_SUCCESS]: zkasPaymentSuccess,
      [Method.ZKAS_PAYMENT_RELEASE]: zkasPaymentRelease,
      [Method.ZKAS_PAYMENT_CLEAR]: zkasPaymentClear,
      [Method.ZKAS_PAYMENT_ABORT_BEFORE_FETCH]: zkasPaymentAbortBeforeFetch,
      [Method.ZKAS_CONNECTION_REMOVE]: zkasConnectionRemove,
      [Method.ZKAS_DAPP_PENDING_GET]: zkasDappPendingGet,
      [Method.ZKAS_DAPP_CHECK]: zkasDappCheck,
      [Method.ZKAS_DAPP_COMPLETE]: zkasDappComplete,
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

      if (message.method.startsWith("ZKAS_") && !isTrustedZKasSender(
        sender,
        browser.runtime.id,
        browser.runtime.getURL("/"),
      )) {
          sendResponse({ error: "ZKas requests require an extension page" } as ErrorMessage);
          return true;
      }

      // FIXME improve typings
      handler(message, sendResponse, sender).catch((error: unknown) => {
        if (!message.method.startsWith("ZKAS_")) {
          console.error(`Error handling message ${message.method}:`, error);
        }
        // WASM errors are thrown as plain strings; `error.message` on those is
        // undefined, which JSON-strips from the response and makes the caller
        // treat the failure as success. Always send a string.
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
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
