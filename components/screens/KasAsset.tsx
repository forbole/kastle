import Header from "@/components/GeneralHeader.tsx";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import React, { useState } from "react";
import KasHistory from "@/components/kas-asset/KasHistory.tsx";
import KasInfo from "@/components/kas-asset/KasInfo.tsx";
import AssetSendButton from "@/components/AssetSendButton";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";

export default function KasAsset() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"history" | "info">("history");
  const { account } = useWalletManager();
  const balance = useKaspaBalance(account?.address) ?? 0;
  const toDashboard = () => navigate("/dashboard");

  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-6">
      <Header
        variant="asset"
        title="KAS"
        onBack={toDashboard}
        onClose={toDashboard}
      />

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav className="flex gap-x-1 rounded-xl bg-daintree-800 p-1">
          <button
            type="button"
            className={twMerge(
              "inline-flex flex-grow items-center justify-center gap-x-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-[#E5E7EB] focus:outline-none disabled:pointer-events-none disabled:opacity-50",
              activeTab === "history" ? "bg-daintree-700" : "bg-transparent",
            )}
            onClick={() => setActiveTab("history")}
          >
            History
          </button>
          <button
            type="button"
            className={twMerge(
              "inline-flex flex-grow items-center justify-center gap-x-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-[#E5E7EB] focus:outline-none disabled:pointer-events-none disabled:opacity-50",
              activeTab === "info" ? "bg-daintree-700" : "bg-transparent",
            )}
            onClick={() => setActiveTab("info")}
          >
            Token info
          </button>
        </nav>
        {activeTab === "history" && <KasHistory />}
        {activeTab === "info" && <KasInfo />}
      </div>

      {balance > 0 && (
        <AssetSendButton ticker="KAS" onClick={() => navigate("/kas/send")} />
      )}
    </div>
  );
}
