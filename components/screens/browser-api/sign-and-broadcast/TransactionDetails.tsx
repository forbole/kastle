import React, { useState } from "react";
import { SignAndBroadcastTxPayload } from "@/api/message";
import TransactionDetailsBox from "@/components/screens/browser-api/sign-and-broadcast/TransactionBox";

export default function TransactionDetails({
  payload,
}: {
  payload: SignAndBroadcastTxPayload;
}) {
  const [activeTab, setActiveTab] = useState<"transaction" | "scripts">(
    "transaction",
  );

  return (
    <div>
      <div className="flex min-h-screen items-center justify-center bg-gray-900 p-4">
        <div className="flex w-full max-w-xs rounded-lg bg-gray-800 p-1">
          <button
            className={`flex-1 rounded-md px-4 py-2 text-center text-sm font-medium transition-colors duration-200 ${
              activeTab === "transaction"
                ? "bg-gray-700"
                : "text-gray-400 hover:text-gray-300"
            }`}
            onClick={() => setActiveTab("transaction")}
          >
            Transactions
          </button>
          <button
            className={`flex-1 rounded-md px-4 py-2 text-center text-sm font-medium transition-colors duration-200 ${
              activeTab === "scripts"
                ? "bg-gray-700"
                : "text-gray-400 hover:text-gray-300"
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
      {activeTab === "scripts" && (
        <div>
          Scripts:
          {payload.scripts?.map((script, index) => (
            <div key={index} className="border">
              <div>Input Index: {script.inputIndex}</div>
              <div>Script: {script.scriptHex}</div>
              <div>Sign Type: {script.signType}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
