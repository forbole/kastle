import kasIcon from "@/assets/images/network-logos/kaspa.svg";
import {
  formatCurrency,
  formatToken,
  formatTokenPrice,
  symbolForCurrencyCode,
  textEllipsis,
} from "@/lib/utils.ts";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { applyDecimal } from "@/lib/krc20.ts";
import { TokenItem } from "@/hooks/kasplex/useTokenListByAddress";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import Layer2AssetImage from "../Layer2AssetImage";
import { useKrc20Prices } from "@/hooks/kasplex/useKrc20Prices";
import useKrc20Logo from "@/hooks/kasplex/useKrc20Logo";
import { formatUnits } from "viem";
import { Kcc20Token } from "@/lib/kcc20";
import { useFeatureFlags } from "@/hooks/useFeatureFlags.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import { formatKcc20Amount, KCC20_LABELS } from "@/ui/popup/kcc20/labels";
import { useKcc20Price } from "@/lib/kcc20/useKcc20Price";

// A token no market prices reads as unknown, never as worth zero.
const NO_PRICE = "—";

type TokenListItemProps = {
  token: TokenItem;
};

export default function TokenListItem({ token }: TokenListItemProps) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const [imageUrl, setImageUrl] = useState(kasIcon);
  const { data: tokenInfoResponse } = useTokenInfo(token.id);
  const { price } = useKrc20Prices(token.id);
  const { logo } = useKrc20Logo(token.id);

  const showBalance = !settings?.hideBalances;

  const { toFloat } = applyDecimal(token.dec);
  const balanceNumber = toFloat(
    token.balance ? parseInt(token.balance, 10) : 0,
  );
  const fiatTokenPrice = price ?? 0;
  const fiatBalance = balanceNumber * fiatTokenPrice;
  const { amount: tokenPriceCurrency, code: tokenPriceCurrencyCode } =
    useCurrencyValue(fiatTokenPrice);
  const { amount: totalBalanceCurrency, code: currencyCode } =
    useCurrencyValue(fiatBalance);

  useEffect(() => {
    if (logo) {
      setImageUrl(logo);
    }
  }, [logo]);

  const tokenInfo = tokenInfoResponse?.result?.[0];
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 hover:border-white"
      onClick={() => navigate(`/token-asset/${token.id}`)}
    >
      <Layer2AssetImage tokenImage={imageUrl} chainImage={kasIcon} />
      <div className="flex flex-grow flex-col gap-1">
        <div className="flex items-start justify-between text-base text-white">
          <div className="flex flex-col gap-1">
            <span>{tokenName}</span>
          </div>
          <span>{showBalance ? formatToken(balanceNumber) : "*****"}</span>
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

export function Kcc20TokenListItem({ token }: { token: Kcc20Token }) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { isKcc20Enabled } = useFeatureFlags();
  const { meta } = token;
  const { wallet } = useWalletManager();
  // Same guard as the kcc20 routes; the detail page decides whether Send shows.
  const canOpen = isKcc20Enabled && wallet?.type !== "ledger";
  // Without decimals the scale is unknown: grouped base units, never a guess.
  const balance = formatKcc20Amount(token.amount, meta?.decimals);
  const showBalance = !settings?.hideBalances;
  const { priceUsd } = useKcc20Price(token);
  // No verified decimals, no whole-token balance to value.
  const valueUsd =
    priceUsd === undefined || !meta
      ? undefined
      : Number(formatUnits(token.amount, meta.decimals)) * priceUsd;
  const { amount: fiatPrice, code: currencyCode } = useCurrencyValue(
    priceUsd ?? 0,
  );
  const { amount: fiatValue } = useCurrencyValue(valueUsd ?? 0);

  return (
    <button
      type="button"
      className={`flex w-full items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 text-left hover:border-white ${canOpen ? "cursor-pointer" : "cursor-default"}`}
      disabled={!canOpen}
      onClick={() =>
        navigate(
          `/kcc20/${token.covenantId}${
            token.extensionCommitment ? `?ext=${token.extensionCommitment}` : ""
          }`,
        )
      }
    >
      <Layer2AssetImage tokenImage={meta?.logoURI} chainImage={kasIcon} />
      <div className="flex min-w-0 flex-grow flex-col gap-1">
        <div className="flex items-start justify-between gap-2 text-base text-white">
          {/* As mobile: the ticker; a nameless token falls back to its short id. */}
          <span>
            {(meta?.symbol ?? token.tick) || (
              <span className="font-mono">
                {textEllipsis(token.covenantId)}
              </span>
            )}
          </span>
          <span className="break-all text-right">
            {showBalance ? balance : "*****"}
            {/* kascov held cells back: the balance may be short. */}
            {showBalance && token.truncated && "+"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-daintree-400">
          {meta?.name}
          {/* One quiet marker: kascov's claimed metadata, or none at all. */}
          {(!meta || meta.unverified) && (
            <span className="text-xs text-daintree-600">
              {KCC20_LABELS.unverified}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between text-sm text-daintree-400">
          <span>
            {priceUsd === undefined
              ? NO_PRICE
              : formatTokenPrice(fiatPrice, currencyCode)}
          </span>
          <span>
            ≈{" "}
            {!showBalance
              ? `${symbolForCurrencyCode(currencyCode)}*****`
              : valueUsd === undefined
                ? NO_PRICE
                : formatCurrency(fiatValue, currencyCode)}
          </span>
        </div>
      </div>
    </button>
  );
}
