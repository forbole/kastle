import Header from "@/components/GeneralHeader.tsx";
import { useNavigate, useParams } from "react-router-dom";
import { twMerge } from "tailwind-merge";
import { useState } from "react";
import Erc20Info from "@/components/erc20-asset/Erc20Info";
import useErc20Info from "@/hooks/evm/useErc20Info";
import useErc20Balance from "@/hooks/evm/useErc20Balance";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import AssetSendButton from "@/components/AssetSendButton";

export default function Erc20Asset() {
  const navigate = useNavigate();
  const { chainId, address } = useParams();
  const [activeTab, setActiveTab] = useState<"history" | "info">("info");

  const asset = useErc20Info(
    chainId as `0x${string}`,
    address as `0x${string}`,
  );
  const { wallet, isWalletSettingsLoading } = useWalletManager();
  const { data: balance } = useErc20Balance(address ?? "", chainId ?? "");
  // As in the send asset picker: Ledger cannot send ERC-20. A wallet that has
  // not loaded yet is not known to be non-Ledger.
  const canSend =
    !!asset &&
    !isWalletSettingsLoading &&
    !!wallet &&
    wallet.type !== "ledger" &&
    (balance?.balance ?? "0") !== "0";
  const toDashboard = () => navigate("/dashboard");

  return (
    <div className="flex h-full flex-col px-4 pb-4 pt-6">
      <Header
        variant="asset"
        title={asset?.symbol ?? ""}
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

      {canSend && (
        <AssetSendButton
          ticker={asset.symbol}
          onClick={() => navigate(`/erc20/send/${chainId}/${address}`)}
        />
      )}
    </div>
  );
}
