import { useEffect, useState } from "react";
import useSWR from "swr";
import { formatUnits } from "viem";
import type { KassealNetwork } from "@kassealhq/sdk";
import {
  kassealBaseUrl,
  kassealNetworkOf,
  type KassealToken,
} from "@/lib/kasseal/api";
import {
  KASSEAL_SLIPPAGE_COPY,
  kassealErrorCopy,
} from "@/lib/kasseal/errorCopy";
import {
  KASSEAL_ERRORS,
  KASSEAL_MAX_SLIPPAGE_BPS,
  kassealCodeOf,
  type KassealPreview,
} from "@/lib/kasseal/prepared";
import type { FeeLine, L1SwapHandlers } from "./l1Types";

// The read half of mobile's hooks/swap/useKassealSwap.ts. Signing, the pair
// lock, submit and settlement are S2b-2; nothing wires this hook in until then.

const KAS_DECIMALS = 8;
const DEBOUNCE_MS = 300;

export const KASSEAL_CONFIRM_TODO = "kasseal: confirm is S2b-2";

export const KASSEAL_ENTER_VALID_COPY = "Please enter a valid amount";
/** Mobile's kcc20Holding wording; useBraidSwap's copy drops the "have". */
export const NOT_ENOUGH_FUNDS_COPY = "Oh, you don't have enough funds";
export const KASSEAL_NO_POOL_COPY =
  "This token can't be swapped on Kasseal yet.";
export const KASSEAL_SOLD_OUT_COPY = "This token's curve is sold out.";
export const KASSEAL_CURVE_UNUSABLE_COPY =
  "This token's curve can't be traded right now.";
export const KASSEAL_UNRECONCILED_COPY =
  "This transaction didn't match what was quoted, so nothing was sent. Trying again won't fix it.";
export const KASSEAL_BELOW_ONE_LOT_COPY =
  "Amount is below one lot of this token.";
export const KASSEAL_TRANSPORT_COPY =
  "Couldn't reach Kasseal. Check your connection and try again.";
export const KASSEAL_TERMINAL_COPY = "Kasseal can't build this swap right now.";

/**
 * KAS a buy's Max leaves unspent: the debit is quote + the new token cell +
 * network fee, so the whole balance never builds. Fixed 1 KAS, not read off
 * the SDK; an INSUFFICIENT_FUNDS build still says not-enough-funds if a real
 * cell + fee ever exceed it.
 */
export const KASSEAL_BUY_RESERVE_SOMPI = 100_000_000n;

/** SWR retries of one failing quote key, never more: each retry is a full build. */
export const KASSEAL_BUILD_RETRY_COUNT = 3;

const toKas = (sompi: bigint) => Number(formatUnits(sompi, KAS_DECIMALS));
const kas = (amount: number) => `${amount} KAS`;

const BUILD_FAILED_ = `${KASSEAL_ERRORS.BUILD_FAILED}:`;
/**
 * A build failure the network may clear: NET (transport, timeout, the build
 * deadline), a 429 or 5xx, an unfetched curve head.
 */
export function kassealBuildIsTransport(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  if (!msg.startsWith(BUILD_FAILED_)) return false;
  const why = msg.slice(BUILD_FAILED_.length);
  return (
    /^NET:[A-Z_]+$/.test(why) ||
    /^HTTP_(?:429|5[0-9]{2}):[A-Z_]+$/.test(why) ||
    why === "HEAD_FETCH"
  );
}

/**
 * SWR retries only what may clear on its own: no SDK yet, a transport
 * failure, a moved quote, or an error not worded as a Kasseal code. Every
 * other code is terminal.
 */
export function kassealBuildRetries(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return (
    msg === KASSEAL_ERRORS.UNAVAILABLE ||
    kassealBuildIsTransport(e) ||
    msg === `${BUILD_FAILED_}QUOTE_MOVED` ||
    !msg.startsWith("KASSEAL_")
  );
}

/**
 * What a refused quote tells the user, most specific first (ZERO_LOTS may
 * ride under any code). An error with no Kasseal code is the extension's
 * own SDK/trade error: its copy is lib/kasseal/errorCopy's.
 */
export function kassealRefusalCopy(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (!msg.startsWith("KASSEAL_")) return kassealErrorCopy(e);
  const code = kassealCodeOf(e);
  if (code === KASSEAL_ERRORS.NO_POOL) return KASSEAL_NO_POOL_COPY;
  if (msg.endsWith(":SOLD_OUT")) return KASSEAL_SOLD_OUT_COPY;
  if (msg.endsWith(":ZERO_LOTS")) return KASSEAL_BELOW_ONE_LOT_COPY;
  if (msg.endsWith(":INSUFFICIENT_FUNDS")) return NOT_ENOUGH_FUNDS_COPY;
  if (code === KASSEAL_ERRORS.CURVE_UNUSABLE)
    return KASSEAL_CURVE_UNUSABLE_COPY;
  if (code === KASSEAL_ERRORS.PREVIEW_UNRECONCILED)
    return KASSEAL_UNRECONCILED_COPY;
  return kassealBuildIsTransport(e)
    ? KASSEAL_TRANSPORT_COPY
    : KASSEAL_TERMINAL_COPY;
}

/**
 * What the quoted tx takes: the pay amount (on a buy the quoted price, on a
 * sell the whole lots sold) and, where the preview read it off the tx,
 * everything that leaves the wallet. No figure it lacks is shown.
 */
export function kassealPayHint(
  preview: KassealPreview | undefined,
  inDecimals: number,
  inSymbol: string,
): string | undefined {
  if (!preview) return undefined;
  // On a buy the pay side is KAS whatever symbol the caller passed.
  const pay = `You pay ${formatUnits(BigInt(preview.amountIn), inDecimals)} ${preview.side === "buy" ? "KAS" : inSymbol}.`;
  return preview.walletDebitSompi === undefined
    ? pay
    : `${pay} ${toKas(BigInt(preview.walletDebitSompi))} KAS leaves your wallet in total (price, token cell and network fee).`;
}

/** The network fee, then Kasseal's trading fee. Kasseal takes no Kastle fee. */
export function kassealFeeLines(
  preview: KassealPreview | undefined,
): FeeLine[] {
  if (!preview) return [];
  const network: FeeLine =
    preview.feeSompi === undefined
      ? {
          name: "Network",
          symbol: "KAS",
          display: "Set when the swap is built",
          hint: "Paid by the built transaction",
        }
      : {
          name: "Network",
          symbol: "KAS",
          amount: toKas(BigInt(preview.feeSompi)),
          display: kas(toKas(BigInt(preview.feeSompi))),
          hint: "Paid by the built transaction",
        };
  const trading: FeeLine[] =
    preview.tradingFeeSompi === null
      ? []
      : [
          {
            name: "Kasseal",
            symbol: "KAS",
            amount: toKas(BigInt(preview.tradingFeeSompi)),
            display: kas(toKas(BigInt(preview.tradingFeeSompi))),
            hint: "Curve trading fee",
          },
        ];
  return [network, ...trading];
}

/**
 * What a sell credits the wallet, read off the tx. A credit is never a fee, so
 * these lines render signed and outside the fee sum. The token-cell line is +
 * when a spent cell's KAS comes back, − when the rest cell keeps some payout.
 */
export function kassealCreditLines(
  preview: KassealPreview | undefined,
): FeeLine[] {
  if (preview?.walletCreditSompi === undefined) return [];
  const credit = toKas(BigInt(preview.walletCreditSompi));
  const cell = BigInt(preview.tokenCellSompi ?? "0");
  const signed = (n: number) => (n > 0 ? `+${kas(n)}` : kas(n));
  return [
    {
      name: "You receive",
      symbol: "KAS",
      amount: credit,
      display: signed(credit),
      hint: "KAS this transaction adds to your wallet",
    },
    ...(cell !== 0n
      ? [
          {
            name: "Token cell",
            symbol: "KAS" as const,
            amount: toKas(cell),
            display: signed(toKas(cell)),
            hint:
              cell > 0n
                ? "KAS your spent token cell returns to you"
                : "KAS kept in your remaining token cell",
          },
        ]
      : []),
  ];
}

/** What Max may spend: a buy keeps KASSEAL_BUY_RESERVE_SOMPI back, never below 0. */
export function kassealMaxIn(have: bigint, side: "buy" | "sell"): bigint {
  const spendable = side === "buy" ? have - KASSEAL_BUY_RESERVE_SOMPI : have;
  return spendable > 0n ? spendable : 0n;
}

export type KassealQuoteRequest = {
  /** KASSEAL_API_URLS for `network`, from settings. */
  apiUrl: string;
  network: KassealNetwork;
  covenantId: string;
  side: "buy" | "sell";
  /** Sompi on a buy, token base units on a sell. */
  amountIn: bigint;
  slippageBps: number;
  trader: string;
};

/** Prices one trade; throws `KASSEAL_<CODE>[:DETAIL]` or an SDK/trade error on refusal. */
export type KassealQuoteClient = (
  req: KassealQuoteRequest,
) => Promise<KassealPreview>;

export type KassealSwapInput = {
  side: "buy" | "sell";
  /** The KCC-20 leg, as the Kasseal listing returns it. */
  token?: KassealToken;
  /** The amount in, in the input token's base units. */
  amountUnits: bigint;
  address?: string;
  /** The settings network id: mainnet and testnet-10 both route. */
  network: string;
  /** Spendable balances in base units; absent: unknown. */
  wallet: { kasSompi?: bigint; tokenUnits?: bigint };
  /** Percent, as the screen's slippage sheet sets it. */
  slippage: number;
  quoteClient: KassealQuoteClient;
};

export type KassealReadHandlers = Omit<
  L1SwapHandlers,
  "onConfirm" | "report" | "isSigning" | "pending"
> & { onConfirm: () => Promise<never> };

function useDebounced<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);
  return settled;
}

/** The Kasseal leg of the swap screen, read half: KAS ⇄ one curve token. */
export function useKassealSwap({
  side,
  token,
  amountUnits,
  address,
  network,
  wallet,
  slippage,
  quoteClient,
}: KassealSwapInput): KassealReadHandlers {
  const settled = useDebounced(amountUnits);
  const net = kassealNetworkOf(network);
  const rawBps = Math.round(slippage * 100);
  const slippageBps = Math.min(KASSEAL_MAX_SLIPPAGE_BPS, Math.max(0, rawBps));
  const inDecimals = side === "buy" ? KAS_DECIMALS : token?.decimals;
  const outDecimals = side === "buy" ? token?.decimals : KAS_DECIMALS;
  const have = side === "buy" ? wallet.kasSompi : wallet.tokenUnits;
  const covenantId = token?.covenantId;

  const key =
    net && covenantId && address && settled > 0n
      ? ([
          "kassealQuote",
          net,
          covenantId,
          side,
          settled.toString(),
          slippageBps,
          address,
        ] as const)
      : null;
  const { data, error, isLoading } = useSWR<KassealPreview>(
    key,
    () =>
      quoteClient({
        apiUrl: kassealBaseUrl(net!),
        network: net!,
        covenantId: covenantId!,
        side,
        amountIn: settled,
        slippageBps,
        trader: address!,
      }),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: kassealBuildRetries,
      errorRetryCount: KASSEAL_BUILD_RETRY_COUNT,
    },
  );
  // A refused quote shows no numbers, even one SWR kept from before.
  const preview = key && !error ? data : undefined;

  const validateAmount = (units: bigint) => {
    if (units <= 0n) return KASSEAL_ENTER_VALID_COPY;
    // Below one lot buys or sells nothing; a buy's lot costs at least nextLotPrice.
    const lot =
      side === "buy" ? token?.curve?.nextLotPrice : token?.curve?.lotSize;
    if (lot !== undefined && units < lot) return KASSEAL_BELOW_ONE_LOT_COPY;
    if (have !== undefined && units > have) return NOT_ENOUGH_FUNDS_COPY;
    if (rawBps > KASSEAL_MAX_SLIPPAGE_BPS) return KASSEAL_SLIPPAGE_COPY;
    return undefined;
  };

  const findMax = () =>
    have === undefined || inDecimals === undefined
      ? undefined
      : formatUnits(kassealMaxIn(have, side), inDecimals);

  // The preview's figure (expectedOut over what it trades), never the
  // listing's nextLotPrice: a curve buy spans many lots at rising prices.
  const rate =
    preview &&
    inDecimals !== undefined &&
    outDecimals !== undefined &&
    BigInt(preview.amountIn) > 0n
      ? Number(formatUnits(BigInt(preview.expectedOut), outDecimals)) /
        Number(formatUnits(BigInt(preview.amountIn), inDecimals))
      : undefined;

  const payHint =
    inDecimals === undefined
      ? undefined
      : kassealPayHint(preview, inDecimals, token?.ticker ?? "");

  return {
    side,
    quote: preview ? { amountOut: BigInt(preview.minOut) } : undefined,
    isLoading: isLoading || settled !== amountUnits,
    validateAmount,
    findMax,
    onConfirm: async () => {
      throw new Error(KASSEAL_CONFIRM_TODO);
    },
    extraErrorMessage: key && error ? kassealRefusalCopy(error) : undefined,
    advisory: payHint ? [payHint] : [],
    minOut: preview ? BigInt(preview.minOut) : undefined,
    feeLines: kassealFeeLines(preview),
    kastleFeeBps: 0,
    rate,
    totalDebit:
      preview?.walletDebitSompi !== undefined
        ? { amount: toKas(BigInt(preview.walletDebitSompi)), symbol: "KAS" }
        : undefined,
    creditLines: kassealCreditLines(preview),
  };
}
