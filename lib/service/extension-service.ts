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

export enum Method {
  KEYRING_STATUS = "KEYRING_STATUS",
  KEYRING_INITIALIZE = "KEYRING_INITIALIZE",
  KEYRING_UNLOCK = "KEYRING_UNLOCK",
  KEYRING_LOCK = "KEYRING_LOCK",
  KEYRING_ADD_WALLET_SECRET = "KEYRING_ADD_WALLET_SECRET",
  KEYRING_REMOVE_WALLET_SECRET = "KEYRING_REMOVE_WALLET_SECRET",
  KEYRING_GET_WALLET_SECRET = "KEYRING_GET_WALLET_SECRET",
  KEYRING_RESET = "KEYRING_RESET",
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
      [Method.KEYRING_RESET]: keyringReset,
    } as const;
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
      handler(message as any, sendResponse).catch((error: Error) =>
        console.error(error),
      );
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
