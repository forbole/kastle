import { Erc20Asset } from "@/contexts/EvmAssets";
import kasIcon from "@/assets/images/kas-icon.svg";
import { walletAddressEllipsis } from "@/lib/utils.ts";

export default function Erc20Asset({ asset }: { asset: Erc20Asset }) {
  const [settings] = useSettings();

  return (
    <div className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white">
      <img
        alt="castle"
        className="h-[40px] w-[40px] rounded-full"
        src={asset.image ?? kasIcon}
      />
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-start justify-between text-base text-white">
          <div className="flex flex-col gap-1">
            <span>{asset.symbol}</span>
            <span className="text-xs text-daintree-400">
              {walletAddressEllipsis(asset.address)}
            </span>
            <span className="text-xs text-daintree-400">
              Layer 2 ID: {asset.chainId}
            </span>
          </div>
          {/*<span>{showBalance ? formatToken(balanceNumber) : "*****"}</span> */}
        </div>
        <div className="flex items-center justify-between text-sm text-daintree-400">
          <span>
            {/*{formatTokenPrice(tokenPriceCurrency, tokenPriceCurrencyCode)} */}
          </span>
          {/*<span>
            ≈{" "}
            {showBalance
              ? formatCurrency(totalBalanceCurrency, currencyCode)
              : `${symbolForCurrencyCode(currencyCode)}*****`}
          </span>*/}
        </div>
      </div>
    </div>
  );
}
