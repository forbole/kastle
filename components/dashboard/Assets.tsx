import { useNavigate } from "react-router-dom";
import kasIcon from "@/assets/images/kas-icon.svg";
import { formatToken, formatTokenPrice, formatUSD } from "@/lib/utils.ts";
import TokenListItem from "@/components/dashboard/TokenListItem.tsx";
import { applyDecimal } from "@/lib/krc20.ts";

export default function Assets() {
  const navigate = useNavigate();
  const kaspaPrice = useKaspaPrice();

  const [settings] = useSettings();
  const { account } = useWalletManager();

  const address = account?.address;
  const balance = account?.balance;
  const showBalance = !settings?.hideBalances;

  const { data: tokenListResponse } = useTokenListByAddress(address, 5000);
  const tokenListItems = tokenListResponse?.result
    ? tokenListResponse.result
    : [];
  const tokens = tokenListItems.sort((a, b) => {
    const { toFloat: aToFloat } = applyDecimal(a.dec);
    const { toFloat: bToFloat } = applyDecimal(b.dec);

    return (
      bToFloat(parseInt(b.balance, 10)) - aToFloat(parseInt(a.balance, 10))
    );
  });

  const isAssetListLoading = account?.balance === undefined;

  return isAssetListLoading ? (
    <div className="flex animate-pulse items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3">
      <span className="block size-12 rounded-full bg-daintree-700"></span>
      <div className="h-[44px] flex-grow self-center rounded-xl bg-daintree-700" />
    </div>
  ) : (
    <div className="mb-4 flex flex-col items-stretch gap-2">
      {/*KAS*/}
      <div
        className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
        onClick={() => navigate("/kas-asset")}
      >
        <img alt="castle" className="h-[40px] w-[40px]" src={kasIcon} />
        <div className="flex flex-grow flex-col gap-1">
          <div className="flex items-center justify-between text-base text-white">
            <span>KAS</span>
            <span>
              {showBalance ? formatToken(parseFloat(balance ?? "0")) : "*****"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm text-daintree-400">
            <span>{formatTokenPrice(kapsaPrice.kaspaPrice)}</span>
            <span>
              ≈{" "}
              {showBalance
                ? formatUSD(parseFloat(balance ?? "0") * kapsaPrice.kaspaPrice)
                : "$*****"}{" "}
              USD
            </span>
          </div>
        </div>
      </div>

      {/*KRC20 tokens*/}
      {tokens.map((token) => (
        <TokenListItem key={token.tick} token={token} />
      ))}
    </div>
  );
}
