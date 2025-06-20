import Header from "@/components/GeneralHeader.tsx";
import { useNavigate, useParams } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import React, { useState } from "react";
import Erc20Info from "@/components/erc20-asset/Erc20Info";
import useEvmAssets from "@/hooks/evm/useEvmAssets";
import useWalletManager from "@/hooks/useWalletManager";

export default function Erc20Asset() {
  const navigate = useNavigate();
  const { account } = useWalletManager();
  const { chainId, address } = useParams();
  const [activeTab, setActiveTab] = useState<"history" | "info">("info");

  const { evmAssets } = useEvmAssets();
  const asset = evmAssets?.[account?.address ?? ""]?.erc20?.find(
    (asset) =>
      asset.address.toLowerCase() === address?.toLowerCase() &&
      asset.chainId === chainId,
  );

  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-4 py-6">
      <Header
        title={asset?.symbol ?? ""}
        onBack={() => navigate("/dashboard")}
        onClose={() => navigate("/dashboard")}
      />

      <nav className="flex gap-x-1 rounded-xl bg-daintree-800 p-1">
        <button
          type="button"
          className={twMerge(
            "inline-flex flex-grow items-center justify-center gap-x-2 rounded-lg px-4 py-3 text-center text-sm font-medium text-[#E5E7EB] focus:outline-none disabled:pointer-events-none disabled:opacity-50",
            activeTab === "history" ? "bg-daintree-700" : "bg-transparent",
          )}
          // TODO: Enable history tab when implemented
          // onClick={() => setActiveTab("history")}
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

      {activeTab === "info" && asset && <Erc20Info asset={asset} />}
    </div>
  );
}
