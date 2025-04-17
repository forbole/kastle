import React from "react";
import carriageImage from "@/assets/images/carriage.png";
import Header from "@/components/GeneralHeader";

export default function Broadcasting() {
  return (
    <div className="space-y-14">
      <Header title="Broadcasting" showClose={false} showPrevious={false} />

      <div className="flex h-full flex-col items-center gap-4">
        <img
          alt="castle"
          className="h-[120px] w-[299px] self-center"
          src={carriageImage}
        />
        <span className="text-xl font-semibold text-daintree-400">
          Broadcasting...
        </span>
      </div>
    </div>
  );
}
