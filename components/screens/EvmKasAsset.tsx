import Header from "@/components/GeneralHeader.tsx";
import { useNavigate } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import React, { useState } from "react";
import EvmKasInfo from "@/components//evm-kas-asset/EvmKasInfo";
import { useParams } from "react-router-dom";
import EvmKasHistory from "../evm-kas-asset/EvmKasHistory";

export default function EvmKasAsset() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"history" | "info">("history");
  const { chainId } = useParams<{ chainId: `0x${string}` }>();

  return (
    <div className="flex h-full flex-col px-4 py-6">
      <Header
        title={"KAS"}
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
      {activeTab === "history" && <EvmKasHistory chainId={chainId ?? "0x0"} />}
    </div>
  );
}
