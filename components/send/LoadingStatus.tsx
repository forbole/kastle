import React from "react";
import carriageImage from "@/assets/images/carriage.png";
import Header from "@/components/GeneralHeader";
export const LoadingStatus = () => {
  return (
    <>
      <Header title="Broadcasting" showPrevious={false} showClose={false} />

      <div className="mt-10 flex h-full flex-col items-center gap-4">
        <img
          alt="castle"
          className="h-[120px] w-[299px] self-center"
          src={carriageImage}
        />
        <span className="text-xl font-semibold text-daintree-400">
          Broadcasting...
        </span>
      </div>
    </>
  );
};
