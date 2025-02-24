import React from "react";
import { useNavigate } from "react-router-dom";
import internalToast from "@/components/Toast.tsx";
import { v4 as uuid } from "uuid";

export default function AddWallet() {
  const { createNewWallet } = useWalletManager();
  const navigate = useNavigate();

  const onClose = () => navigate("/dashboard");

  const newWallet = async () => {
    await createNewWallet(uuid());

    internalToast.success("Wallet has been created successfully !");
    navigate("/dashboard");
  };

  return (
    <div className="flex h-full flex-col gap-6 p-4 text-white">
      <div className="flex items-center justify-between">
        {/* Placeholder */}
        <div className="w-[40px]" />

        <h1 className="text-xl font-bold">Create/Import Wallet</h1>

        <button
          onClick={onClose}
          className="flex h-12 w-12 items-center justify-center"
        >
          <i className="hn hn-times text-xl"></i>
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <button
          className="flex w-full items-center justify-between rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
          onClick={newWallet}
        >
          <span className="text-base">Create new recovery phrase</span>
          <i className="hn hn-arrow-right flex-none text-[14px]"></i>
        </button>
        <button
          className="flex w-full items-center justify-between rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
          onClick={() =>
            browser.tabs.create({ url: "/popup.html#/import-recovery-phrase" })
          }
        >
          <span className="text-base">Import with Recovery phrase</span>
          <i className="hn hn-arrow-right flex-none text-[14px]"></i>
        </button>
        <button
          className="flex w-full items-center justify-between rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
          onClick={() =>
            browser.tabs.create({ url: "/popup.html#/import-private-key" })
          }
        >
          <span className="text-base">Import with Private Key</span>
          <i className="hn hn-arrow-right flex-none text-[14px]"></i>
        </button>

        {/* Ledger */}
        <button
          className="flex w-full items-center justify-between rounded-xl border border-daintree-700 bg-[#1E343D] p-5 hover:border-white"
          onClick={() => {
            browser.tabs.create({ url: "/popup.html#/import-ledger-start" });
          }}
        >
          <span className="text-base">Import with Ledger</span>
          <i className="hn hn-arrow-right flex-none text-[14px]"></i>
        </button>
      </div>
    </div>
  );
}
