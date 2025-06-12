import React from "react";
import Header from "@/components/GeneralHeader";
import { useSettings } from "@/hooks/useSettings";
import emptyImage from "@/assets/images/empty.png";
import { useNavigate } from "react-router-dom";
import * as conn from "@/lib/settings/connection";

export default function ConnectedApps() {
  const navigate = useNavigate();
  const [settings, setSettings] = useSettings();
  const { walletSettings } = useWalletManager();
  const selectedWalletId = walletSettings?.selectedWalletId;
  const selectedAccountIndex = walletSettings?.selectedAccountIndex;

  const connections = conn.getAccountConnections(
    settings?.walletConnections ?? {},
    selectedWalletId ?? "",
    selectedAccountIndex ?? 0,
    settings?.networkId ?? "mainnet",
  );

  const handleUnlink = (host: string) => {
    if (!selectedWalletId) return;
    if (!settings?.walletConnections) return;
    if (selectedAccountIndex === undefined || selectedAccountIndex === null)
      return;

    const updated = conn.removeConnection(
      settings.walletConnections,
      selectedWalletId,
      selectedAccountIndex,
      settings.networkId,
      host,
    );

    setSettings({
      ...settings,
      walletConnections: updated,
    });
  };

  return (
    <div className="flex h-full flex-col p-6">
      <Header title="Connected Apps" onClose={() => navigate("/dashboard")} />
      <div className="space-y-4">
        {!connections?.length && (
          <div className="mt-4 space-y-6">
            <img
              src={emptyImage}
              alt="empty"
              className="mx-auto h-[120px] w-[152px]"
            />
            <div className="text-center text-sm text-[#7B9AAA]">
              Looks like no apps are connected yet
            </div>
          </div>
        )}
        {connections?.map((connection) => (
          <div
            key={connection.host}
            className="flex w-full justify-between bg-[#10252D]"
          >
            <div className="flex flex-1 items-center gap-2 rounded-l-lg border border-[#203C49] p-2 hover:border-white">
              {/* Icon */}
              {connection.icon ? (
                <img
                  alt={connection.host}
                  className="h-10 w-10 rounded-full"
                  src={connection.icon}
                />
              ) : (
                <div className="h-10 w-10 rounded-full bg-icy-blue-400"></div>
              )}

              {/* Content */}
              <div className="flex flex-1 flex-col">
                <span className="text-sm font-semibold">
                  {!connection.name
                    ? "Unknown"
                    : connection.name.length > 20
                      ? `${connection.name.slice(0, 29)}...`
                      : connection.name}
                </span>
                <span className="text-xs text-[#7B9AAA]">
                  {connection.host}
                </span>
              </div>
            </div>

            {/* Unlink button */}
            <button
              className="rounded-r-lg border border-[#203C49] p-2 text-sm font-semibold text-[#94A3B8;] hover:border-white"
              onClick={() => {
                handleUnlink(connection.host);
              }}
            >
              Unlink
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
