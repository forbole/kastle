import { explorerTxLinks } from "@/components/screens/Settings.tsx";
import { useSettings } from "@/hooks/useSettings.ts";
import React from "react";
import { useNavigate } from "react-router-dom";
import successImage from "@/assets/images/success.png";
import Header from "@/components/GeneralHeader";

interface SuccessProps {
  transactionIds?: string[] | undefined;
}

export const SuccessStatus = ({ transactionIds }: SuccessProps) => {
  const navigate = useNavigate();
  const [settings] = useSettings();

  const networkId = settings?.networkId ?? "mainnet";
  const explorerTxLink = explorerTxLinks[networkId];

  const onClose = () => {
    navigate("/dashboard");
  };

  return (
    <div className="flex h-full flex-col">
      <Header title="KAS Dispatched!" showPrevious={false} showClose={false} />
      <div className="mt-20 flex flex-1 flex-col justify-between">
        <div className="flex flex-col items-center gap-4">
          <img src={successImage} alt="Success" className="mx-auto h-24 w-24" />
          <div className="flex flex-col gap-2 text-center">
            <span className="text-xl font-semibold text-[#14B8A6]">
              Success
            </span>
            <span className="px-10 text-sm text-gray-400">
              {"Your KAS has been sent to the recipient's address"}
            </span>
          </div>
          {transactionIds?.map((txHash) => (
            <a
              key={txHash}
              href={`${explorerTxLink}${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2"
            >
              <span className="text-sm font-semibold text-icy-blue-400">
                View in explorer
              </span>
              <i className="hn hn-external-link text-icy-blue-400"></i>
            </a>
          ))}
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
};
