import Header from "@/components/GeneralHeader.tsx";
import { useNavigate } from "react-router-dom";
import React, { useState } from "react";
import AssetTabs, { AssetTab } from "@/components/AssetTabs";
import EvmKasInfo from "@/components//evm-kas-asset/EvmKasInfo";
import { useParams } from "react-router-dom";
import { getChainTokenSymbol } from "@/lib/layer2";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import { useEvmHistory } from "@/hooks/evm/useEvmHistory";
import { HistoryList } from "@/ui/popup/history/HistoryList";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import AssetSendButton from "@/components/AssetSendButton";

export default function EvmKasAsset() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AssetTab>("history");
  const { chainId } = useParams<{ chainId: `0x${string}` }>();
  const symbol = getChainTokenSymbol(chainId ?? "0x0");
  const { wallet, isWalletSettingsLoading } = useWalletManager();
  const { data: balance } = useEvmKasBalance(chainId);
  const evmAddress = useEvmAddress();
  const history = useEvmHistory({
    chainId,
    address: evmAddress,
    addressPending: isWalletSettingsLoading,
    source: { family: "evm-native" },
  });
  // As in the send asset picker: Ledger cannot send EVM KAS. A wallet that has
  // not loaded yet is not known to be non-Ledger.
  const canSend =
    !!chainId &&
    !isWalletSettingsLoading &&
    !!wallet &&
    wallet.type !== "ledger" &&
    (balance?.balance ?? "0") !== "0";
  const toDashboard = () => navigate("/dashboard");

  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-6">
      <Header
        variant="asset"
        title={symbol}
        onBack={toDashboard}
        onClose={toDashboard}
      />

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AssetTabs active={activeTab} onChange={setActiveTab} />

        {activeTab === "info" && <EvmKasInfo chainId={chainId! ?? "0x0"} />}
        {activeTab === "history" && (
          <div className="mt-8">
            <HistoryList
              key={`${chainId}:${evmAddress}`}
              records={history.records}
              isLoading={history.isLoading}
              isLoadingMore={history.isFetchingMore}
              error={history.error}
              hasMore={history.hasMore}
              onLoadMore={history.loadMore}
              onRetry={history.retry}
              unavailableMessage={history.unavailable?.reason}
            />
          </div>
        )}
      </div>

      {canSend && (
        <AssetSendButton
          ticker={symbol}
          onClick={() => navigate(`/evm-kas/send/${chainId}`)}
        />
      )}
    </div>
  );
}
