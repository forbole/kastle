import { Settings, SETTINGS_KEY } from "@/contexts/SettingsContext.tsx";
import { ApiUtils } from "@/api/background/utils.ts";

export const watchSettingsUpdated = () => {
  storage.watch<Settings>(SETTINGS_KEY, (newValue, oldValue) => {
    if (newValue?.networkId !== oldValue?.networkId) {
      window.postMessage(
        ApiUtils.createApiResponse("kas:network_changed", [
          newValue?.networkId,
        ]),
        window.location.origin,
      );
      window.postMessage(
        ApiUtils.createApiResponse("kas:account_changed", null),
        window.location.origin,
      );
    }
  });
};
