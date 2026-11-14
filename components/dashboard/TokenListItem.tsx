import {
  formatUsdAmount,
  formatTokenAmount,
  formatTokenPrice,
  symbolForCurrencyCode,
  textEllipsis,
} from "@/lib/utils.ts";
import { useNavigate } from "react-router-dom";
import { applyDecimal } from "@/lib/krc20.ts";
import { TokenItem } from "@/hooks/kasplex/useTokenListByAddress";
import useCurrencyValue from "@/hooks/useCurrencyValue.ts";
import { useTokenInfo } from "@/hooks/kasplex/useTokenInfo";
import { useKrc20Prices } from "@/hooks/kasplex/useKrc20Prices";
import useKrc20Logo from "@/hooks/kasplex/useKrc20Logo";
import { formatUnits } from "viem";
import { Kcc20Token } from "@/lib/kcc20";
import { useFeatureFlags } from "@/hooks/useFeatureFlags.ts";
import useWalletManager from "@/hooks/wallet/useWalletManager";
import {
  formatKcc20Amount,
  formatKcc20Balance,
  KCC20_LABELS,
} from "@/ui/popup/kcc20/labels";
import { useKcc20Price, useKrc20FilledToken } from "@/lib/kcc20/useKcc20Price";
import TokenRow from "@/ui/popup/dashboard/TokenRow";

/** Dashboard search: an empty query matches; otherwise any label contains it, case-insensitively. */
export const matchesQuery = (
  query: string,
  ...labels: (string | undefined)[]
) => {
  const q = query.trim().toLowerCase();
  return !q || labels.some((l) => l?.toLowerCase().includes(q));
};

export const ROW =
  "flex w-full items-center gap-3 rounded-xl border border-daintree-700 bg-daintree-800 p-3 text-left hover:border-white";

type TokenListItemProps = {
  token: TokenItem;
  query?: string;
};

export default function TokenListItem({
  token,
  query = "",
}: TokenListItemProps) {
  const navigate = useNavigate();
  const [settings] = useSettings();
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

  const tokenInfo = tokenInfoResponse?.result?.[0];
  const tokenName =
    tokenInfo?.mod === "mint" ? tokenInfo?.tick : tokenInfo?.name;

  // The displayed name only resolves here, so the row filters itself.
  if (!matchesQuery(query, tokenName, token.id)) return null;

  const body = (
    <TokenRow
      logo={logo}
      ticker={tokenName}
      price={formatTokenPrice(tokenPriceCurrency, tokenPriceCurrencyCode)}
      balance={showBalance ? formatTokenAmount(balanceNumber) : "*****"}
      fiat={`≈ ${
        showBalance
          ? formatUsdAmount(totalBalanceCurrency, currencyCode)
          : `${symbolForCurrencyCode(currencyCode)}*****`
      }`}
    />
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

export function Kcc20TokenListItem({ token: scanned }: { token: Kcc20Token }) {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const { isKcc20Enabled } = useFeatureFlags();
  // Display only: empty fields filled from the KRC-20 namesake.
  const token = useKrc20FilledToken(scanned);
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
  const balance = showBalance ? formatKcc20Balance(token) : "*****";
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
            ? formatUsdAmount(fiatValue, currencyCode)
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
