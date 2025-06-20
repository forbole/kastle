import { useNavigate } from "react-router-dom";
import React from "react";
import warningImage from "@/assets/images/warning.png";
import Header from "@/components/GeneralHeader";
import { ALL_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { hexToNumber } from "viem";

// Types for props
interface FailProps {
  chainId: `0x${string}`;
  transactionIds?: string[] | undefined;
  tokenName?: string;
}

export default function FailStatus({
  chainId,
  transactionIds,
  tokenName = "KAS",
}: FailProps) {
  const navigate = useNavigate();
  const selectChain = ALL_SUPPORTED_EVM_L2_CHAINS.find(
    (chain) => chain.id === hexToNumber(chainId),
  );

  const explorerLink = selectChain?.blockExplorers?.default?.url ?? "";
  const explorerTxLink = `${explorerLink}/tx/`;

  const onClose = () => {
    navigate("/dashboard");
  };

  const openTransactions = () => {
    for (const transactionId of transactionIds ?? []) {
      browser.tabs.create({
        url: `${explorerTxLink}${transactionId}`,
      });
    }
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
              {`The carriage couldn't deliver your ${tokenName} this time.`}
              <br />
              {"Please check the recipient's address or try again later."}
            </span>
          </div>
          {transactionIds?.length !== 0 && (
            <button
              type="button"
              onClick={openTransactions}
              className="flex items-center gap-2"
            >
              <span className="text-sm font-semibold text-icy-blue-400">
                View in explorer
              </span>
              {(transactionIds?.length ?? 0) > 1 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-white/10 p-3 text-xs font-medium text-white">
                  {transactionIds?.length}
                </span>
              )}
              <i className="hn hn-external-link text-icy-blue-400"></i>
            </button>
          )}
        </div>

        <button
          onClick={onClose}
          className="flex justify-center rounded-full bg-icy-blue-400 py-4 text-base font-medium text-white"
        >
          Close
        </button>
      </div>
    </div>
  );
}
