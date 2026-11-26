import { useEffect, useReducer, useRef, useState } from "react";
import useSWR from "swr";
import { formatUnits } from "viem";
import type { Quote } from "@kasparocket/sdk";
import {
  buildDiagnosticReport,
  type DiagnosticReport,
} from "@/lib/diagnostics";
import type { IWallet } from "@/lib/wallet/wallet-interface";
import {
  kaspaRocketErrorCopy,
  makeKaspaRocket,
} from "@/lib/kasparocket/client";
import {
  kaspaRocketMinOrderError,
  useKaspaRocketProtocol,
} from "@/lib/kasparocket/fees";
import {
  kaspaRocketPendingKey,
  settlePendingKaspaRocket,
} from "@/lib/kasparocket/pending";
import {
  KASPAROCKET_NETWORK_FEE_CEILING_SOMPI,
  kaspaRocketMinOut,
  kaspaRocketPlanPayout,
  kaspaRocketWalletDigest,
} from "@/lib/kasparocket/signer";
import {
  KASPAROCKET_NO_POOL_COPY,
  KASPAROCKET_OFF_COPY,
  KASPAROCKET_PENDING_COPY,
  KASPAROCKET_SETTLE_POLL_MS,
  KASPAROCKET_UNECONOMIC_COPY,
  PREPARE_COPY,
  confirmKaspaRocketSwap,
  kaspaRocketChainCheck,
  kaspaRocketFeeLines,
  kaspaRocketValidate,
  type KaspaRocketConfirmResult,
  type KaspaRocketPrepared,
} from "@/lib/kasparocket/confirm";
import { useKaspaRocketPool } from "./kasparocketListing";
import type { L1SwapHandlers } from "./l1Types";

// Mobile's hooks/swap/useKaspaRocketSwap.ts, for the popup. Two changes: no
// biometric (the unlocked keyring and the confirm are the consent), and the
// pending record lives in browser.storage.local, written before submit, so a
// popup closed on blur still holds the pair (lib/kasparocket/pending.ts).
// The confirm itself is lib/kasparocket/confirm.ts.

const KAS_DECIMALS = 8;
const DEBOUNCE_MS = 300;

export type KaspaRocketSwapInput = {
  /** isKaspaRocketEnabled: flag on and a proxy token in the build. */
  on: boolean;
  /** KaspaRocket is the chosen provider for this pair. */
  active: boolean;
  side: "buy" | "sell";
  /** The KCC-20 leg's covenant id. */
  tokenId?: string;
  tokenDecimals?: number;
  /** Sompi on buy, token base units on sell. */
  amountUnits: bigint;
  address?: string;
  /** The account's compressed public key. */
  publicKey?: string;
  network: string;
  /** Spendable input balance in base units; absent: unknown. */
  balanceIn?: bigint;
  /** Percent. */
  slippage: number;
  signer?: Pick<IWallet, "signInputDigest">;
};

function useDebounced<T>(value: T): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [value]);
  return settled;
}

/** KaspaRocket leg of the swap screen: KAS ⇄ one KCC-20 with a pool, mainnet. */
export function useKaspaRocketSwap(i: KaspaRocketSwapInput): L1SwapHandlers {
  const { side, tokenId, address, amountUnits } = i;
  const live = i.on && i.active;
  const [client] = useState(() => makeKaspaRocket());
  const {
    pool,
    error: poolError,
    isLoading: poolLoading,
  } = useKaspaRocketPool(client, live, tokenId);
  const { fees } = useKaspaRocketProtocol(client, live);
  const settled = useDebounced(amountUnits);
  const bps = Math.round(i.slippage * 100);
  const pk = i.publicKey?.replace(/^0x/, "");
  const xOnlyPk = pk?.length === 66 ? pk.slice(2) : pk;
  const keyOf = (u: bigint) => `${tokenId}:${side}:${u}:${bps}:${address}`;

  const [isSigning, setIsSigning] = useState(false);
  const signingRef = useRef(false);
  const [refusal, setRefusal] = useState<{ units: bigint; message: string }>();
  const [report, setReport] = useState<DiagnosticReport | null>();
  const [prepared, setPrepared] = useState<KaspaRocketPrepared>();
  const [planError, setPlanError] = useState<unknown>();
  const [planNonce, rebuildPlan] = useReducer((n: number) => n + 1, 0);

  const quoteKey =
    live && tokenId && pool && address && settled > 0n
      ? ([
          "kasparocketQuote",
          tokenId,
          pool,
          side,
          settled.toString(),
          bps,
          address,
        ] as const)
      : null;
  const {
    data: quote,
    error: quoteError,
    isLoading: quoteLoading,
    mutate: refreshQuote,
  } = useSWR<Quote>(
    quoteKey,
    () =>
      client.quote({
        tokenId: tokenId!,
        lpCovenantId: pool!,
        direction: side,
        ...(side === "buy"
          ? { kasBudgetSompi: settled }
          : { amountTokens: settled }),
      }),
    // Paused while signing: a refresh never swaps the quote mid-confirm.
    {
      refreshInterval: 15_000,
      isPaused: () => signingRef.current,
      revalidateOnFocus: false,
    },
  );

  // Quote, then plan, then preview: the confirm signs this plan or nothing.
  const planWanted =
    !!quoteKey && !!quote && !quote.uneconomic && quote.netKasSompi > 0n;
  useEffect(() => {
    if (!planWanted || !quote) return;
    let alive = true;
    const key = keyOf(settled);
    const units = settled;
    setPlanError(undefined);
    client
      .planSwap({
        tokenId: tokenId!,
        lpCovenantId: pool!,
        address: address!,
        direction: side,
        ...(side === "buy"
          ? { kasBudgetSompi: units }
          : { amountTokens: units }),
      })
      .then(
        (plan) =>
          alive &&
          setPrepared({ quote, plan, key, units, builtAt: Date.now() }),
        (e) => alive && setPlanError(e),
      );
    return () => {
      alive = false;
    };
    // keyOf folds tokenId, side, bps and address into the key.
  }, [planWanted, quote, planNonce, pool, keyOf(settled)]);
  const shown =
    quoteKey && prepared?.key === keyOf(settled) ? prepared : undefined;

  // One swap in flight per account and token, whichever side.
  const pairKey = tokenId ? `KAS:${tokenId}` : undefined;
  const storeKey =
    live && address && pairKey
      ? kaspaRocketPendingKey(i.network, address, pairKey)
      : undefined;
  const [pending, setPending] = useState(false);
  // On mount and while open: settle the stored record from the chain only.
  // Never rebuilds, re-signs or resubmits it.
  useEffect(() => {
    setPending(false);
    if (!storeKey) return;
    let alive = true;
    const settle = () => {
      if (signingRef.current) return;
      settlePendingKaspaRocket(storeKey, kaspaRocketChainCheck).then(
        (o) => alive && !signingRef.current && setPending(o === "pending"),
        // An unreadable store blocks: the pair may be live.
        () => alive && setPending(true),
      );
    };
    settle();
    const t = setInterval(settle, KASPAROCKET_SETTLE_POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [storeKey]);

  // KAS a trade moves: the budget on buy, the quoted flow on sell.
  const kasOf = (u: bigint) =>
    side === "buy"
      ? u
      : quote && settled === u
        ? quote.kasFlowSompi
        : undefined;

  const onConfirm = async () => {
    if (signingRef.current) return;
    const held = prepared;
    if (
      !held ||
      !storeKey ||
      !pairKey ||
      !pool ||
      !tokenId ||
      !xOnlyPk ||
      !i.signer
    ) {
      setRefusal({ units: amountUnits, message: PREPARE_COPY });
      return;
    }
    const signer = i.signer;
    signingRef.current = true;
    setIsSigning(true);
    setRefusal(undefined);
    setReport(undefined);
    let r: KaspaRocketConfirmResult | undefined;
    try {
      r = await confirmKaspaRocketSwap({
        storeKey,
        pairKey,
        prepared: held,
        liveKey: keyOf(amountUnits),
        tokenId,
        lpCovenantId: pool,
        side,
        slippageBps: bps,
        xOnlyPk,
        signDigest: (plan) => kaspaRocketWalletDigest(signer, plan),
        submit: (signed, plan) =>
          client.submit(signed, plan.order_row, plan.sponsor_row),
        onRecord: () => setPending(true),
      });
      setPending(r.pending);
      if (r.message) setRefusal({ units: amountUnits, message: r.message });
      if (r.error !== undefined) {
        // Copy logs: the error and what was traded, never the plan or a signature.
        setReport(
          buildDiagnosticReport("kasparocket-swap", r.error, () => ({
            side,
            tokenId,
            amountIn: held.units.toString(),
            slippageBps: bps,
          })),
        );
      }
      if (r.rebuild) rebuildPlan();
    } finally {
      signingRef.current = false;
      setIsSigning(false);
      if (r?.requote) void refreshQuote();
    }
  };

  const inDecimals = side === "buy" ? KAS_DECIMALS : i.tokenDecimals;
  const outDecimals =
    side === "buy" ? (fees?.tokenDecimals ?? i.tokenDecimals) : KAS_DECIMALS;

  const extraErrorMessage = (() => {
    if (!i.active) return undefined;
    if (!i.on) return KASPAROCKET_OFF_COPY;
    if (poolError)
      return kaspaRocketErrorCopy(
        poolError,
        "Unable to load KaspaRocket pools. Please try again.",
      );
    if (pool === null) return KASPAROCKET_NO_POOL_COPY;
    if (pending) return KASPAROCKET_PENDING_COPY;
    if (refusal?.units === amountUnits) return refusal.message;
    if (settled === 0n) return undefined;
    const kas = kasOf(settled);
    const belowMin =
      kas === undefined ? undefined : kaspaRocketMinOrderError(kas, fees);
    if (belowMin) return belowMin;
    if (quoteKey && quoteError)
      return kaspaRocketErrorCopy(
        quoteError,
        "Unable to get a quote. Please try again.",
      );
    if (quoteKey && quote && (quote.uneconomic || quote.netKasSompi <= 0n))
      return KASPAROCKET_UNECONOMIC_COPY;
    if (planWanted && planError)
      return kaspaRocketErrorCopy(planError, PREPARE_COPY);
    return undefined;
  })();

  const payout =
    shown && xOnlyPk && tokenId
      ? kaspaRocketPlanPayout(shown.plan, tokenId, xOnlyPk, side)
      : null;

  return {
    side,
    quote: payout !== null ? { amountOut: payout } : undefined,
    pending,
    pendingCopy: pending ? KASPAROCKET_PENDING_COPY : undefined,
    isSigning,
    isLoading:
      (live && pool === undefined && !poolError) ||
      poolLoading ||
      quoteLoading ||
      (planWanted && !shown && !planError) ||
      settled !== amountUnits,
    validateAmount: (units) =>
      kaspaRocketValidate(units, i.balanceIn, kasOf(units), fees),
    findMax: () => {
      if (i.balanceIn === undefined || inDecimals === undefined)
        return undefined;
      // Buy: the network fee comes on top of the KAS budget.
      const max =
        side === "buy"
          ? i.balanceIn - KASPAROCKET_NETWORK_FEE_CEILING_SOMPI
          : i.balanceIn;
      return formatUnits(max > 0n ? max : 0n, inDecimals);
    },
    onConfirm,
    report,
    extraErrorMessage,
    advisory: [],
    minOut: shown
      ? kaspaRocketMinOut(shown.quote, side, BigInt(bps))
      : undefined,
    feeLines: kaspaRocketFeeLines(
      shown?.plan,
      settled > 0n ? kasOf(settled) : undefined,
      fees,
    ),
    // Kastle's take is KaspaRocket's partner fee, inside the KaspaRocket line.
    kastleFeeBps: 0,
    rate:
      payout !== null &&
      payout > 0n &&
      shown &&
      shown.units > 0n &&
      inDecimals !== undefined &&
      outDecimals !== undefined
        ? Number(formatUnits(payout, outDecimals)) /
          Number(formatUnits(shown.units, inDecimals))
        : undefined,
  };
}
