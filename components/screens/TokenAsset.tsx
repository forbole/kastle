import Header from "@/components/GeneralHeader.tsx";
import { useNavigate, useParams } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import React, { useState } from "react";
import TokenHistory from "@/components/token-asset/TokenHistory.tsx";
import TokenInfo from "@/components/token-asset/TokenInfo.tsx";
import { setPopupPath } from "@/lib/utils.ts";

export default function TokenAsset() {
  const navigate = useNavigate();
  const { ticker } = useParams();
  const [activeTab, setActiveTab] = useState<"history" | "info">("history");

  useEffect(() => {
    setPopupPath();
  }, []);

  return (
    <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-4 py-6">
      <Header
        title={ticker ?? ""}
        onBack={() => navigate("/dashboard")}
        onClose={() => navigate("/dashboard")}
      />

      <nav className="flex gap-x-1 rounded-xl bg-daintree-800 p-1">
        <button
          type="button"
          className={twMerge(
            "inline-flex flex-grow items-center justify-center gap-x-2 rounded-lg px-4 py-3 text-center text-sm font-medium hover:text-neutral-400 focus:text-neutral-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50",
            activeTab === "history"
              ? "bg-daintree-700 text-white"
              : "bg-transparent text-[##E5E7EB]",
          )}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
        <button
          type="button"
          className={twMerge(
            "inline-flex flex-grow items-center justify-center gap-x-2 rounded-lg px-4 py-3 text-center text-sm font-medium hover:text-neutral-400 focus:text-neutral-400 focus:outline-none disabled:pointer-events-none disabled:opacity-50",
            activeTab === "info"
              ? "bg-daintree-700 text-white"
              : "bg-transparent text-neutral-500",
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
