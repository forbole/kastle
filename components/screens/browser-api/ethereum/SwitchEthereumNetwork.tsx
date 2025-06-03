import Splash from "@/components/screens/Splash";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import SwitchNetwork from "../SwitchNetwork";
import { useSettings } from "@/hooks/useSettings";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import { z } from "zod";
import { TESTNET_SUPPORTED_EVM_L2_CHAINS } from "@/api/background/handlers/ethereum/utils";
import { numberToHex } from "viem";

export default function SwitchKaspaNetwork() {
  const [settings, setSettings] = useSettings();

  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "network",
  );

  const payload = encodedPayload ? decodeURIComponent(encodedPayload) : null;

  const network = payload ? z.number().parse(parseInt(payload, 10)) : null;

  const loading = !requestId || !network;

  const networks = TESTNET_SUPPORTED_EVM_L2_CHAINS.map((chain) => ({
    id: chain.id,
    name: chain.name,
    text: "text-teal-500",
    iconColor: "bg-teal-500",
    background: "bg-teal-800",
  }));
  const selectedNetwork = networks.find(
    (n) => n.id === (network ?? NetworkType.Mainnet),
  );

  const onConfirm = async () => {
    if (!selectedNetwork || !settings) {
      return;
    }

    setSettings({
      ...settings,
      evmL2ChainId: selectedNetwork.id,
    });

    await ApiExtensionUtils.sendMessage(
      requestId,
      ApiUtils.createApiResponse(requestId, numberToHex(selectedNetwork.id)),
    );
    window.close();
  };

  return (
    <div className="no-scrollbar h-screen overflow-y-scroll p-4">
      {loading && <Splash />}
      {!loading && (
        <SwitchNetwork
          selectedNetwork={selectedNetwork!}
          onConfirm={onConfirm}
        />
      )}
    </div>
  );
}
