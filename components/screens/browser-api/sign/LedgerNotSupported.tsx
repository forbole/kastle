import React from "react";
import warningImage from "@/assets/images/warning.png";
import Header from "@/components/GeneralHeader";

export default function LedgerNotSupported() {
  const onClose = () => {
    window.close();
  };

  return (
    <div className="flex h-full flex-col">
      <Header title="Oops!" showPrevious={false} showClose={false} />

      <div className="mt-20 flex flex-1 flex-col justify-between">
        <div className="flex flex-col items-center gap-4">
          <img src={warningImage} alt="Warning" className="mx-auto h-24 w-24" />
          <div className="flex flex-col gap-2 text-center">
            <span className="text-xl font-semibold text-red-500">
              Sorry, Your Majesty.
            </span>
            <span className="px-2 text-sm text-gray-500">
              {"Advanced Script Transaction are not supported on Ledger."}
            </span>
            <div className="rounded bg-[#203C49] p-2 text-sm">
              {
                "Ledger currently does not support Advanced Script Transactions (e.g. KRC20). To proceed, please switch to a non-Ledger account."
              }
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="flex justify-center rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}
