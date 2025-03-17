import React from "react";
import { formatToken } from "@/lib/utils.ts";
import kasIcon from "@/assets/images/kas-icon.svg";

export default function KasInfo() {
  const { kaspaPrice } = useKaspaPrice();

  return (
    <div className="mb-4 mt-8 flex flex-col items-stretch gap-2">
      {/* Header card */}
      <div className="flex flex-col items-stretch gap-2">
        <div className="flex items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
          <img
            alt="castle"
            className="h-[40px] w-[40px] rounded-full"
            src={kasIcon}
          />
          <div className="flex flex-grow flex-col gap-1">
            <div className="flex items-center justify-between text-base text-white">
              <span className="capitalize">KAS</span>
            </div>
            <div className="flex items-center justify-start text-sm text-daintree-400">
              <span>≈ {formatToken(kaspaPrice ?? 0)} USD</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
