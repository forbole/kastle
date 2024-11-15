import { explorerTxLinks } from "@/components/screens/Settings.tsx";
import { useSettings } from "@/hooks/useSettings.ts";
import { useNavigate } from "react-router-dom";
import React from "react";
import warningImage from "@/assets/images/warning.png";
import Header from "@/components/GeneralHeader";

// Types for props
interface FailProps {
  transactionIds?: string[] | undefined;
}

export const FailStatus = ({ transactionIds }: FailProps) => {
  const navigate = useNavigate();
  const [settings] = useSettings();

  const networkId = settings?.networkId ?? "mainnet";
  const explorerTxLink = explorerTxLinks[networkId];

  const onClose = () => {
    navigate("/dashboard");
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
              {"The carriage couldn't deliver your KAS this time."}
              <br />
              {"Please check the recipient's address or try again later."}
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
