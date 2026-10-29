import Header from "@/components/GeneralHeader.tsx";
import { useNavigate, useParams } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import React, { useState } from "react";
import TokenHistory from "@/components/krc20-asset/TokenHistory";
import TokenInfo from "@/components/krc20-asset/TokenInfo";
import { setPopupPath } from "@/lib/utils.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import { useTokenBalance } from "@/hooks/kasplex/useTokenBalance";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import AssetSendButton from "@/components/AssetSendButton";

export default function TokenAsset() {
  const navigate = useNavigate();
  const { ticker } = useParams();
  const [activeTab, setActiveTab] = useState<"history" | "info">("history");

  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const tokenInfo = tokenInfoResponse?.result?.[0];
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;
  const { account, wallet } = useWalletManager();
  const { data: balanceResponse } = useTokenBalance(
    account && ticker
      ? { address: account.address, tokenId: ticker }
      : undefined,
  );
  const balance = parseFloat(balanceResponse?.result?.[0]?.balance ?? "0");
  // As in the send asset picker: Ledger cannot send KRC-20.
  const canSend = !!tokenName && wallet?.type !== "ledger" && balance > 0;
  const toDashboard = () => navigate("/dashboard");

  useEffect(() => {
    setPopupPath();
  }, []);

  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-6">
      <Header
        variant="asset"
        title={tokenName ?? ""}
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
        {activeTab === "history" && <TokenHistory />}
        {activeTab === "info" && <TokenInfo />}
      </div>

      {canSend && (
        <AssetSendButton
          ticker={tokenName}
          onClick={() => navigate(`/krc20/send/${ticker}`)}
        />
      )}
    </div>
  );
}
