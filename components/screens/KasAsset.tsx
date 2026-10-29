import Header from "@/components/GeneralHeader.tsx";
import { useNavigate } from "react-router-dom";
import React, { useState } from "react";
import AssetTabs, { AssetTab } from "@/components/AssetTabs";
import KasHistory from "@/components/kas-asset/KasHistory.tsx";
import KasInfo from "@/components/kas-asset/KasInfo.tsx";
import AssetSendButton from "@/components/AssetSendButton";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import useKaspaBalance from "@/hooks/wallet/useKaspaBalance";

export default function KasAsset() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AssetTab>("history");
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
        <AssetTabs active={activeTab} onChange={setActiveTab} />
        {activeTab === "history" && <KasHistory />}
        {activeTab === "info" && <KasInfo />}
      </div>

      {balance > 0 && (
        <AssetSendButton ticker="KAS" onClick={() => navigate("/kas/send")} />
      )}
    </div>
  );
}
