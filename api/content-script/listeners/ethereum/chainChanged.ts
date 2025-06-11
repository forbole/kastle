import { SETTINGS_KEY, Settings } from "@/contexts/SettingsContext";
import { storage } from "wxt/storage";
import { ApiUtils } from "@/api/background/utils";
import { numberToHex } from "viem";

export class EthereumChainChangedListener {
  start() {
    storage.watch(
      SETTINGS_KEY,
      async (newSettings: Settings | null, oldSettings: Settings | null) => {
        if (!newSettings) return;

        const newEvmL2ChainId =
          newSettings.evmL2ChainId?.[newSettings.networkId];
        const oldEvmL2ChainId =
          oldSettings?.evmL2ChainId?.[oldSettings.networkId];

        if (newEvmL2ChainId !== oldEvmL2ChainId) {
          window.postMessage(
            ApiUtils.createApiResponse(
              "chainChanged",
              numberToHex(newEvmL2ChainId ?? 0),
            ),
            window.location.origin,
          );
          return;
        }
      },
    );
  }
}
