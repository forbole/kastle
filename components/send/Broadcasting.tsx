import React, { useEffect } from "react";
import carriageImage from "@/assets/images/carriage.png";
import Header from "@/components/GeneralHeader";

export const Broadcasting = ({ onSuccess }: { onSuccess: () => void }) => {
  useEffect(() => {
    const timeout = setTimeout(() => {
      onSuccess();
    }, 1000); // Delay to prevent the page from flickering

    return () => {
      clearTimeout(timeout);
    };
  });

  return (
    <>
      <Header title="Sending" showPrevious={false} showClose={false} />

      <div className="mt-10 flex h-full flex-col items-center gap-4">
        <img
          alt="castle"
          className="h-[120px] w-[299px] self-center"
          src={carriageImage}
        />
        <span className="text-xl font-semibold text-daintree-400">
          Sending...
        </span>
      </div>
    </>
  );
};
