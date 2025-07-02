import { formatCurrency } from "@/lib/utils.ts";
import { textEllipsis } from "@/lib/utils.ts";
import HoverShowAllCopy from "@/components/HoverShowAllCopy";
import { Erc20Asset } from "@/contexts/EvmAssets";
import { getChainName, getChainImage } from "@/lib/layer2";
import Layer2AssetImage from "@/components/Layer2AssetImage";
import useCurrencyValue from "@/hooks/useCurrencyValue";

export default function Erc20Info({ asset }: { asset: Erc20Asset }) {
  // TODO: Update it when erc20 token has price API
  const { amount: amountCurrency, code: amountCurrencyCode } =
    useCurrencyValue(0);

  return (
    <div className="mt-8 flex flex-col items-stretch gap-2">
      {/* Header card */}
      <div className="flex items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
        <Layer2AssetImage
          tokenImage={asset.image}
          chainImage={getChainImage(asset.chainId)}
        />
        <div className="flex flex-grow flex-col gap-1">
          <div className="flex items-center justify-between text-base text-white">
            <span className="capitalize">{asset.symbol}</span>
          </div>
          <div className="flex items-center justify-start text-sm text-daintree-400">
            <span>≈ {formatCurrency(amountCurrency, amountCurrencyCode)}</span>
          </div>
        </div>
        <div className="rounded-full border border-icy-blue-400 px-1 text-[0.625rem] text-icy-blue-400">
          {getChainName(asset.chainId).replace(" Testnet", "")}
        </div>
      </div>

      {/*Details*/}
      <ul className="mt-3 flex flex-col rounded-lg bg-daintree-800">
        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Network</span>
            {getChainName(asset.chainId)}
          </div>
        </li>

        <li className="-mt-px inline-flex items-center gap-x-2 border border-daintree-700 px-4 py-3 text-sm first:mt-0 first:rounded-t-lg last:rounded-b-lg">
          <div className="flex w-full items-start justify-between">
            <span className="font-medium">Contract Address</span>
            {asset?.address && (
              <HoverShowAllCopy
                text={asset.address}
                style={{
                  fontSize: "14px",
                  lineBreak: "normal",
                  textAlign: "center",
                }}
              >
                <span className="cursor-pointer text-sm text-daintree-400">
                  {textEllipsis(asset?.address)}
                </span>
              </HoverShowAllCopy>
            )}
          </div>
        </li>
      </ul>
    </div>
  );
}
