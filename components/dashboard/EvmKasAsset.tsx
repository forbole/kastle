import Layer2AssetImage from "../Layer2AssetImage";
import { getChainImage } from "@/lib/layer2";
import { useNavigate } from "react-router-dom";
import {
  formatCurrency,
  formatTokenPrice,
  symbolForCurrencyCode,
} from "@/lib/utils.ts";
import { useSettings } from "@/hooks/useSettings";
import kasIcon from "@/assets/images/kas-icon.svg";
import useEvmKasBalance from "@/hooks/evm/useEvmKasBalance";

export default function EvmKasAsset({ chainId }: { chainId: `0x${string}` }) {
  const [settings] = useSettings();
  const navigate = useNavigate();
  const kaspaPrice = useKaspaPrice();
  const { data } = useEvmKasBalance(chainId);
  const balance = data?.balance ?? "0";

  const fiatKaspaPrice = kaspaPrice.kaspaPrice;
  const fiatBalance = parseFloat(balance ?? "0") * kaspaPrice.kaspaPrice;

  const { amount: tokenPriceCurrency, code: tokenPriceCurrencyCode } =
    useCurrencyValue(fiatKaspaPrice);
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(fiatBalance);

  const showBalance = !settings?.hideBalances;

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
      onClick={() => navigate(`/evm-asset/${chainId}`)}
    >
      <Layer2AssetImage
        tokenImage={kasIcon}
        chainImage={getChainImage(chainId as `0x${string}`)}
      />
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-start justify-between text-base text-white">
          <div className="flex flex-col gap-1">
            <span>KAS</span>
          </div>
          <span>{showBalance ? balance : "*****"}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-daintree-400">
          <span>
            {formatTokenPrice(tokenPriceCurrency, tokenPriceCurrencyCode)}
          </span>
          <span>
            ≈{" "}
            {showBalance
              ? formatCurrency(totalBalanceCurrency, currencyCode)
              : `${symbolForCurrencyCode(currencyCode)}*****`}
          </span>
        </div>
      </div>
    </div>
  );
}
