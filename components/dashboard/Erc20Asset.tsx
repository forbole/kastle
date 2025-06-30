import { Erc20Asset } from "@/contexts/EvmAssets";
import useErc20Balance from "@/hooks/evm/useErc20Balance";
import Layer2AssetImage from "../Layer2AssetImage";
import { getChainImage } from "@/lib/layer2";
import { useNavigate } from "react-router-dom";
import {
  formatCurrency,
  formatTokenPrice,
  symbolForCurrencyCode,
  formatToken,
} from "@/lib/utils.ts";

export default function Erc20Asset({ asset }: { asset: Erc20Asset }) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { data } = useErc20Balance(
    asset.address,
    asset.decimals,
    asset.chainId,
  );

  // TODO: Update it when erc20 token has price API
  const { amount: tokenPriceCurrency, code: tokenPriceCurrencyCode } =
    useCurrencyValue(0);
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(0);

  const showBalance = !settings?.hideBalances;
  const balance = formatToken(parseFloat(data?.balance ?? "0"));

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
      onClick={() => navigate(`/erc20-asset/${asset.chainId}/${asset.address}`)}
    >
      <Layer2AssetImage
        tokenImage={asset.image}
        chainImage={getChainImage(asset.chainId as `0x${string}`)}
      />
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-start justify-between text-base text-white">
          <div className="flex flex-col gap-1">
            <span>{asset.symbol}</span>
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
