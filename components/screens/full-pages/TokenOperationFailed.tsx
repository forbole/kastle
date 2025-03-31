import { useNavigate } from "react-router-dom";
import React from "react";
import warningImage from "@/assets/images/warning.png";
import Header from "@/components/GeneralHeader";
import { useLocation } from "react-router";
import { useTokenInfo } from "@/hooks/useTokenInfo.ts";
import { applyDecimal } from "@/lib/krc20.ts";
import { setPopupPath } from "@/lib/utils.ts";
import useExtensionUtils from "@/hooks/useExtensionUtils.ts";

export const TokenOperationFailed = () => {
  const { reopenPopup } = useExtensionUtils();
  const navigate = useNavigate();
  const {
    state: { error, op, ticker, timesMinted, mintTimes },
  } = useLocation();
  const { data: tokenInfoResponse } = useTokenInfo(ticker);
  const tokenInfo = tokenInfoResponse?.result?.[0];
  const { toFloat } = applyDecimal(tokenInfo?.dec);
  const mintAmount = toFloat(parseInt(tokenInfo?.lim ?? "0", 10));

  const getErrorType = () => {
    if (error instanceof Error) {
      if (error.message.includes("disconnected")) {
        return "disconnected";
      }
      if (
        error.message === "Reveal transaction did not mature within 2 minutes"
      ) {
        return "reveal_timeout";
      }
      if (
        error.message === "Commit transaction did not mature within 2 minutes"
      ) {
        return "commit_timeout";
      }
    }

    return "default";
  };

  const reason = {
    disconnected: {
      title: "Minting Incomplete: Network Error",
      message: (
        <div>
          Network disconnected. Only some tokens were minted.
          <br /> Please try again.
        </div>
      ),
    },
    reveal_timeout: {
      title: "Minting Incomplete: Mempool timeout",
      message: (
        <div>
          Timeout occurred, the reveal transaction have been rejected, please
          try again later
        </div>
      ),
    },
    commit_timeout: {
      title: "Minting Incomplete: Mempool timeout",
      message: (
        <div>
          Timeout occurred, the commit transaction have been rejected, please
          try again later
        </div>
      ),
    },
    default: {
      title: "Minting Incomplete",
      message: (
        <div>Something unexpected happened during the mint: {error}</div>
      ),
    },
  }[getErrorType()];

  const onClose = () => {
    switch (op) {
      case "mint":
        return navigate("/mint-token");
      case "deploy":
        return navigate("/deploy-token");
      default:
        window.close();
        break;
    }
  };

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header title="Oops!" showPrevious={false} showClose={false} />

        <div className="mt-20 flex flex-1 flex-col justify-between">
          <div className="flex flex-col items-center gap-4">
            <img
              src={warningImage}
              alt="Warning"
              className="mx-auto h-24 w-24"
            />
            {op === "mint" ? (
              <div className="flex flex-col gap-2 text-center">
                <span className="text-xl font-semibold text-red-500">
                  {reason.title}
                </span>
                <span className="px-2 text-sm text-gray-500">
                  {reason.message}
                </span>

                <div className="flex flex-col gap-4 self-center rounded-lg border border-daintree-700 p-6">
                  <div className="flex items-center justify-center gap-1 text-base font-semibold">
                    <i className="hn hn-check-circle text-[#14B8A6]"></i>
                    <div className="flex">
                      <span className="text-[#14B8A6]">
                        {mintAmount * timesMinted}
                      </span>
                      <span>{`/${mintAmount * mintTimes} ${ticker} Completed`}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="flex items-center justify-center gap-2"
                    onClick={() => {
                      setPopupPath(`/token-asset/${ticker}`, reopenPopup);
                    }}
                  >
                    <span className="text-sm font-semibold text-icy-blue-400">
                      View transaction history
                    </span>
                    <i className="hn hn-angle-right text-icy-blue-400"></i>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 text-center">
                <span className="text-xl font-semibold text-red-500">
                  Sorry, Your Majesty.
                </span>
                <span className="px-2 text-sm text-gray-500">
                  {
                    "It seems the alchemists have faltered in their craft, and your token could not be forged."
                  }
                  <br />
                  {"Please try again later."}
                </span>
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="flex justify-center rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
};
