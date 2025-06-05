import Splash from "@/components/screens/Splash";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import { useSettings } from "@/hooks/useSettings";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import { z } from "zod";
import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { numberToHex } from "viem";
import Header from "@/components/GeneralHeader";
import signImage from "@/assets/images/sign.png";
import { twMerge } from "tailwind-merge";

export default function SwitchKaspaNetwork() {
  const [settings, setSettings] = useSettings();

  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "network",
  );

  const payload = encodedPayload ? decodeURIComponent(encodedPayload) : null;

  const network = payload ? z.number().parse(parseInt(payload, 10)) : null;

  const testnetL2Networks = TESTNET_SUPPORTED_EVM_L2_CHAINS.map((chain) => ({
    id: chain.id,
    name: chain.name,
    text: "text-teal-500",
    iconColor: "bg-teal-500",
    background: "bg-teal-800",
  }));
  const selectedTestnetL2Network = testnetL2Networks.find(
    (n) => n.id === (network ?? NetworkType.Mainnet),
  );

  // TODO: add mainnet L2 networks when supported

  const onConfirm = async () => {
    if (!selectedTestnetL2Network || !settings) {
      return;
    }

    setSettings({
      ...settings,
      // TODO: set to mainnet when mainnet L2 networks are supported
      networkId: NetworkType.TestnetT10,
      evmL2ChainId: Object.fromEntries(
        Object.values(NetworkType).map((nt) => [
          nt,
          nt === settings.networkId
            ? selectedTestnetL2Network.id
            : settings.evmL2ChainId?.[nt],
        ]),
      ) as Record<NetworkType, number | undefined>,
    });

    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(
        requestId,
        numberToHex(selectedTestnetL2Network.id),
      ),
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

  // TODO: Allow to select mainnet when mainnet L2 networks are supported
  const selectedNetwork = networks.find((n) => n.id === NetworkType.TestnetT10);

  const loading =
    !requestId || !network || !selectedNetwork || !selectedTestnetL2Network;
  return (
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
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
                Switch to {selectedTestnetL2Network.name}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
