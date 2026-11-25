import { useEffect, useRef, useState } from "react";
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
  kassealSlippageBps,
  type KassealPreview,
} from "@/lib/kasseal/prepared";
import { venueOf } from "@/lib/kasseal/market";
import {
  KASSEAL_PENDING_COPY,
  clearKassealAttempt,
  kassealTradeKey,
  loadKassealAttempt,
  saveKassealAttempt,
  settlePendingKasseal,
} from "@/lib/kasseal/pending";
import { kassealPopupWallet } from "@/lib/kasseal/popupWallet";
import { signKassealTx } from "@/lib/kasseal/sign";
import {
  KassealTradeError,
  newKassealAttempt,
  submitKassealTrade,
  type KassealAttempt,
  type KassealSubmissionDeps,
  type KassealTradeErrorCode,
} from "@/lib/kasseal/trade";
import {
  buildDiagnosticReport,
  type DiagnosticReport,
} from "@/lib/diagnostics";
import type { FeeLine, L1SwapHandlers } from "./l1Types";

// Mobile's hooks/swap/useKassealSwap.ts for the popup. Mobile holds the pair
// lock in memory; a popup dies on blur, so the open attempt lives in
// browser.storage.local (lib/kasseal/pending.ts) and a reopened popup only
// reconciles it against /tx, never resumes it. Nothing wires it in until S2c.

const KAS_DECIMALS = 8;
const DEBOUNCE_MS = 300;

/** Mobile's wording, kept as is. */
export const KASSEAL_CHANGED_COPY =
  "The amount changed. Review the new quote and swipe again.";
export const KASSEAL_WALLET_LOADING_COPY =
  "Your wallet is still loading. Swipe again in a moment.";

/** trade.ts's own build refusals: thrown before anything was signed or posted. */
const NOTHING_SUBMITTED = new Set<KassealTradeErrorCode>([
  "proof-not-bound",
  "wrong-token",
  "no-pool",
  "invalid-amount",
]);

/**
 * True only when the error proves no tx can be live, mobile's rule on the
 * extension's errors. Anything else (a signer throw, "outcome-unknown",
 * PinnedFundingGone, unknown text) keeps the stored attempt for /tx to settle.
 */
export const kassealRefusalClearsLock = (e: unknown): boolean =>
  e instanceof KassealTradeError && NOTHING_SUBMITTED.has(e.code);

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
  /** Builds, posts and reads one trade (the SDK builder and /tx); S2c wires it. */
  trade: Omit<KassealSubmissionDeps, "sign" | "persist">;
  /** The popup's hot signer (useKaspaHotWalletSigner); absent while loading. */
  signer?: Parameters<typeof kassealPopupWallet>[0];
};

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
  trade,
  signer,
}: KassealSwapInput): L1SwapHandlers {
  const settled = useDebounced(amountUnits);
  const net = kassealNetworkOf(network);
  const rawBps = Math.round(slippage * 100);
  const slippageBps = kassealSlippageBps(slippage);
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

  const pairKey =
    address && covenantId
      ? kassealTradeKey(network, address, covenantId)
      : undefined;
  const [pending, setPending] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>();
  // Shown while the amount it was refused for is still the one typed, as mobile's.
  const [refusal, setRefusal] = useState<{ units: bigint; message: string }>();
  const entered = useRef(false);
  const status = useRef(trade.status);
  status.current = trade.status;

  // On mount (and per pair): reconcile a stored attempt against /tx only. It
  // exists to stop a second buy, so nothing here builds, signs or posts.
  useEffect(() => {
    setPending(false);
    if (!pairKey) return;
    let live = true;
    settlePendingKasseal(pairKey, (txid) => status.current(txid)).then(
      (outcome) => live && setPending(outcome === "open"),
      // An unreadable store may hold an open attempt: stay locked.
      () => live && setPending(true),
    );
    return () => {
      live = false;
    };
  }, [pairKey]);

  const onConfirm = async () => {
    // 1. Guard, synchronously first so a double press cannot enter twice.
    if (entered.current) return;
    const refuse = (message: string) =>
      setRefusal({ units: amountUnits, message });
    if (pending || !pairKey) return refuse(KASSEAL_PENDING_COPY);
    if (
      !preview ||
      !token ||
      inDecimals === undefined ||
      settled !== amountUnits
    )
      return refuse(KASSEAL_CHANGED_COPY);
    if (!signer) return refuse(KASSEAL_WALLET_LOADING_COPY);
    entered.current = true;
    setIsSigning(true);
    setRefusal(undefined);
    setReport(undefined);
    // 2. The attempt trade.ts submits; its build pins the funding coins on it.
    const attempt: KassealAttempt = {
      ...newKassealAttempt(),
      intent: {
        side,
        venue: venueOf(token),
        amount: amountUnits,
        input: formatUnits(amountUnits, inDecimals),
      },
    };
    try {
      // The store, not `pending`: a mount reconcile may still be in flight.
      if (await loadKassealAttempt(pairKey)) {
        setPending(true);
        return refuse(KASSEAL_PENDING_COPY);
      }
      // 3. Persist before anything is signed or posted.
      await saveKassealAttempt(pairKey, attempt);
      setPending(true);
      const wallet = kassealPopupWallet(signer);
      // 4–5. Build → sign → persist again with the txid and pinned coins → POST.
      await submitKassealTrade(
        {
          ...trade,
          sign: async (built) => ({
            ...built,
            txJson: await signKassealTx(wallet, built),
          }),
          persist: (a) => saveKassealAttempt(pairKey, a),
        },
        attempt,
      );
      // 6. Landed: the lock goes.
      await clearKassealAttempt(pairKey);
      setPending(false);
    } catch (e) {
      // 6. Only a refusal proving nothing is live clears; unknown keeps it.
      const clears = kassealRefusalClearsLock(e);
      if (clears) {
        await clearKassealAttempt(pairKey).catch(() => undefined);
        setPending(false);
      }
      refuse(clears ? kassealRefusalCopy(e) : KASSEAL_PENDING_COPY);
      // 7. The Copy logs report. Fields go in as a function: a getter that
      // throws yields a null report inside buildDiagnosticReport, never a throw here.
      setReport(
        buildDiagnosticReport("kasseal-swap", e, () => ({
          side,
          network,
          covenantId,
          amount: amountUnits.toString(),
          posted: attempt.posted.join(","),
          cleared: clears,
        })),
      );
    } finally {
      entered.current = false;
      setIsSigning(false);
    }
  };

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
    pending,
    pendingCopy: pending ? KASSEAL_PENDING_COPY : undefined,
    isSigning,
    onConfirm,
    report,
    extraErrorMessage:
      refusal?.units === amountUnits
        ? refusal.message
        : key && error
          ? kassealRefusalCopy(error)
          : undefined,
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
