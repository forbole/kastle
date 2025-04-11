import { ApiUtils } from "@/api/background/utils.ts";
import {
  WALLET_SETTINGS,
  WalletSettings,
} from "@/contexts/WalletManagerContext.tsx";

export const watchWalletSettingsUpdated = () => {
  storage.watch<WalletSettings>(WALLET_SETTINGS, (newValue, oldValue) => {
    if (
      newValue?.selectedWalletId !== oldValue?.selectedWalletId ||
      newValue?.selectedAccountIndex !== oldValue?.selectedAccountIndex
    ) {
      ApiUtils.createApiResponse("kas_accountChanged", null);
    }
  });
};
