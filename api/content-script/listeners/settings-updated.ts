import { Settings, SETTINGS_KEY } from "@/contexts/SettingsContext.tsx";
import { ApiUtils } from "@/api/background/utils.ts";

export const watchSettingsUpdated = () => {
  storage.watch<Settings>(SETTINGS_KEY, async (newValue, oldValue) => {
    if (oldValue && newValue) {
      const isHostConnectedInOldValue =
        await ApiUtils.isHostConnectedWithSettings(
          window.location.host,
          oldValue,
        );
      const isHostConnectedInNewValue =
        await ApiUtils.isHostConnectedWithSettings(
          window.location.host,
          newValue,
        );

      if (isHostConnectedInOldValue !== isHostConnectedInNewValue) {
        window.postMessage(
          ApiUtils.createApiResponse(
            "kas:host_connected",
            isHostConnectedInNewValue,
          ),
          window.location.origin,
        );
      }
    }

    if (newValue?.networkId !== oldValue?.networkId) {
      window.postMessage(
        ApiUtils.createApiResponse("kas:network_changed", newValue?.networkId),
        window.location.origin,
      );

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
