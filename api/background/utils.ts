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
    browser.windows.create({
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

  static async receiveExtensionMessage(
    id: string,
    timeout = 60_000, // 1 minute
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const listener = (message: unknown) => {
        const result = ApiExtensionResponseSchema.safeParse(message);
        if (!result.success) {
          return;
        }

        const parsedMessage = result.data;
        if (parsedMessage.id !== id) {
          return;
        }

        if (parsedMessage.error) {
          reject(parsedMessage.error);
          return;
        }

        browser.runtime.onMessage.removeListener(listener);
        resolve(parsedMessage.response);
      };

      browser.runtime.onMessage.addListener(listener);

      setTimeout(() => {
        browser.runtime.onMessage.removeListener(listener);
        reject(RPC_ERRORS.TIMEOUT);
      }, timeout);
    });
  }
}

export type Handler = (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response: any) => void,
) => Promise<void>;
