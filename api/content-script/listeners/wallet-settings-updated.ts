import { ApiUtils } from "@/api/background/utils.ts";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext.tsx";

export const watchWalletSettingsUpdated = () => {
  storage.watch<WalletSettings>(WALLET_SETTINGS, async (newValue, oldValue) => {
    if (
      newValue?.selectedWalletId !== oldValue?.selectedWalletId ||
      newValue?.selectedAccountIndex !== oldValue?.selectedAccountIndex
    ) {
      const isHostConnected = await ApiUtils.isHostConnected(
        window.location.host,
      );

      const account = isHostConnected
        ? await ApiUtils.getCurrentAccount()
        : null;

      window.postMessage(
        ApiUtils.createApiResponse(
          "kas:account_changed",
          account?.address ?? null,
        ),
        window.location.origin,
      );
    }
  });
};
