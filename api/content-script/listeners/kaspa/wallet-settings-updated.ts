import { ApiUtils } from "@/api/background/utils.ts";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext.tsx";

export const watchWalletSettingsUpdated = () => {
  storage.watch<WalletSettings>(WALLET_SETTINGS, async (newValue, oldValue) => {
    // Check if the selected wallet or account has changed
    const oldSelectedWalletId = oldValue?.selectedWalletId;
    const oldSelectedAccountIndex = oldValue?.selectedAccountIndex;
    const newSelectedWalletId = newValue?.selectedWalletId;
    const newSelectedAccountIndex = newValue?.selectedAccountIndex;
    const isSelectedAccountChanged =
      oldSelectedWalletId !== newSelectedWalletId ||
      oldSelectedAccountIndex !== newSelectedAccountIndex;

    // Check if the selected wallet's legacy status has changed
    const oldSelectedWalletIsLegacyEnabled = oldValue?.wallets.find(
      (w) => w.id === oldSelectedWalletId,
    )?.isLegacyWalletEnabled;
    const newSelectedWalletIIsLegacyEnabled = newValue?.wallets.find(
      (w) => w.id === newSelectedWalletId,
    )?.isLegacyWalletEnabled;
    const isLegacyChanged =
      oldSelectedWalletIsLegacyEnabled !== newSelectedWalletIIsLegacyEnabled;

    if (isSelectedAccountChanged || isLegacyChanged) {
      const isHostConnected = await ApiUtils.isHostConnected(
        window.location.host,
      );

      window.postMessage(
        ApiUtils.createApiResponse("kas:host_connected", isHostConnected),
        window.location.origin,
      );

      const account = isHostConnected
        ? await ApiUtils.getCurrentAccount()
        : null;

      window.postMessage(
        ApiUtils.createApiResponse(
          "kas:account_changed",
          account ? account.address : null,
        ),
        window.location.origin,
      );
    }
  });
};
