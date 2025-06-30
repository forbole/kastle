import React from "react";
import { formatCurrency } from "@/lib/utils.ts";
import kasIcon from "@/assets/images/kas-icon.svg";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { getChainName, getChainImage } from "@/lib/layer2";
import Layer2AssetImage from "../Layer2AssetImage";

export default function EvmKasInfo({ chainId }: { chainId: `0x${string}` }) {
  const { kaspaPrice } = useKaspaPrice();
  const { amount: kaspaCurrency, code: kaspaCurrencyCode } =
    useCurrencyValue(kaspaPrice);

  return (
    <div className="mb-4 mt-8 flex flex-col items-stretch gap-2">
      {/* Header card */}
      <div className="flex items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
        <Layer2AssetImage
          tokenImage={kasIcon}
          chainImage={getChainImage(chainId)}
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
          {getChainName(chainId)}
        </div>
      </div>

      {/*Details*/}
      <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Network</span>
            <span className="font-medium">{getChainName(chainId)}</span>
          </div>
        </li>
      </ul>
    </div>
  );
}
