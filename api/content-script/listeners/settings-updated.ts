import { Settings, SETTINGS_KEY } from "@/contexts/SettingsContext.tsx";
import { ApiUtils } from "@/api/background/utils.ts";

export const watchSettingsUpdated = () => {
  storage.watch<Settings>(SETTINGS_KEY, (newValue, oldValue) => {
    if (newValue?.networkId !== oldValue?.networkId) {
      window.postMessage(
        ApiUtils.createApiResponse("kas_networkChanged", [newValue?.networkId]),
        window.location.origin,
      );
      window.postMessage(
        ApiUtils.createApiResponse("kas_accountChanged", null),
        window.location.origin,
      );
    }
  });
};
