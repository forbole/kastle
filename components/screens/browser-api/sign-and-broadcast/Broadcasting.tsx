import React from "react";
import carriageImage from "@/assets/images/carriage.png";

export default function Broadcasting() {
  return (
    <div className="space-y-20">
      <div className="flex items-center justify-center">
        <h1 className="text-center text-xl font-semibold">Broadcasting</h1>
      </div>

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
