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
  RPC_URLS,
} from "@/contexts/SettingsContext.tsx";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import {
  POPUP_WINDOW_HEIGHT,
  POPUP_WINDOW_WIDTH,
  toLegacyEvmAddress,
} from "@/lib/utils";
import * as conn from "@/lib/settings/connection";
import { kasplexTestnet, kasplexMainnet } from "@/lib/layer2";
import { publicKeyToAddress } from "viem/accounts";
import { RpcClient, Encoding, Resolver } from "@/wasm/core/kaspa";

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
          [NetworkType.Mainnet]: kasplexMainnet.id,
          [NetworkType.TestnetT10]: kasplexTestnet.id,
        },
        isLegacyEvmAddressEnabled: false,
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
    if (!settings) return null;

    const selectedWallet = await ApiUtils.getCurrentWallet();
    if (!selectedWallet) return null;
    const selectedAccount = selectedWallet.accounts.find((account) => {
      return account.index === settings.selectedAccountIndex;
    });

    if (!selectedAccount) return null;
    return selectedAccount;
  }

  static async getCurrentWallet() {
    const walletSettings = await this.getWalletSettings();
    if (!walletSettings?.selectedWalletId) return null;

    return (
      walletSettings.wallets.find(
        (wallet) => wallet.id === walletSettings.selectedWalletId,
      ) ?? null
    );
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

  static async isHostConnectedWithSettings(
    host: string,
    settings: Settings,
  ): Promise<boolean> {
    const walletSettings = await this.getWalletSettings();
    if (!walletSettings?.selectedWalletId) return false;
    if (walletSettings.selectedAccountIndex === undefined) return false;
    if (!settings?.walletConnections) return false;

    const connections = conn.getAccountConnections(
      settings.walletConnections,
      walletSettings.selectedWalletId,
      walletSettings.selectedAccountIndex,
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
    timeout = 180_000, // 3 minute
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

  static async getEvmAddress() {
    const wallet = await ApiUtils.getCurrentWallet();
    if (!wallet || wallet.type === "ledger") {
      return;
    }

    const settings = await ApiUtils.getSettings();
    return ApiUtils.getEvmAddressFromSettings(settings);
  }

  static async getEvmAddressFromSettings(settings: Settings) {
    const account = await ApiUtils.getCurrentAccount();

    if (!account) {
      return;
    }

    if (settings.isLegacyEvmAddressEnabled) {
      return account.publicKeys && account.publicKeys.length > 0
        ? toLegacyEvmAddress(account.publicKeys[0])
        : undefined;
    }

    if (!account.evmPublicKey) {
      return;
    }

    return publicKeyToAddress(account.evmPublicKey!);
  }

  static async getKaspaRpcClient(): Promise<RpcClient> {
    const settings = await this.getSettings();
    const networkId = settings.networkId;
    const rpcUrl = RPC_URLS[networkId];
    const rpcClient = new RpcClient({
      url: rpcUrl,
      resolver: rpcUrl ? undefined : new Resolver(),
      encoding: Encoding.Borsh,
      networkId,
    });
    return rpcClient;
  }
}

export type Handler = (
  tabId: number,
  message: ApiRequestWithHost,
  sendResponse: (response: any) => void,
) => Promise<void>;
