import Header from "@/components/GeneralHeader.tsx";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import React, { useState } from "react";
import EvmKasInfo from "@/components//evm-kas-asset/EvmKasInfo";
import { useParams } from "react-router-dom";
import EvmKasHistory from "../evm-kas-asset/EvmKasHistory";
import { getChainTokenSymbol } from "@/lib/layer2";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import AssetSendButton from "@/components/AssetSendButton";

export default function EvmKasAsset() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"history" | "info">("history");
  const { chainId } = useParams<{ chainId: `0x${string}` }>();
  const symbol = getChainTokenSymbol(chainId ?? "0x0");
  const { wallet } = useWalletManager();
  const { data: balance } = useEvmKasBalance(chainId);
  // As in the send asset picker: Ledger cannot send EVM KAS.
  const canSend =
    !!chainId && wallet?.type !== "ledger" && (balance?.balance ?? "0") !== "0";
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

        {activeTab === "info" && <EvmKasInfo chainId={chainId! ?? "0x0"} />}
        {activeTab === "history" && (
          <EvmKasHistory chainId={chainId ?? "0x0"} />
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
