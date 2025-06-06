import Header from "@/components/GeneralHeader.tsx";
import { useNavigate, useParams } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import React, { useState } from "react";
import TokenHistory from "@/components/krc20-asset/TokenHistory";
import TokenInfo from "@/components/krc20-asset/TokenInfo";
import { setPopupPath } from "@/lib/utils.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";

export default function TokenAsset() {
  const navigate = useNavigate();
  const { ticker } = useParams();
  const [activeTab, setActiveTab] = useState<"history" | "info">("history");

  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const tokenInfo = tokenInfoResponse?.result?.[0];
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;

  useEffect(() => {
    setPopupPath();
  }, []);

  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-4 py-6">
      <Header
        title={tokenName ?? ""}
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
      {activeTab === "history" && <TokenHistory />}
      {activeTab === "info" && <TokenInfo />}
    </div>
  );
}
