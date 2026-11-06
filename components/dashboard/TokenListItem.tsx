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
import TokenRow from "@/ui/popup/dashboard/TokenRow";
import Switch from "@/ui/general/Switch";

/** Manage mode: the row stops navigating and carries a shown/hidden switch. */
export type ManageRow = {
  shown: boolean;
  onToggle: (shown: boolean) => void;
};

const ROW =
  "flex w-full items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 text-left hover:border-white";

function ManagedRow({
  manage,
  label,
  children,
}: {
  manage: ManageRow;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={ROW} data-testid="manage-row">
      {children}
      <Switch
        checked={manage.shown}
        onChange={manage.onToggle}
        label={`Show ${label}`}
      />
    </div>
  );
}

type TokenListItemProps = {
  token: TokenItem;
  manage?: ManageRow;
};

export default function TokenListItem({ token, manage }: TokenListItemProps) {
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

  const body = (
    <>
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
    </>
  );

  if (manage)
    return (
      <ManagedRow manage={manage} label={tokenName || token.id}>
        {body}
      </ManagedRow>
    );

  return (
    <div
      className={`${ROW} cursor-pointer`}
      onClick={() => navigate(`/token-asset/${token.id}`)}
    >
      {body}
    </div>
  );
}

const COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

// The overflow fallback of formatKcc20Amount: same scale rule, compact digits.
// None when it would not be shorter, or would round a holding down to "0".
function compactKcc20Amount(amount: bigint, decimals?: number) {
  const full = formatKcc20Amount(amount, decimals);
  const short =
    decimals === undefined
      ? `${COMPACT.format(amount)} ${KCC20_LABELS.baseUnits}`
      : COMPACT.format(Number(formatUnits(amount, decimals)));
  if (short.length >= full.length || (short === "0" && amount !== 0n)) return;
  return short;
}

export function Kcc20TokenListItem({
  token,
  manage,
}: {
  token: Kcc20Token;
  manage?: ManageRow;
}) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { isKcc20Enabled } = useFeatureFlags();
  const { meta } = token;
  const { wallet } = useWalletManager();
  // Same guard as the kcc20 routes; the detail page decides whether Send shows.
  const canOpen = isKcc20Enabled && wallet?.type !== "ledger";
  const showBalance = !settings?.hideBalances;
  const { priceUsd } = useKcc20Price(token);
  // No verified decimals, no whole-token balance to value.
  const valueUsd =
    priceUsd === undefined || meta?.decimals === undefined
      ? undefined
      : Number(formatUnits(token.amount, meta.decimals)) * priceUsd;
  const { amount: fiatPrice, code: currencyCode } = useCurrencyValue(
    priceUsd ?? 0,
  );
  const { amount: fiatValue } = useCurrencyValue(valueUsd ?? 0);

  // Without decimals the scale is unknown: grouped base units, never a guess.
  // kascov held cells back when truncated: the balance may be short.
  const more = token.truncated ? "+" : "";
  const balance = showBalance
    ? `${formatKcc20Amount(token.amount, meta?.decimals)}${more}`
    : "*****";
  const compact = showBalance
    ? compactKcc20Amount(token.amount, meta?.decimals)
    : undefined;
  const compactBalance =
    compact === undefined ? undefined : `${compact}${more}`;
  // An unpriced token shows no fiat at all: no placeholder, never $0.
  const fiat =
    valueUsd === undefined
      ? undefined
      : `≈ ${
          showBalance
            ? formatCurrency(fiatValue, currencyCode)
            : `${symbolForCurrencyCode(currencyCode)}*****`
        }`;

  const ticker =
    // A nameless token falls back to its short id.
    (meta?.symbol ?? token.tick) || (
      <span className="font-mono">{textEllipsis(token.covenantId)}</span>
    );
  const row = (
    <TokenRow
      logo={meta?.logoURI}
      ticker={ticker}
      price={
        priceUsd === undefined
          ? undefined
          : formatTokenPrice(fiatPrice, currencyCode)
      }
      balance={balance}
      compactBalance={compactBalance}
      fiat={fiat}
    />
  );

  if (manage)
    return (
      <ManagedRow
        manage={manage}
        label={(meta?.symbol ?? token.tick) || textEllipsis(token.covenantId)}
      >
        {row}
      </ManagedRow>
    );

  return (
    <button
      type="button"
      className={`${ROW} ${canOpen ? "cursor-pointer" : "cursor-default"}`}
      disabled={!canOpen}
      onClick={() =>
        navigate(
          `/kcc20/${token.covenantId}${
            token.extensionCommitment ? `?ext=${token.extensionCommitment}` : ""
          }`,
        )
      }
    >
      {row}
    </button>
  );
}
