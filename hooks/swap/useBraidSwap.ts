import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { formatUnits } from "viem";
import { BraidError, BraidRefusal } from "@braid_swap/sdk";
import type { BraidL1, L1Quote, PreparedDeposit } from "@braid_swap/sdk";
import toast from "@/components/Toast";
import { braidErrorCopy, makeBraid } from "@/lib/braid/client";
import {
  BRAID_DEPOSIT_FEE_MAX,
  BRAID_KASTLE_FEE_BPS,
} from "@/lib/braid/constants";
import {
  type BraidSettle,
  claimBraidPair,
  getPendingBraidSwaps,
  isBraidPending,
  registerBraidSwap,
  releaseBraidPair,
  subscribeBraidSwaps,
} from "@/lib/braid/pending";
import { BraidSignRefusal, type BraidDeposit } from "@/lib/braid/signer";
import { KCC20_LEDGER_UNSUPPORTED_MESSAGE } from "@/lib/wallet/sign-script";
import { LINEAGE_FAMILY, useBraidTokens } from "./braidListing";

const KAS_DECIMALS = 8;

const toKas = (sompi: bigint) => Number(formatUnits(sompi, KAS_DECIMALS));

export const BRAID_PENDING_COPY =
  "A Braid swap for this pair is still settling.";
export const PRICE_MOVED_COPY =
  "Price moved. Review the new quote and confirm again.";
export const BRAID_UNKNOWN_COPY = "Swap may be settling. Check Activity.";
export const BRAID_UNSETTLED_COPY = "Still settling. Check Activity.";
export const BRAID_SUBMITTED_COPY =
  "Swap submitted. It is settling and takes a few minutes.";
export const NOT_ENOUGH_FUNDS_COPY = "Oh, you don't have enough funds";
const PREPARE_FAILED_COPY = "Unable to prepare the swap. Please try again.";
const SWAP_FAILED_COPY = "Swap failed. Please try again.";
const AMOUNT_CHANGED_COPY =
  "The amount changed. Review the new quote and confirm again.";

// The account key is 33-byte compressed; Braid wants its x coordinate.
export const xOnly = (pk: string) => {
  const hex = pk.toLowerCase().replace(/^0x/, "");
  return hex.length === 66 ? hex.slice(2) : hex;
};

// KAS out: a token-in deposit sends out only what is paid back inside the
// output (router coin funding, note carrier): Braid's `kasBack`, already part
// of the quote's amountOut and minOut. Missing or malformed counts as none.
const kasBackOf = (q: L1Quote): bigint => {
  try {
    const v = BigInt(q.raw?.kasBack ?? 0);
    return v > 0n ? v : 0n;
  } catch {
    return 0n;
  }
};

// KAS in: Braid pays the network fee out of the trade, so the reply's
// `amountIn` (what the wallet sends) less `legIn` (what reaches the pool) is
// the fee. Missing, malformed or negative is unknown, never 0.
const inTradeFeeOf = (q: L1Quote): bigint | null => {
  const amountIn = q.raw?.amountIn;
  const legIn = q.raw?.legIn;
  if (amountIn == null || legIn == null) return null;
  try {
    const v = BigInt(amountIn) - BigInt(legIn);
    return v >= 0n ? v : null;
  } catch {
    return null;
  }
};

/**
 * True when the deposit Braid built is worse than the quote the user saw:
 * a lower signed minimum, a higher fee, a network fee above the cap on
 * screen, or a KAS debit beyond what the screen shows. KAS in, the debit is
 * exactly payTotal; token in, at most the KAS paid back inside Min Received
 * plus the Braid fee cap, the Kastle fee and the network fee.
 */
export function braidPriceMoved(q: L1Quote, p: PreparedDeposit): boolean {
  if (p.minOut < q.minOut) return true;
  if (p.braidFeeCap > q.braidFee) return true;
  if (p.walletFee > q.walletFee.amount) return true;
  if (q.payTotal !== undefined) return p.debit !== BigInt(q.payTotal);
  if (p.depositFee > BRAID_DEPOSIT_FEE_MAX) return true;
  return p.debit > kasBackOf(q) + p.braidFeeCap + p.walletFee + p.depositFee;
}

// The one Braid warning the user must confirm before signing: the route pays
// less than trading on the venues' own apps. The SDK's warnings are plain
// strings (src/l1/client.js, from the reply's `worseThanAlone`).
const WORSE_THAN_ALONE = /less than swapping on the venues' own apps/;
export const isBlockingBraidWarning = (w: string) => WORSE_THAN_ALONE.test(w);

/** Why `units` cannot be spent, or undefined. A KAS-in payTotal includes every fee. */
export function braidAmountError(
  units: bigint,
  balance: bigint | undefined,
): string | undefined {
  if (units <= 0n) return undefined;
  if (balance !== undefined && units > balance) return NOT_ENOUGH_FUNDS_COPY;
  return undefined;
}

/** A quote with the inputs it was asked for, so a stale one is never signed. */
export type KeyedQuote = { key: string; quote: L1Quote };

export type BraidNotify = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

export type BraidConfirmOutcome =
  | "refused"
  | "pending"
  | "aborted"
  | "failed"
  | "submitted"
  | "unknown";

export type BraidConfirmInput = {
  braid: BraidL1;
  quote: KeyedQuote | undefined;
  /** The quote key for the inputs on screen now. */
  liveKey: () => string | undefined;
  /** The pair on screen now: the account key and the token. */
  livePair: () => string | undefined;
  pairKey: string | undefined;
  userPublicKey: string | undefined;
  isLedger: boolean;
  sign:
    | ((deposit: BraidDeposit) => Promise<Record<number, string>>)
    | undefined;
  onSettle: BraidSettle;
  notify: BraidNotify;
  /** A refusal of the quote it was raised on. */
  onRefusal: (quote: L1Quote, message: string) => void;
  onPriceMoved: () => void;
  onRegistered?: (ref: string) => void;
  onSubmitted?: () => void;
};

/**
 * One confirm of a Braid swap. The pair is claimed before the pre-flight and
 * released in `finally` unless a deposit took its place. Once signatures are
 * sent, the pair stays blocked until the deposit settles, even on an unknown
 * error: only a refusal, which signed or sent nothing, releases it. After
 * every await the attempt is checked against the pair on screen, so a late
 * answer never writes to another account's screen state.
 */
export async function confirmBraidSwap(
  i: BraidConfirmInput,
): Promise<BraidConfirmOutcome> {
  // A Ledger account never reaches a deposit: it cannot sign one.
  if (i.isLedger) {
    i.notify.error(KCC20_LEDGER_UNSUPPORTED_MESSAGE);
    return "refused";
  }
  const claim = i.pairKey;
  const userPublicKey = i.userPublicKey;
  const sign = i.sign;
  if (!claim || !userPublicKey || !sign) {
    i.notify.error(PREPARE_FAILED_COPY);
    return "failed";
  }
  if (!(await claimBraidPair(claim))) {
    i.notify.error(BRAID_PENDING_COPY);
    return "pending";
  }
  const live = () => i.livePair() === claim;
  // The trade on screen at the confirm; a refresh after this is ignored.
  const snapshot = i.quote;
  let committed = false;
  let sent = false;
  let prepared: PreparedDeposit | undefined;
  const register = (deposit: PreparedDeposit) => {
    // The deposit holds the pair from here, in place of the claim.
    committed = true;
    i.onRegistered?.(deposit.ref);
    return registerBraidSwap({
      ref: deposit.ref,
      prepared: deposit,
      pairKey: claim,
      onSettle: i.onSettle,
      braid: i.braid,
    });
  };
  try {
    if (!live()) return "aborted";
    if (!snapshot) {
      i.notify.error(PREPARE_FAILED_COPY);
      return "failed";
    }
    if (snapshot.key !== i.liveKey()) {
      i.notify.error(AMOUNT_CHANGED_COPY);
      return "aborted";
    }

    // A fresh nonce, deposit and deadline every call.
    prepared = await i.braid.prepare(snapshot.quote, { userPublicKey });
    if (!live()) return "aborted";
    if (braidPriceMoved(snapshot.quote, prepared)) {
      i.onRefusal(snapshot.quote, PRICE_MOVED_COPY);
      i.notify.error(PRICE_MOVED_COPY);
      i.onPriceMoved();
      return "refused";
    }

    const signatures = await sign(prepared);
    // Signed but not sent: Braid broadcasts only what is submitted.
    if (!live()) return "aborted";

    sent = true;
    // Braid broadcasts; Kastle only posts the signatures.
    await i.braid.submit(prepared, signatures);
    await register(prepared);
    i.notify.info(BRAID_SUBMITTED_COPY);
    if (live()) i.onSubmitted?.();
    return "submitted";
  } catch (e) {
    // Never the deposit or its signatures: the error and the ref only.
    console.error(
      "Braid swap failed",
      prepared?.ref,
      e instanceof Error ? e.message : e,
    );
    const refused =
      e instanceof BraidRefusal ||
      e instanceof BraidSignRefusal ||
      (e instanceof BraidError && e.code === "BAD_SIGNATURE");
    if (sent && !refused && prepared) {
      // Braid may hold the deposit: block the pair until the poll knows,
      // and never retry it from here.
      await register(prepared);
      i.notify.error(BRAID_UNKNOWN_COPY);
      return "unknown";
    }
    if (refused) {
      const message = braidErrorCopy(e, SWAP_FAILED_COPY);
      if (snapshot && live()) i.onRefusal(snapshot.quote, message);
      i.notify.error(message);
      return "refused";
    }
    i.notify.error(
      braidErrorCopy(e, prepared ? SWAP_FAILED_COPY : PREPARE_FAILED_COPY),
    );
    return "failed";
  } finally {
    if (!committed) await releaseBraidPair(claim);
  }
}

/** The settle toast for a deposit; `outDecimals` unknown leaves the amount out. */
export function braidSettleToast(
  notify: BraidNotify,
  outSymbol: string,
  outDecimals: number | undefined,
): BraidSettle {
  return (state, { chain }) => {
    if (state === "done") {
      // Chain-verified either way; the amount only shown when known.
      notify.success(
        chain?.amount !== undefined && outDecimals !== undefined
          ? `Swapped successfully! Received ${formatUnits(chain.amount, outDecimals)} ${outSymbol}`
          : "Swapped successfully!",
      );
    } else if (state === "refunded") {
      notify.info(
        "The route could not meet your minimum. Your funds were refunded.",
      );
    } else if (state === "unconfirmed") {
      notify.info(BRAID_UNSETTLED_COPY);
    } else {
      notify.error("The swap did not complete. Check Activity.");
    }
  };
}

// Refs this context already follows, so a remounted screen adds no second
// settle toast to one deposit.
const followed = new Set<string>();

export type FeeLine = {
  name: "Network" | "Kastle" | "Braid";
  symbol: "KAS";
  /** Unknown is absent, never 0. */
  amount?: number;
  /** What the Est. Fee row shows. */
  display: string;
  hint: string;
};

/** A Kaspa L1 leg as the swap screen holds it. */
export type BraidSwapToken = {
  symbol: string;
  /** The covenant id; absent on KAS. */
  address?: string;
  decimals: number;
};

export type BraidSwapInput = {
  /** The screen routes this pair through Braid. */
  enabled: boolean;
  isMainnet: boolean;
  tokenIn?: BraidSwapToken;
  tokenOut?: BraidSwapToken;
  /** The amount in, in the input token's base units. */
  rawIn: bigint;
  /** The spendable balance of the input, in its base units. */
  balanceIn?: bigint;
  /** Percent, as the screen's slippage sheet sets it. */
  slippage: number;
  /** The account's Kaspa public key, as the wallet stores it. */
  publicKey?: string;
  isLedger: boolean;
  sign?: (deposit: BraidDeposit) => Promise<Record<number, string>>;
  onSubmitted?: () => void;
};

/**
 * The Braid leg of the swap screen: KAS ⇄ one KCC-20 token on mainnet. The
 * confirm prepares, signs (in the background, with the account key) and
 * posts the deposit; the SDK broadcasts it and lib/braid/pending follows it
 * to settlement.
 */
export function useBraidSwap({
  enabled,
  isMainnet,
  tokenIn,
  tokenOut,
  rawIn,
  balanceIn,
  slippage,
  publicKey,
  isLedger,
  sign,
  onSubmitted,
}: BraidSwapInput) {
  const [braid] = useState(makeBraid);
  const slippageBps = Math.round(slippage * 100);
  const [isSigning, setIsSigning] = useState(false);
  // A refusal of the quote it was raised on; a fresh quote clears it.
  const [refusal, setRefusal] = useState<{ quote: L1Quote; message: string }>();
  const signingRef = useRef(false);

  const {
    data: listed,
    error: listedError,
    isLoading: listedLoading,
  } = useBraidTokens(braid, enabled && isMainnet);

  const side = tokenIn && !tokenIn.address ? "buy" : "sell";
  const kcc20 = side === "buy" ? tokenOut : tokenIn;
  const covenantId = kcc20?.address;
  const listing = listed?.find((t) => t.id === covenantId);
  const lineage = listing?.lineage ?? undefined;
  const family = lineage ? LINEAGE_FAMILY[lineage] : undefined;
  const inDecimals = tokenIn?.decimals ?? KAS_DECIMALS;
  const outDecimals = tokenOut?.decimals;
  const outSymbol = tokenOut?.symbol ?? "";

  const userPublicKey = publicKey ? xOnly(publicKey) : undefined;
  // One deposit in flight per account and token, whichever the side.
  const pairKey =
    enabled && covenantId && userPublicKey
      ? `${userPublicKey}:${covenantId}`
      : undefined;
  const pairRef = useRef(pairKey);
  pairRef.current = pairKey;

  const quoteKey =
    enabled && isMainnet && covenantId && family && userPublicKey && rawIn > 0n
      ? `${covenantId}:${lineage}:${side}:${rawIn}:${slippageBps}:${userPublicKey}`
      : undefined;
  const liveKeyRef = useRef(quoteKey);
  liveKeyRef.current = quoteKey;

  const {
    data: keyed,
    error: quoteError,
    isLoading: quoteLoading,
    mutate: refreshQuote,
  } = useSWR<KeyedQuote>(
    quoteKey ? ["braidQuote", quoteKey] : null,
    async () => {
      const token = { id: covenantId!, lineage: lineage as "kron" | "ref" };
      const quote = await braid.quote(
        side === "buy"
          ? {
              from: "KAS",
              to: token,
              payTotal: rawIn,
              slippageBps,
              userPublicKey,
            }
          : {
              from: token,
              to: "KAS",
              amountIn: rawIn,
              slippageBps,
              userPublicKey,
            },
      );
      return { key: quoteKey!, quote };
    },
    // Paused while signing so a refresh can't swap the quote mid-confirm.
    { refreshInterval: 15_000, isPaused: () => signingRef.current },
  );
  // A quote for other inputs is never shown or signed.
  const quote = keyed?.key === quoteKey ? keyed?.quote : undefined;

  // The pending value lives in storage; this is its copy for the screen.
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!pairKey) {
      setPending(false);
      return;
    }
    let alive = true;
    const refresh = () =>
      void isBraidPending(pairKey).then(
        (p) => alive && setPending(p),
        () => {},
      );
    refresh();
    const off = subscribeBraidSwaps(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [pairKey]);

  // A reopened popup follows the deposits a closed one left in flight, so
  // each settles, and frees its pair, here.
  useEffect(() => {
    if (!enabled) return;
    void getPendingBraidSwaps().then(
      (swaps) =>
        swaps.forEach((s) => {
          if (followed.has(s.ref)) return;
          followed.add(s.ref);
          const kasOut = s.prepared.payTotal == null;
          void registerBraidSwap({
            ...s,
            onSettle: braidSettleToast(
              toast,
              s.prepared.to.symbol,
              kasOut ? KAS_DECIMALS : undefined,
            ),
            braid,
          });
        }),
      () => {},
    );
  }, [enabled, braid]);

  // Braid asks for every warning to be shown before signing. A route worse
  // than going alone must be confirmed; the rest are advisory.
  const warnings = quote?.warnings ?? [];
  const blockingWarning = warnings.find(isBlockingBraidWarning);
  const advisory = warnings.filter((w) => !isBlockingBraidWarning(w));

  const validateAmount = (units: bigint) => braidAmountError(units, balanceIn);

  const extraErrorMessage = (() => {
    if (!enabled || !tokenIn || !tokenOut) return undefined;
    if (!isMainnet) return "Swap is only available on mainnet.";
    if (isLedger) return KCC20_LEDGER_UNSUPPORTED_MESSAGE;
    if (listedError) {
      return braidErrorCopy(
        listedError,
        "Unable to load Braid tokens. Please try again.",
      );
    }
    if (listed && !family) return "This token can't be swapped on Braid.";
    if (pending) return BRAID_PENDING_COPY;
    if (rawIn === 0n) return undefined;
    const amountError = validateAmount(rawIn);
    if (amountError) return amountError;
    if (quoteError) {
      return braidErrorCopy(
        quoteError,
        "Unable to get quote. Please try again.",
      );
    }
    if (refusal && refusal.quote === quote) return refusal.message;
    return undefined;
  })();
  // Only a swappable quote needs confirming; a blocked one shows its error.
  const routeWarning = extraErrorMessage ? undefined : blockingWarning;

  // Max: the whole spendable holding on a sell. A KAS max would need the
  // balance moves before the build held back, as on KRON: none offered.
  const findMax = () =>
    side === "sell" && balanceIn !== undefined && tokenIn
      ? formatUnits(balanceIn, tokenIn.decimals)
      : undefined;

  const onConfirm = async () => {
    if (signingRef.current) return;
    signingRef.current = true;
    setIsSigning(true);
    setRefusal(undefined);
    try {
      await confirmBraidSwap({
        braid,
        quote: quote && quoteKey ? { key: quoteKey, quote } : undefined,
        liveKey: () => liveKeyRef.current,
        livePair: () => pairRef.current,
        pairKey,
        userPublicKey,
        isLedger,
        sign,
        onSettle: braidSettleToast(toast, outSymbol, outDecimals),
        notify: toast,
        onRefusal: (q, message) => setRefusal({ quote: q, message }),
        onPriceMoved: () => void refreshQuote(),
        // This context follows it already: a remount adds no listener.
        onRegistered: (ref) => followed.add(ref),
        onSubmitted,
      });
    } finally {
      signingRef.current = false;
      setIsSigning(false);
    }
  };

  const buyFee = side === "buy" && quote ? inTradeFeeOf(quote) : null;
  const feeLines: FeeLine[] = [
    // No build yet. KAS in, payTotal already covers the network fee and
    // Braid takes it from the trade; token in, it comes on top, so the line
    // shows the most it can be. An unknown fee is never shown as 0.
    side === "sell"
      ? {
          name: "Network",
          symbol: "KAS",
          amount: toKas(BRAID_DEPOSIT_FEE_MAX),
          display: `At most ${toKas(BRAID_DEPOSIT_FEE_MAX)} KAS`,
          hint: "Set when the deposit is built",
        }
      : {
          name: "Network",
          symbol: "KAS",
          ...(buyFee !== null ? { amount: toKas(buyFee) } : {}),
          display: "Included in the rate",
          hint: "Braid pays it from the KAS you send",
        },
    ...(quote
      ? [
          {
            name: "Kastle" as const,
            symbol: "KAS" as const,
            amount: toKas(quote.walletFee.amount),
            display: `${toKas(quote.walletFee.amount)} KAS`,
            hint: `Quote includes ${BRAID_KASTLE_FEE_BPS / 100}% Kastle fee`,
          },
          {
            name: "Braid" as const,
            symbol: "KAS" as const,
            amount: toKas(quote.braidFee),
            display: `${toKas(quote.braidFee)} KAS`,
            hint: "Router fee, 0 when the route is direct",
          },
        ]
      : []),
  ];

  // Net of every fee but the network fee, like the KRON rate.
  const rate =
    quote && rawIn > 0n && outDecimals !== undefined
      ? Number(formatUnits(quote.amountOut, outDecimals)) /
        Number(formatUnits(rawIn, inDecimals))
      : undefined;

  return {
    side,
    quote,
    pending,
    isSigning,
    isLoading:
      (enabled && isMainnet && !listed && !listedError) ||
      listedLoading ||
      quoteLoading,
    validateAmount,
    findMax,
    onConfirm,
    extraErrorMessage,
    routeWarning,
    advisory,
    minOut: quote?.minOut,
    feeLines,
    kastleFeeBps: BRAID_KASTLE_FEE_BPS,
    rate,
  };
}
