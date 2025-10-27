import { useSettings } from "./useSettings";
import { NetworkType } from "../contexts/SettingsContext";
import useWalletManager from "./wallet/useWalletManager";
import {
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  ALL_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";

export default function useSwitchNetwork() {
  const [settings, setSettings] = useSettings();
  const { refreshKaspaAddresses } = useWalletManager();

  const switchKaspaNetwork = async (network: NetworkType) => {
    if (!settings) {
      throw new Error("Settings not loaded");
    }

    if (settings.networkId === network) {
      return;
    }

    await setSettings((prev) => ({ ...prev, networkId: network }));
    await refreshKaspaAddresses(network);
  };

  const switchEvmL2Network = async (chainId: number) => {
    if (!settings) {
      throw new Error("Settings not loaded");
    }

    const isSupported = ALL_SUPPORTED_EVM_L2_CHAINS.some(
      (chain) => chain.id === chainId,
    );
    if (!isSupported) {
      throw new Error(`EVM L2 chain ID ${chainId} is not supported`);
    }

    const isMainnet = MAINNET_SUPPORTED_EVM_L2_CHAINS.some(
      (chain) => chain.id === chainId,
    );
    const targetNetwork = isMainnet
      ? NetworkType.Mainnet
      : NetworkType.TestnetT10;

    await setSettings((prev) => {
      return {
        ...prev,
        networkId: targetNetwork,
        evmL2ChainId: Object.fromEntries(
          Object.values(NetworkType).map((nt) => [
            nt,
            nt === targetNetwork ? chainId : prev.evmL2ChainId?.[nt],
          ]),
        ) as Record<NetworkType, number | undefined>,
      };
    });

    if (settings.networkId !== targetNetwork) {
      await refreshKaspaAddresses(targetNetwork);
    }
  };

  return { switchKaspaNetwork, switchEvmL2Network };
}
