import Splash from "@/components/screens/Splash";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { useSettings } from "@/hooks/useSettings";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import {
  MAINNET_SUPPORTED_EVM_L2_CHAINS,
  ALL_SUPPORTED_EVM_L2_CHAINS,
} from "@/lib/layer2";
import { numberToHex, hexToNumber } from "viem";
import Header from "@/components/GeneralHeader";
import signImage from "@/assets/images/sign.png";
import { twMerge } from "tailwind-merge";

export default function SwitchNetwork({
  requestId,
  chainId,
}: {
  requestId: string;
  chainId: string;
}) {
  const [settings, setSettings] = useSettings();
  const l2Networks = ALL_SUPPORTED_EVM_L2_CHAINS.map((chain) => ({
    id: chain.id,
    name: chain.name,
  }));
  const selectedL2Network = l2Networks.find(
    (n) => n.id === hexToNumber(chainId as `0x${string}`),
  );

  const network = MAINNET_SUPPORTED_EVM_L2_CHAINS.some(
    (chain) => chain.id === hexToNumber(chainId as `0x${string}`),
  )
    ? NetworkType.Mainnet
    : NetworkType.TestnetT10;

  const onConfirm = async () => {
    if (!selectedL2Network || !settings) {
      return;
    }

    setSettings({
      ...settings,
      networkId: network,
      evmL2ChainId: Object.fromEntries(
        Object.values(NetworkType).map((nt) => [
          nt,
          nt === network ? selectedL2Network.id : settings.evmL2ChainId?.[nt],
        ]),
      ) as Record<NetworkType, number | undefined>,
    });

    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, numberToHex(selectedL2Network.id)),
    );
    window.close();
  };

  const networks = [
    {
      id: NetworkType.Mainnet,
      name: "Mainnet",
      text: "text-teal-500",
      iconColor: "bg-teal-500",
      background: "bg-teal-800",
    },
    {
      id: NetworkType.TestnetT10,
      name: "Testnet | T10",
      text: "text-yellow-500",
      iconColor: "bg-yellow-500",
      background: "bg-yellow-800",
    },
  ];

  const selectedNetwork = networks.find((n) => n.id === network);

  const loading = !selectedNetwork || !selectedL2Network;
  return (
    <div className="h-screen p-4">
      {loading && <Splash />}
      {!loading && (
        <div className="flex h-full flex-col">
          <div>
            <Header showPrevious={false} showClose={false} title="Confirm" />
            <div className="relative">
              <img src={signImage} alt="Sign" className="mx-auto" />
              <div
                className={twMerge(
                  "absolute right-0 top-0 flex items-center gap-2 rounded-full px-2",
                  selectedNetwork.text,
                  selectedNetwork.background,
                )}
              >
                <i
                  className={twMerge(
                    "rounded-full p-1",
                    selectedNetwork.iconColor,
                  )}
                />
                {selectedNetwork.name}
              </div>
            </div>

            <div className="mt-12 space-y-16 text-center">
              <h3 className="text-xl font-semibold">
                {"You're on a different evm L2 network than the one required."}
              </h3>
              <button
                onClick={onConfirm}
                className="rounded-full bg-icy-blue-400 p-5 text-base font-semibold hover:bg-icy-blue-600"
              >
                Switch to {selectedL2Network.name}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
