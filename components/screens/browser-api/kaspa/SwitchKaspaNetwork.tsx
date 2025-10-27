import Splash from "@/components/screens/Splash";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import SwitchNetwork from "../SwitchNetwork";
import { useSettings } from "@/hooks/useSettings";
import { ApiExtensionUtils } from "@/api/extension";
import { ApiUtils } from "@/api/background/utils";
import { z } from "zod";
import useRpcClientStateful from "@/hooks/useRpcClientStateful";
import useSwitchNetwork from "@/hooks/useSwitchNetwork";

export default function SwitchKaspaNetwork() {
  const [settings] = useSettings();
  const { rpcClient } = useRpcClientStateful();
  const { switchKaspaNetwork } = useSwitchNetwork();

  const requestId =
    new URLSearchParams(window.location.search).get("requestId") ?? "";
  const encodedPayload = new URLSearchParams(window.location.search).get(
    "network",
  );

  const payload = encodedPayload ? decodeURIComponent(encodedPayload) : null;

  const network = payload ? z.string().parse(payload) : null;

  // Must check rpcClient connection state before switching network, otherwise the address would not be updated to have the proper prefix
  const loading =
    !requestId || !network || !settings || !rpcClient?.isConnected;

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
  const selectedNetwork = networks.find(
    (n) => n.id === (network ?? NetworkType.Mainnet),
  );

  const onConfirm = async () => {
    if (!selectedNetwork) {
      return;
    }

    try {
      await switchKaspaNetwork(selectedNetwork.id);

      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, selectedNetwork.id),
      );
    } catch (error) {
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(requestId, null, "Failed to switch network"),
      );
    } finally {
      window.close();
    }
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
