import Header from "@/components/GeneralHeader.tsx";
import { useNavigate, useParams } from "react-router-dom";
import { useState } from "react";
import AssetTabs, { AssetTab } from "@/components/AssetTabs";
import Erc20Info from "@/components/erc20-asset/Erc20Info";
import useErc20Info from "@/hooks/evm/useErc20Info";
import useErc20Balance from "@/hooks/evm/useErc20Balance";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import AssetSendButton from "@/components/AssetSendButton";
import useEvmAddress from "@/hooks/evm/useEvmAddress";
import { useEvmHistory } from "@/hooks/evm/useEvmHistory";
import { HistoryList } from "@/ui/popup/history/HistoryList";

export default function Erc20Asset() {
  const navigate = useNavigate();
  const { chainId, address } = useParams();
  const [activeTab, setActiveTab] = useState<AssetTab>("history");

  const asset = useErc20Info(
    chainId as `0x${string}`,
    address as `0x${string}`,
  );
  const { wallet, isWalletSettingsLoading } = useWalletManager();
  // `address` is the token contract (route); the owner is the wallet's 0x address.
  const evmAddress = useEvmAddress();
  const history = useEvmHistory({
    chainId,
    address: evmAddress,
    addressPending: isWalletSettingsLoading,
    source: { family: "erc20", token: address ?? "" },
  });
  const { data: balance } = useErc20Balance(address ?? "", chainId ?? "");
  // As in the send asset picker: Ledger cannot send ERC-20. A wallet that has
  // not loaded yet is not known to be non-Ledger.
  const canSend =
    !!asset &&
    !isWalletSettingsLoading &&
    !!wallet &&
    wallet.type !== "ledger" &&
    Number(balance?.balance ?? 0) > 0;
  const toDashboard = () => navigate("/dashboard");

  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-6">
      <Header
        variant="asset"
        title={asset?.symbol ?? ""}
        onBack={toDashboard}
        onClose={toDashboard}
      />

      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
        <AssetTabs active={activeTab} onChange={setActiveTab} />

        {activeTab === "history" && (
          <div className="mt-8">
            <HistoryList
              key={`${chainId}:${address}:${evmAddress}`}
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

        {activeTab === "info" && asset && <Erc20Info asset={asset} />}
      </div>

      {canSend && (
        <AssetSendButton
          ticker={asset.symbol}
          onClick={() => navigate(`/erc20/send/${chainId}/${address}`)}
        />
      )}
    </div>
  );
}
