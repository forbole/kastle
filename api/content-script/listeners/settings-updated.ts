import { Settings, SETTINGS_KEY } from "@/contexts/SettingsContext.tsx";
import { ApiUtils } from "@/api/background/utils.ts";

export const watchSettingsUpdated = () => {
  storage.watch<Settings>(SETTINGS_KEY, async (newValue, oldValue) => {
    if (newValue?.networkId !== oldValue?.networkId) {
      window.postMessage(
        ApiUtils.createApiResponse("kas:network_changed", newValue?.networkId),
        window.location.origin,
      );

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
