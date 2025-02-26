import { useNavigate } from "react-router-dom";
import React from "react";
import warningImage from "@/assets/images/warning.png";
import Header from "@/components/GeneralHeader";
import { useLocation } from "react-router";

export const TokenOperationFailed = () => {
  const navigate = useNavigate();
  const {
    state: { error, op },
  } = useLocation();
  // TODO handle error
  console.log(error);

  const onClose = () => {
    if (op === "mint") {
      return navigate("/mint-token");
    }
    window.close();
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
