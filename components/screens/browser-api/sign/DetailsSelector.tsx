import React, { useState } from "react";
import { SignTxPayload } from "@/api/message";
import TransactionDetailsBox from "@/components/screens/browser-api/sign/TransactionBox";
import ScriptItem from "@/components/screens/browser-api/sign/ScriptItem";

export default function DetailsSelector({
  payload,
}: {
  payload: SignTxPayload;
}) {
  const [activeTab, setActiveTab] = useState<"transaction" | "scripts">(
    "transaction",
  );

  return (
    <div className="w-full space-y-3 pb-3">
      <div className="flex w-full items-center justify-center">
        <div className="flex w-full rounded-lg bg-[#102832] text-[#E5E7EB]">
          <button
            className={`flex-1 rounded-md px-4 py-2 text-center text-sm font-medium transition-colors duration-200 ${
              activeTab === "transaction" ? "bg-[#203C49]" : "hover:text-white"
            }`}
            onClick={() => setActiveTab("transaction")}
          >
            Transactions
          </button>
          <button
            className={`flex-1 rounded-md px-4 py-2 text-center text-sm font-medium transition-colors duration-200 ${
              activeTab === "scripts" ? "bg-[#203C49]" : "hover:text-white"
            }`}
            onClick={() => setActiveTab("scripts")}
          >
            Scripts
          </button>
        </div>
      </div>

      {/* Details */}
      {activeTab === "transaction" && (
        <TransactionDetailsBox jsonContent={payload.txJson} />
      )}

      {/* Scripts */}
      <div className="space-y-3">
        {activeTab === "scripts" && !payload.scripts && (
          <div className="text-center text-[#7B9AAA]">No scripts</div>
        )}
        {activeTab === "scripts" &&
          payload.scripts &&
          payload.scripts.map((script, index) => (
            <ScriptItem key={index} script={script} />
          ))}
      </div>
    </div>
  );
}
