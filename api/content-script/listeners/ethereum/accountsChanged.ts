import { storage } from "wxt/storage";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext";
import { SETTINGS_KEY, Settings } from "@/contexts/SettingsContext";
import { ApiUtils } from "@/api/background/utils";

export class EthereumAccountsChangedListener {
  start() {
    storage.watch(
      WALLET_SETTINGS,
      async (
        newSettings: WalletSettings | null,
        oldSettings: WalletSettings | null,
      ) => {
        if (newSettings) {
          if (
            oldSettings?.selectedAccountIndex ===
              newSettings.selectedAccountIndex &&
            oldSettings?.selectedWalletId === newSettings.selectedWalletId
          ) {
            // No change in selected account, no need to update
            return;
          }

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

          const selectedAddress = await ApiUtils.getEvmAddress();

          window.postMessage(
            ApiUtils.createApiResponse(
              "accountsChanged",
              selectedAddress ? [selectedAddress] : [],
            ),
            window.location.origin,
          );
        }
      },
    );

    storage.watch(
      SETTINGS_KEY,
      async (settings: Settings | null, oldSettings: Settings | null) => {
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

          const evmAddress = await ApiUtils.getEvmAddress();
          if (oldSettings) {
            const oldEvmAddress =
              await ApiUtils.getEvmAddressFromSettings(oldSettings);
            if (evmAddress === oldEvmAddress) {
              // No change in EVM address, no need to update
              return;
            }
          }

          window.postMessage(
            ApiUtils.createApiResponse(
              "accountsChanged",
              evmAddress ? [evmAddress] : [],
            ),
            window.location.origin,
          );
        }
      },
    );
  }
}
