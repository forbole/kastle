import {
  ApiExtensionResponseSchema,
  ApiResponseSchema,
  ApiRequestWithHost,
  RPC_ERRORS,
} from "@/api/message";
import { ExtensionService } from "@/lib/service/extension-service";
import {
  NetworkType,
  Settings,
  SETTINGS_KEY,
} from "@/contexts/SettingsContext.tsx";
import {
  WalletSettings,
  WALLET_SETTINGS,
} from "@/contexts/WalletManagerContext";
import { POPUP_WINDOW_HEIGHT, POPUP_WINDOW_WIDTH } from "@/lib/utils";

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

  static async getSettings(): Promise<Settings | null> {
    return await storage.getItem<Settings>(SETTINGS_KEY);
  }

  static async getWalletSettings() {
    return await storage.getItem<WalletSettings>(WALLET_SETTINGS);
  }

  static async getCurrentAccount() {
    const walletSettings = await this.getWalletSettings();
    if (!walletSettings?.selectedWalletId) return null;
    if (walletSettings.selectedAccountIndex === undefined) return null;
    const selectedWallet = walletSettings.wallets.find(
      (wallet) => wallet.id === walletSettings.selectedWalletId,
    );
    if (!selectedWallet) return null;
    const selectedAccount = selectedWallet.accounts.find((account) => {
      return account.index === walletSettings.selectedAccountIndex;
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
    const walletSettings = await this.getWalletSettings();
    if (!walletSettings?.selectedWalletId) return false;
    if (walletSettings.selectedAccountIndex === undefined) return false;

    const walletConnections =
      settings?.walletConnections?.[walletSettings.selectedWalletId];

    if (!walletConnections) return false;

    const accountConnections =
      walletConnections[walletSettings.selectedAccountIndex];
    if (!accountConnections) return false;

    const connections = accountConnections[settings.networkId] ?? [];

    return connections.map((connection) => connection.host).includes(host);
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
