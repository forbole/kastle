import React from "react";
import { formatCurrency } from "@/lib/utils.ts";
import kasIcon from "@/assets/images/kas-icon.svg";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { useSettings } from "@/hooks/useSettings";

export default function KasInfo() {
  const { kaspaPrice } = useKaspaPrice();
  const { amount: kaspaCurrency, code: kaspaCurrencyCode } =
    useCurrencyValue(kaspaPrice);
  const [settings] = useSettings();
  const network = settings?.networkId ?? "mainnet";

  return (
    <div className="mb-4 mt-8 flex flex-col items-stretch gap-2">
      {/* Header card */}
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
            <span>≈ {formatCurrency(kaspaCurrency, kaspaCurrencyCode)} </span>
          </div>
        </div>
        <div className="rounded-full border border-icy-blue-400 px-1 text-[0.625rem] text-icy-blue-400">
          {network === "mainnet" ? "Kaspa Mainnet" : "Kaspa Testnet"}
        </div>
      </div>
    </div>
  );
}
