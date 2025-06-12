import { storage } from "wxt/storage";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import { SETTINGS_KEY, Settings } from "@/contexts/SettingsContext";
import { ApiUtils } from "@/api/background/utils";
import { toEvmAddress } from "@/lib/utils";

export class EthereumAccountsChangedListener {
  start() {
    storage.watch(
      WALLET_SETTINGS,
      async (
        newSettings: WalletSettings | null,
        oldSettings: WalletSettings | null,
      ) => {
        if (newSettings) {
          // send empty addresses array if host is not connected
          const isHostConnected = await ApiUtils.isHostConnected(
            window.location.host,
          );
          if (!isHostConnected) {
            window.postMessage(
              ApiUtils.createApiResponse("accountsChanged", []),
              window.location.origin,
            );
            return;
          }

          const account = await ApiUtils.getCurrentAccount();
          if (!account?.publicKeys) {
            return;
          }

          const selectedPublicKey = account.publicKeys[0];
          const selectedAddress = toEvmAddress(selectedPublicKey);

          let oldPublicKey = "";
          if (oldSettings) {
            const oldAccount =
              await ApiUtils.getSelectedAccountFromSettings(oldSettings);
            if (oldAccount?.publicKeys && oldAccount.publicKeys.length > 0) {
              oldPublicKey = oldAccount.publicKeys[0];
            }
          }

          if (oldPublicKey !== selectedPublicKey) {
            window.postMessage(
              ApiUtils.createApiResponse("accountsChanged", [selectedAddress]),
              window.location.origin,
            );
          }
        }
      },
    );

    storage.watch(SETTINGS_KEY, async (settings: Settings | null) => {
      if (settings) {
        const isHostConnected = await ApiUtils.isHostConnectedWithSettings(
          window.location.host,
          settings,
        );
        if (!isHostConnected) {
          window.postMessage(
            ApiUtils.createApiResponse("accountsChanged", []),
            window.location.origin,
          );
          return;
        }

        const account = await ApiUtils.getCurrentAccount();
        if (!account?.publicKeys) {
          return;
        }
        const selectedPublicKey = account.publicKeys[0];
        const selectedAddress = toEvmAddress(selectedPublicKey);
        window.postMessage(
          ApiUtils.createApiResponse("accountsChanged", [selectedAddress]),
          window.location.origin,
        );
      }
    });
  }
}
