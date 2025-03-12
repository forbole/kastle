import { ApiExtensionUtils } from "@/api/extension";
import { useSettings } from "@/hooks/useSettings";
import { ApiResponse } from "@/api/message";
import { useEffect } from "react";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import Header from "@/components/GeneralHeader";
import Link from "@/assets/images/link.svg";
import CheckCircle from "@/assets/images/check-circle.svg";
import { twMerge } from "tailwind-merge";

export default function ConnectConfirm() {
  const [settings, setSettings] = useSettings();
  const { walletSettings } = useWalletManager();

  // Get account info
  const selectedWalletId = walletSettings?.selectedWalletId ?? "";
  const selectedAccountIndex = walletSettings?.selectedAccountIndex ?? 0;
  const account = walletSettings?.wallets
    ?.find((w) => w.id === selectedWalletId)
    ?.accounts.find((a) => a.index === selectedAccountIndex);

  // Get payload from URL
  const urlSearchParams = new URLSearchParams(window.location.search);
  const requestId = urlSearchParams.get("requestId") ?? "";
  const host = urlSearchParams.get("host") ?? "";
  const tabName = urlSearchParams.get("name") ?? "Unknown";
  const icon = urlSearchParams.get("icon") ?? undefined;

  // Create confirm and deny messages
  const confirmMessage = new ApiResponse(requestId, true);
  const denyMessage = new ApiResponse(requestId, false, "User denied");

  useEffect(() => {
    // Handle beforeunload event
    async function beforeunload(event: BeforeUnloadEvent) {
      await ApiExtensionUtils.sendMessage(requestId, denyMessage);
    }

    window.addEventListener("beforeunload", beforeunload);

    return () => {
      window.removeEventListener("beforeunload", beforeunload);
    };
  }, []);

  const handleConnectConfirm = async () => {
    if (!settings) {
      return;
    }

    const selectedWalletId = walletSettings?.selectedWalletId;
    try {
      if (!selectedWalletId) {
        throw new Error("No selected wallet id found");
      }

      const walletConnections = settings.walletConnections ?? {};
      const connections =
        walletConnections[selectedWalletId]?.[selectedAccountIndex]?.[
          settings.networkId
        ] ?? [];

      // Add connection to wallet connections and save if not exists
      if (!connections.map((connection) => connection.host).includes(host)) {
        connections.push({ host, name: tabName, icon });
        walletConnections[selectedWalletId] = {
          ...walletConnections[selectedWalletId],
          [selectedAccountIndex]: {
            ...walletConnections[selectedWalletId]?.[selectedAccountIndex],
            [settings.networkId]: connections,
          },
        };

        await setSettings({
          ...settings,
          walletConnections: walletConnections,
        });
      }

      // Send confirmation to background
      await ApiExtensionUtils.sendMessage(requestId, confirmMessage);
    } catch (err) {
      // Send false to background if error
      await ApiExtensionUtils.sendMessage(
        requestId,
        new ApiResponse(
          requestId,
          false,
          "Error happens while connecting: " + (err as any).toString(),
        ),
      );
    } finally {
      window.close();
    }
  };

  const handleConnectDeny = async () => {
    // Send deny to background
    await ApiExtensionUtils.sendMessage(requestId, denyMessage);
    window.close();
  };

  const networks = [
    {
      id: NetworkType.Mainnet,
      name: "Mainnet",
      text: "text-teal-500",
      background: "bg-teal-800",
    },
    {
      id: NetworkType.TestnetT10,
      name: "Testnet | T10",
      text: "text-yellow-500",
      background: "bg-yellow-800",
    },
    {
      id: NetworkType.TestnetT11,
      name: "Testnet | T11",
      text: "text-violet-500",
      background: "bg-violet-800",
    },
  ];
  const selectedNetwork = networks.find((n) => n.id === settings?.networkId);

  return (
    <div className="flex h-full w-full flex-col justify-between rounded-xl p-6">
      <div className="flex flex-col items-center">
        {/* Header */}
        <Header
          title={
            "Connect to " +
            (tabName.length < 10 ? tabName : tabName.slice(0, 10) + "...")
          }
          showPrevious={false}
          showClose={false}
        />
        <div className="relative">
          <div
            className={twMerge(
              "absolute right-0 top-0 flex items-center gap-1 rounded-full px-2",
              selectedNetwork?.text,
              selectedNetwork?.background,
            )}
          >
            <i className="hn hn-globe-solid" />
            {selectedNetwork?.name}
          </div>

          {/* App info */}
          <div className="flex flex-col items-center gap-2">
            {icon ? (
              <img
                alt={tabName}
                className="h-12 w-12 rounded-full"
                src={icon}
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-white" />
            )}
            <div className="text-center">
              <div className="text-sm font-semibold">{tabName}</div>
              <div className="text-xs text-gray-400">{host}</div>
            </div>

            <div className="pb-3">
              <img alt="link" className="h-6 w-6" src={Link} />
            </div>
          </div>

          <div className="space-y-6">
            {/* Account info */}
            <div className="rounded-xl border border-gray-600 bg-gray-800 p-4">
              <div className="flex gap-2">
                <span className="flex h-9 w-9 min-w-9 items-center justify-center rounded-lg bg-slate-700">
                  {account?.name?.[0]}
                  {account?.name?.[account?.name?.length - 1]}
                </span>
                <div className="flex flex-col font-medium">
                  <span className="text-sm font-semibold">{account?.name}</span>
                  <div className="break-all text-xs text-gray-400">
                    {account?.address}
                  </div>
                </div>
              </div>
            </div>

            {/* Permissions */}
            <div className="space-y-3">
              <span className="text-sm font-semibold">
                Connect this website to:
              </span>
              <div className="space-y-3 rounded-xl border border-gray-600 bg-gray-800 px-4 py-3 text-xs text-gray-400">
                <div className="flex items-center gap-2">
                  <img alt="check" className="h-4 w-4" src={CheckCircle} />
                  <span>View your wallet balance and activity</span>
                </div>
                <div className="flex items-center gap-2">
                  <img alt="check" className="h-4 w-4" src={CheckCircle} />
                  <span>Request approval for transactions</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 text-base font-semibold">
        <button
          className="rounded-full p-5 text-rose-400"
          onClick={handleConnectDeny}
        >
          Cancel
        </button>
        <button
          className="flex-auto rounded-full bg-icy-blue-400 py-5 font-semibold hover:bg-icy-blue-600"
          onClick={handleConnectConfirm}
        >
          Connect
        </button>
      </div>
    </div>
  );
}
