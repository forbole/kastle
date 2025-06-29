import {
  ApiExtensionResponseSchema,
  ApiRequestWithHost,
  ApiResponseSchema,
  RPC_ERRORS,
} from "@/api/message";
import { ExtensionService } from "@/lib/service/extension-service";
import {
  NetworkType,
  Settings,
  SETTINGS_KEY,
} from "@/contexts/SettingsContext.tsx";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";
import * as conn from "@/lib/settings/connection";
import { kasplexTestnet } from "@/lib/layer2";

export class ApiUtils {
  static openPopup(tabId: number, url: string) {
    return browser.windows.create({
      tabId,
      type: "popup",
      url,
      width: POPUP_WINDOW_WIDTH,
      height: POPUP_WINDOW_HEIGHT,
      focused: true,
    });
  }

  static async getSettings() {
    return await storage.getItem<Settings>(SETTINGS_KEY, {
      fallback: {
        networkId: NetworkType.Mainnet,
        lockTimeout: 5, // Save 5 minutes as default value
        walletConnections: undefined,
        hideBalances: true,
        preview: false,
        currency: "USD",

        evmL2ChainId: {
          [NetworkType.Mainnet]: undefined,
          [NetworkType.TestnetT10]: kasplexTestnet.id,
        },
      },
    });
  }

  static async getWalletSettings() {
    return await storage.getItem<WalletSettings>(WALLET_SETTINGS);
  }

  static async getCurrentAccount() {
    const walletSettings = await this.getWalletSettings();
    return await this.getSelectedAccountFromSettings(walletSettings);
  }

  static async getSelectedAccountFromSettings(settings: WalletSettings | null) {
    if (!settings?.selectedWalletId) return null;
    if (settings.selectedAccountIndex === undefined) return null;
    const selectedWallet = settings.wallets.find(
      (wallet) => wallet.id === settings.selectedWalletId,
    );
    if (!selectedWallet) return null;
    const selectedAccount = selectedWallet.accounts.find((account) => {
      return account.index === settings.selectedAccountIndex;
    });

    if (!selectedAccount) return null;
    return selectedAccount;
  }

  static async isInitialized(): Promise<boolean> {
    return ExtensionService.getInstance().getKeyring().isInitialized();
  }

  static async matchNetworkId(networkId: NetworkType): Promise<boolean> {
    const settings = await this.getSettings();
    return settings?.networkId === networkId;
  }

  static async isHostConnected(host: string): Promise<boolean> {
    const settings = await this.getSettings();
    return this.isHostConnectedWithSettings(host, settings);
  }

  static async isHostConnectedWithSettings(host: string, settings: Settings) {
    return this.isHostConnectedWithNetworkId(
      host,
      settings,
      settings.networkId,
    );
  }

  static async isHostConnectedWithNetworkId(
    host: string,
    settings: Settings,
    networkId: NetworkType,
  ): Promise<boolean> {
    const walletSettings = await this.getWalletSettings();
    if (!walletSettings?.selectedWalletId) return false;
    if (walletSettings.selectedAccountIndex === undefined) return false;
    if (!settings?.walletConnections) return false;

    const connections = conn.getAccountConnections(
      settings.walletConnections,
      walletSettings.selectedWalletId,
      walletSettings.selectedAccountIndex,
      networkId,
    );

    return conn.isConnected(connections, host);
  }

  static isUnlocked(): boolean {
    return ExtensionService.getInstance().getKeyring().isUnlocked();
  }

  static createApiResponse(id: string, response: unknown, error?: unknown) {
    return ApiResponseSchema.parse({
      source: "background",
      target: "browser",
      id,
      response,
      error,
    });
  }

  static async openPopupAndListenForResponse(
    requestId: string,
    url: string,
    tabId: number,
    timeout = 60_000, // 1 minute
  ) {
    const popup = await this.openPopup(tabId, url);
    let onRemovedListener: ((windowId: number) => void) | null = null;
    let receiveListener: ((message: unknown) => void) | null = null;
    let receiveTimeout: NodeJS.Timeout | null = null;

    const onClosePromise = new Promise((resolve, _) => {
      onRemovedListener = (windowId: number) => {
        if (windowId === popup.id) {
          resolve(this.createApiResponse(requestId, null, "User denied"));
        }
      };
      browser.windows.onRemoved.addListener(onRemovedListener);
    });

    const onMessagePromise = new Promise((resolve, reject) => {
      receiveListener = (message: unknown) => {
        const result = ApiExtensionResponseSchema.safeParse(message);
        if (!result.success) {
          return;
        }

        const parsedMessage = result.data;
        if (parsedMessage.id !== requestId) {
          return;
        }

        if (parsedMessage.error) {
          reject(parsedMessage.error);
          return;
        }

        resolve(parsedMessage.response);
      };

      receiveTimeout = setTimeout(() => {
        reject(RPC_ERRORS.TIMEOUT);
      }, timeout);

      browser.runtime.onMessage.addListener(receiveListener);
    });

    try {
      const result = await Promise.race([onClosePromise, onMessagePromise]);
      return result;
    } finally {
      // Ensure the listeners and timeout are cleaned up
      if (onRemovedListener)
        browser.windows.onRemoved.removeListener(onRemovedListener);

      if (receiveListener)
        browser.runtime.onMessage.removeListener(receiveListener);

      if (receiveTimeout) clearTimeout(receiveTimeout);
    }
  }
}

export type Handler = (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response: any) => void,
) => Promise<void>;
