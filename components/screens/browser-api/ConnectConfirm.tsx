import { ApiExtensionUtils } from "@/api/extension";
import { useSettings } from "@/hooks/useSettings";
import { NetworkType } from "@/contexts/SettingsContext.tsx";
import Header from "@/components/GeneralHeader";
import Link from "@/assets/images/link.svg";
import CheckCircle from "@/assets/images/check-circle.svg";
import { twMerge } from "tailwind-merge";
import { ApiUtils } from "@/api/background/utils";
import * as conn from "@/lib/settings/connection";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import useWalletManager from "@/hooks/wallet/useWalletManager";

export default function ConnectConfirm() {
  const [settings, setSettings] = useSettings();
  const { wallet, account } = useWalletManager();
  const evmAddress = useEvmAddress();

  // Get payload from URL
  const urlSearchParams = new URLSearchParams(window.location.search);
  const requestId = urlSearchParams.get("requestId") ?? "";
  const host = urlSearchParams.get("host") ?? "";
  const tabName = urlSearchParams.get("name") ?? "Unknown";
  const icon = urlSearchParams.get("icon") ?? undefined;

  // Create confirm and deny messages
  const confirmMessage = ApiUtils.createApiResponse(requestId, true);
  const denyMessage = ApiUtils.createApiResponse(
    requestId,
    false,
    "User denied",
  );

  const handleConnectConfirm = async () => {
    if (!settings || !wallet || !account) {
      return;
    }

    const selectedWalletId = wallet.id;
    const selectedAccountIndex = account.index;
    try {
      const walletConnections = settings.walletConnections ?? {};

      const updated = conn.addConnection(
        walletConnections,
        selectedWalletId,
        selectedAccountIndex,
        {
          host,
          name: tabName,
          icon,
        },
      );

      await setSettings({
        ...settings,
        walletConnections: updated,
      });

      // Send confirmation to background
      await ApiExtensionUtils.sendMessage(requestId, confirmMessage);
    } catch (err) {
      // Send false to background if error
      await ApiExtensionUtils.sendMessage(
        requestId,
        ApiUtils.createApiResponse(
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
    window.close();
  };

  return (
    <div className="flex h-full w-full flex-col rounded-xl p-4">
      <div className="flex-shrink-0">
        <Header
          title={
            "Connect to " +
            (tabName.length < 10 ? tabName : tabName.slice(0, 10) + "...")
          }
          showPrevious={false}
          showClose={false}
        />
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto">
        <div className="relative">
          {/* App info */}
          <div className="flex flex-col items-center gap-3">
            {icon ? (
              <img alt={tabName} className="h-12 w-12" src={icon} />
            ) : (
              <div className="h-12 w-12 rounded-full bg-white" />
            )}
            <div className="text-center">
              <div className="text-sm font-semibold">{tabName}</div>
              <div className="text-xs text-[#7B9AAA]">{host}</div>
            </div>

            <div className="pb-3">
              <img alt="link" className="h-4 w-4" src={Link} />
            </div>
          </div>

          <div className="space-y-6">
            {/* Account info */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex w-full gap-2 rounded-xl border border-[#203C49] bg-[#102832] p-3">
                <div className="flex flex-1 flex-col gap-2 font-medium">
                  <div className="flex justify-between">
                    <span className="text-sm font-semibold">
                      {account?.name}
                    </span>
                    <span className="rounded-full border border-icy-blue-400 px-2 text-icy-blue-400">
                      Kaspa
                    </span>
                  </div>
                  <div className="break-all text-xs text-[#7B9AAA]">
                    {account?.address}
                  </div>
                </div>
              </div>

              {evmAddress && (
                <div className="flex w-full gap-2 rounded-xl border border-[#203C49] bg-[#102832] p-3">
                  <div className="flex flex-1 flex-col gap-2 font-medium">
                    <div className="flex justify-between">
                      <span className="text-sm font-semibold">
                        {account?.name}
                      </span>
                      <span className="rounded-full border border-icy-blue-400 px-2 text-icy-blue-400">
                        EVM
                      </span>
                    </div>
                    <div className="break-all text-xs text-[#7B9AAA]">
                      {evmAddress}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Permissions */}
            <div className="space-y-3">
              <span className="text-sm font-semibold">
                Connect this website to:
              </span>
              <div className="space-y-3 rounded-xl border border-[#203C49] bg-[#102832] p-3 text-xs text-[#7B9AAA]">
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

      {/* 固定在底部的按钮 */}
      <div className="mt-4 flex flex-shrink-0 gap-2 text-base font-semibold">
        <button
          className="rounded-full px-6 py-3 text-[#7B9AAA]"
          onClick={handleConnectDeny}
        >
          Cancel
        </button>
        <button
          className="flex-1 rounded-full bg-icy-blue-400 py-3 font-semibold hover:bg-icy-blue-600"
          onClick={handleConnectConfirm}
        >
          Connect
        </button>
      </div>
    </div>
  );
}
