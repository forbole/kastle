import React from "react";
import successImage from "@/assets/images/success.png";
import Header from "@/components/GeneralHeader";
import { useLocation } from "react-router";
import { setPopupPath } from "@/lib/utils.ts";

export const TokenOperationSuccess = () => {
  const {
    state: { ticker, op },
  } = useLocation();

  const opTitle: Record<string, string> = {
    transfer: `${ticker} Dispatched`,
    deploy: `${ticker} Deployed`,
    mint: `${ticker} Minted`,
  };

  const opDescription: Record<string, string> = {
    transfer: `Your ${ticker} has been sent to the recipient's address`,
    deploy: "A new token has been forged",
    mint: `${ticker} has been forged!`,
  };
  const title = opTitle[op];
  const description = opDescription[op];

  return (
    <div className="flex w-[41rem] flex-col items-stretch gap-4 rounded-3xl bg-icy-blue-950">
      <div className="no-scrollbar flex h-full flex-col overflow-y-scroll px-10 pb-12 pt-4 text-white">
        <Header title={title} showPrevious={false} showClose={false} />
        <div className="mt-20 flex flex-1 flex-col justify-between">
          <div className="flex flex-col items-center gap-4">
            <img
              src={successImage}
              alt="Success"
              className="mx-auto h-24 w-24"
            />
            <div className="flex flex-col gap-2 text-center">
              <span className="text-xl font-semibold text-[#14B8A6]">
                Success
              </span>
              <span className="px-10 text-sm text-gray-400">{description}</span>
            </div>

            <button
              type="button"
              className="flex items-center gap-2"
              onClick={() =>
                setPopupPath(`/token-asset/${ticker}`, () =>
                  browser.action.openPopup(),
                )
              }
            >
              <span className="text-sm font-semibold text-icy-blue-400">
                View transaction history
              </span>
              <i className="hn hn-angle-right text-icy-blue-400"></i>
            </button>
          </div>

          <button
            onClick={() => browser.action.openPopup()}
            className="flex justify-center rounded-full bg-icy-blue-400 py-4 text-lg font-medium text-white"
          >
            Back to extension
          </button>
        </div>
      </div>
    </div>
  );
};
