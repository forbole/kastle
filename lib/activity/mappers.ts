import { formatEther } from "viem";
import { registerActivityMapper } from "@/lib/activity/feed";
import {
  ActivityAmount,
  ActivityRowDescriptor,
  ActivityStatusToken,
} from "@/lib/activity/types";
import type {
  KurveBridgeActivity,
  KurveRegistryStatus,
} from "@/lib/bridge/kat-registry";
import {
  KAT_L1_CHAIN_ID,
  type KatBridgeStatus,
  type KatBridgeTx,
} from "@/lib/bridge/kat-bridge-history";
import type { IgraDeposit } from "@/lib/bridge/igra-deposit-history";
import { TX_EXPLORER } from "@/lib/activity/externals";
import { igraMainnet, kasplexMainnet } from "@/lib/layer2";
import { NetworkType } from "@/contexts/SettingsContext";

// ─── swap ────────────────────────────────────────────────────────────────────

export const SWAP_ACTIVITY_TYPE = "swap";

// Produced by lib/activity/swap-history.ts (Blockscout explorer). txHash and
// providerId are optional: the explorer supplies both. Both forward to meta —
// txHash lights the detail sheet's Tx Hash row, providerId its Provider row.
export interface SwapActivityRecord {
  id: string;
  timestampMs: number;
  fromSymbol: string;
  toSymbol: string;
  /** Decimal strings in display units. */
  fromAmount: string;
  toAmount: string;
  /** "pending" is reserved for in-flight local swaps; explorer rows never carry it. */
  status: "completed" | "failed" | "pending";
  txHash?: string;
  providerId?: string;
  /** Network (gas) fee in display units + its symbol, when the explorer supplied it. */
  feeAmount?: string;
  feeSymbol?: string;
  /**
   * Kastle's fee-collector cut, in display units + its symbol, exactly as the
   * collector's own FeeCollected log stated it — never a rate applied to the
   * input. Both absent means one of two different things, which
   * kastleFeeUnobserved tells apart.
   */
  kastleFeeAmount?: string;
  kastleFeeSymbol?: string;
  /**
   * The swap definitely paid a cut and we could not read how much. Absent
   * alongside an absent kastleFeeAmount means the opposite: nothing was paid,
   * observed. The sheet renders the first as "-" and the second as no row.
   */
  kastleFeeUnobserved?: true;
  /** Chain the swap executed on. Absent → the row falls back to Igra. */
  chainId?: number;
}

/**
 * A leg is only rendered when it was actually observed. buildSwapRecords fills
 * an unindexed leg with amount "0" / symbol "" — a TRUTHY object that renders a
 * missing logo next to a blank-symbol "+0". Omit the key instead, which is the
 * honest shape for "we could not see this side of the swap": adapters.tsx then
 * has one value to recognise rather than two, and renders "-" where it needs a
 * glyph (fromSymbol/toSymbol, sentAmount) and nothing where it does not. It
 * does NOT drop the row — the row still renders, minus that side; only the
 * Rate detail line collapses (adapters.test.tsx asserts exactly this).
 */
function swapLeg(value: string, symbol: string): ActivityAmount | undefined {
  const n = Number(value);
  return symbol && Number.isFinite(n) && n > 0 ? { value, symbol } : undefined;
}

export function mapSwapActivity(s: SwapActivityRecord): ActivityRowDescriptor {
  const sent = swapLeg(s.fromAmount, s.fromSymbol);
  const received = swapLeg(s.toAmount, s.toSymbol);
  // Explorer supplies txHash (tappable Transaction row, same block-explorer
  // link path as bridge exits) and providerId (Provider row). meta stays absent
  // when nothing exists — adapters treat that as "nothing extra".
  const meta: Record<string, string> = {};
  if (s.txHash) meta.txHash = s.txHash;
  if (s.providerId) meta.providerId = s.providerId;
  // Provider Fees: the network (gas) fee the swap tx paid.
  if (s.feeAmount && s.feeSymbol) {
    meta.fee = `${trimDecimal(Number(s.feeAmount))} ${s.feeSymbol}`;
  }
  // Kastle's own cut, when the swap paid one. It is not derivable from the
  // three ADDRESS-SCOPED collections swap-history.ts reads — they key on the
  // user, and the retention lands on the collector — so swap-history.ts reads
  // the collector's own FeeCollected log out of the swap's receipt and passes
  // the wei through verbatim. Never a rate applied to fromAmount: measured
  // live across both test wallets, 22 of the 32 real swaps go straight to a
  // router and pay nothing at all, and 3 of the 10 that do pay are charged in
  // the input TOKEN rather than in the chain's native coin (iKAS on Igra, KAS
  // on Kasplex) — a rate times fromAmount gets both the zeroes and those
  // symbols wrong, whatever rate it picks.
  if (s.kastleFeeAmount && s.kastleFeeSymbol) {
    meta.kastleFee = `${trimDecimal(Number(s.kastleFeeAmount))} ${s.kastleFeeSymbol}`;
  } else if (s.kastleFeeUnobserved) {
    // Paid a cut we could not read — distinct from paid nothing, which leaves
    // every key absent and renders no row at all.
    meta.kastleFeeUnobserved = "1";
  }
  // Swaps execute on an L2, but not always Igra — Kasplex routers exist, and
  // rows from both chains land in one feed. buildSwapRecords sets chainId on
  // every record it emits; the field stays optional for locally-recorded swaps,
  // and an absent one leaves the key off so the adapter falls back to Igra.
  // Same meta key the KAT bridge rows use.
  if (s.chainId !== undefined) {
    meta.l2Chain = s.chainId === kasplexMainnet.id ? "Kasplex" : "Igra";
  }
  return {
    id: `swap:${s.id}`,
    type: SWAP_ACTIVITY_TYPE,
    timestampMs: s.timestampMs,
    direction: "swap",
    // Spread, not `sent: x ?? undefined` — an undefined-valued key is still a
    // key, and "the leg is absent" should read the same to every consumer.
    ...(sent ? { sent } : {}),
    ...(received ? { received } : {}),
    status: s.status,
    actions: [],
    ...(Object.keys(meta).length ? { meta } : {}),
  };
}

// ─── shared ─────────────────────────────────────────────────────────────────

/** Wei → trimmed decimal string. 8dp: L1 KAS cannot express more. */
function weiToDecimal(wei: bigint): string {
  return Number(formatEther(wei))
    .toFixed(8)
    .replace(/\.?0+$/, "");
}

// ─── bridge transfer (KAT /bridge-history — deposits + remote-only exits) ────

export const BRIDGE_TRANSFER_ACTIVITY_TYPE = "bridge_transfer";

// /bridge-history rows have display-unit amounts and no exitId or refund
// semantics. Mobile also keeps a local exit log with its own row type; the
// extension bridge writes none, so KAT's history is the only exit source here.

const L2_EXPLORER_BY_CHAIN: Record<number, string> = {
  [igraMainnet.id]: igraMainnet.blockExplorers.default.url,
  [kasplexMainnet.id]: kasplexMainnet.blockExplorers.default.url,
};

/**
 * Native gas token per L2 — what an exit's burn fee (msg.value) is denominated
 * in. Kasplex settles in bridged KAS, Igra in iKAS; the wrong label here would
 * name the wrong asset on a money row, so it is read from the chain definition
 * rather than defaulted.
 */
const L2_NATIVE_SYMBOL_BY_CHAIN: Record<number, string> = {
  [igraMainnet.id]: igraMainnet.nativeCurrency.symbol,
  [kasplexMainnet.id]: kasplexMainnet.nativeCurrency.symbol,
};

const KAT_TX_STATUS_TOKEN: Record<KatBridgeStatus, ActivityStatusToken> = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
};

/**
 * KAT reports native KAS as tick "KAS" on both legs. Igra's wrapper is shown as
 * iKAS everywhere else in the app (bridge sheets, exit rows) — match that, so a
 * token's identity comes from the row rather than being hardcoded per mapper.
 */
function legSymbol(tick: string, chainId: number): string {
  // Guard, not coercion — `String(tick)` would turn an object tick
  // into the symbol "[object Object]", which is worse than admitting we do not
  // know. Anything non-string becomes "", which adapters.tsx normalises to
  // undefined in symbolText — one shape for "unknown" — while keeping the
  // observed amount. What the viewer then sees depends on the field: the
  // header's fromSymbol/toSymbol apply `?? "-"`, while amountSymbol stays
  // undefined and the amount renders bare, with no glyph in its place.
  //
  // The guard has to be here, not at the fetch boundary: the KAT fetch path
  // does validate tokenTick (isBridgeTx requires typeof === "string", though it
  // still admits ""), but this mapper is exported and registered on the feed,
  // so it is reachable from callers that never ran that check. `tick ?? ""`
  // stopped only null/undefined — a number/object/boolean tick still threw
  // .toUpperCase(), and assembleActivityFeed catches a throwing mapper and
  // drops the row silently (feed.ts:34): no count, no signal, the tx vanishes.
  const t = typeof tick === "string" ? tick.trim() : "";
  return t.toUpperCase() === "KAS" && chainId === igraMainnet.id ? "iKAS" : t;
}

export function mapBridgeTransferActivity(
  tx: KatBridgeTx,
): ActivityRowDescriptor {
  const deposit = tx.direction === "DEPOSIT";
  const l1Explorer = TX_EXPLORER[NetworkType.Mainnet];
  const l2Chain = deposit ? tx.toChainId : tx.fromChainId;
  const l2Explorer = L2_EXPLORER_BY_CHAIN[l2Chain];
  // L1 hash is the source on a deposit and the destination on a withdrawal.
  const sourceHash = deposit ? tx.l1TxId : tx.l2TxHash;
  const destHash = deposit ? tx.l2TxHash : tx.l1TxId;
  const explorerUrl = (hash: string, onL1: boolean): string | null =>
    onL1
      ? `${l1Explorer}${hash}`
      : l2Explorer
        ? `${l2Explorer}/tx/${hash}`
        : null;

  // `amount` is display units AND already NET of KAT's fee: it is what the
  // destination chain actually delivered. All 14 rows of the mainnet test
  // wallet 0x151e6413… were traced to their destination-chain credit on
  // 2026-08-20; 13 matched `amount` exactly. The exception is KAT's own
  // truncation, not ours: 3267de84 reports "80140" for a deposit the L1 op
  // (3a80d1ad…) and the Kasplex mint (0x37420ffc…) both put at
  // 80140.25988501 — so do not treat `amount` as exact for KRC-20 deposits.
  // Four of the matching rows, one per route:
  //   8c22c60a  "40" KAS   → burn msg.value 50 KAS,  L1 paid the user 40.0
  //   0c2f7d46  "1" KAS    → burn msg.value 11 KAS,  L1 paid the user 1.0
  //   e098d548  "16000" NACHO → 16000 burned on L2, 16000 delivered on L1
  //   b6fbc3c4  "1000" NACHO deposit → 1000e18 minted to the account on L2
  // So both legs render `amount` verbatim — no decimals table, no formatEther,
  // and above all no fee subtraction. The old `amount − 10` charged the fee a
  // second time on screen (40 became 30) and printed "received 1, fee 10 KAS"
  // on the small rows.
  //
  // No meta.fee is emitted either. The row carries only the net figure, so the
  // fee cannot be derived from it, and KAT's fee is max(gross × 0.1%, 10 KAS)
  // — a FLOOR, not a flat rate — so no constant is right above ~10,000 KAS.
  // Same discipline as mapBridgeExitActivity: derive a fee from an observed
  // payout, or show none. The `sent` leg is `amount` for the same reason: the
  // gross lives in the L2 burn's msg.value, which this endpoint never reports.
  const meta: Record<string, string> = {
    route: deposit ? "l1-to-l2" : "l2-to-l1",
    // KAT runs both L2s, so the row cannot name its chains without this — the
    // sheet title would otherwise have to guess Igra.
    l2Chain: l2Chain === kasplexMainnet.id ? "Kasplex" : "Igra",
  };
  // Fees come from chain, never from this endpoint — it has no fee field —
  // and never from a rate. lib/bridge/kat-observed-fees.ts reads them:
  //
  //   deposit: both cuts are outputs of the L1 commit/reveal pair, and both
  //     are KAS. The row's own legs are the bridged token, so the symbol here
  //     is what keeps "10 KAS" from reading as 10 NACHO.
  //   exit: the burn fee is msg.value on L2, in that chain's NATIVE token —
  //     KAS on Kasplex, iKAS on Igra, which is why the symbol is looked up
  //     rather than fixed. Same reason the exit-fee rows read iKAS.
  //
  // An observed 0 prints "0 KAS": six of the eleven mainnet KRC-20 deposits
  // surveyed (2026-08-27) pay no Kastle output at all because they predate the
  // fee, and that zero is a reading, not an absence. An absent field is the
  // dash, and the two are never mixed.
  const observed = tx.observedFees;
  if (deposit) {
    if (observed?.bridgeFeeSompi !== undefined) {
      meta.fee = `${trimDecimal(observed.bridgeFeeSompi / SOMPI_PER_KAS)} KAS`;
    }
    if (observed?.kastleFeeSompi !== undefined) {
      meta.kastleFee = `${trimDecimal(observed.kastleFeeSompi / SOMPI_PER_KAS)} KAS`;
    } else {
      meta.kastleFeeUnobserved = "1";
    }
  } else {
    if (observed?.exitBridgeFeeWei !== undefined) {
      const symbol = L2_NATIVE_SYMBOL_BY_CHAIN[l2Chain];
      // Without the chain's symbol the figure is a bare number on a screen
      // where two assets are already in play — dash it rather than guess KAS.
      if (symbol) {
        meta.fee = `${weiToDecimal(BigInt(observed.exitBridgeFeeWei))} ${symbol}`;
      }
    }
    // Kastle's cut on this direction is taken in the TOKEN by the fee
    // collector, so reading it means knowing whether `amount` is gross or net
    // of it. No row on either test wallet exercises the collector — both
    // KRC-20 exits on record predate it and burned the full amount — so the
    // honest rendering is the dash, not a reading of an untested assumption.
    meta.kastleFeeUnobserved = "1";
  }
  if (sourceHash) {
    meta.txHash = sourceHash;
    const url = explorerUrl(sourceHash, deposit);
    if (url) meta.sourceTxUrl = url;
  }
  if (destHash) {
    meta.destinationTxHash = destHash;
    const url = explorerUrl(destHash, !deposit);
    if (url) meta.destinationTxUrl = url;
  }

  const timestampMs = Date.parse(tx.createdAt);
  return {
    id: `bridge_transfer:${tx.id}`,
    type: BRIDGE_TRANSFER_ACTIVITY_TYPE,
    timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
    direction: deposit ? "in" : "out",
    sent: {
      value: tx.amount,
      symbol: legSymbol(tx.tokenTick, deposit ? KAT_L1_CHAIN_ID : l2Chain),
    },
    received: {
      // Already the delivered amount — see the note above.
      value: tx.amount,
      symbol: legSymbol(tx.tokenTick, deposit ? l2Chain : KAT_L1_CHAIN_ID),
    },
    status: KAT_TX_STATUS_TOKEN[tx.status] ?? "unknown",
    actions: [],
    meta,
  };
}

// ─── igra deposit (KAS -> iKAS, reconstructed from L1) ───────────────────────

export const IGRA_DEPOSIT_ACTIVITY_TYPE = "igra_deposit";

// Kept apart from BRIDGE_TRANSFER_ACTIVITY_TYPE because the source is chain
// data, not an indexer: there is no id, no status field and no destination
// hash to render — Igra credits the account at block level, with no L2
// transaction to link to. The outlay and fees come from the L1 payment; the
// delivery comes from Igra's credit list (lib/bridge/igra-credits.ts), and
// without it the row never claims completion.

const SOMPI_PER_KAS = 1e8;

/**
 * L1 acceptance is the lane being PAID, not the credit landing. Completed
 * needs Igra's credit; a credit list that was read and is still inside the
 * window is pending; anything unobserved — list unreadable, or the window
 * passed with no credit — is unknown, never completed.
 */
function igraDepositStatus(d: IgraDeposit): ActivityStatusToken {
  if (!d.accepted) return "pending";
  switch (d.credit?.status) {
    case "credited":
      return "completed";
    case "awaiting":
      return "pending";
    default:
      return "unknown";
  }
}

export function mapIgraDepositActivity(d: IgraDeposit): ActivityRowDescriptor {
  const credited = d.credit?.status === "credited" ? d.credit : null;
  // Observed credit when there is one; otherwise the payload amount, which is
  // only what the lane was ASKED to credit (the adapter labels it "You'll
  // receive" on any row that is not completed).
  const receivedSompi = credited ? credited.amountSompi : d.amountSompi;
  const amount = trimDecimal(receivedSompi / SOMPI_PER_KAS);
  const explorer = TX_EXPLORER[NetworkType.Mainnet];
  // Sent is the user's actual outlay: what the lane was paid PLUS Kastle's
  // fee output, both observed in this one L1 transaction. It used to be the
  // payload amount alone — i.e. the forwarded remainder AFTER our cut — so a
  // 25 KAS deposit rendered "Sent 24.6125 KAS" and the 0.3875 the user really
  // paid us appeared nowhere on the row. Same defect the exit side had, and
  // the same fix: show the outlay, then account for it line by line.
  const paidSompi = d.entryOutSompi + d.kastleFeeSompi;
  // Whatever the lane was paid but is not being credited. Observed 0 on every
  // mainnet deposit surveyed across both test wallets (2026-08-26) — Igra
  // takes nothing on entry. NOT hardcoded to 0: this is the delta, so the row
  // starts telling the truth on its own the day that changes.
  //
  // The 0.2 KAS that the entry quote screen discloses is NOT an Igra fee — it
  // is KASTLE_BASE_FEE, the fixed half of our own cut (hooks/bridge/
  // useKasToIgraBridge.ts), and it lands in the Kastle fee output below.
  const providerFeeSompi = Math.max(0, d.entryOutSompi - receivedSompi);
  return {
    id: `igra_deposit:${d.txId}`,
    type: IGRA_DEPOSIT_ACTIVITY_TYPE,
    timestampMs: d.timestampMs,
    direction: "in",
    sent: { value: trimDecimal(paidSompi / SOMPI_PER_KAS), symbol: "KAS" },
    // The payload amount matched Igra's own credit to the sompi on every
    // mainnet deposit surveyed (2026-08-26) but one: 97b13711f9126c4e… was
    // accepted on L1 (9.725 KAS to the lane) and Igra never credited it. So
    // only an observed credit completes the row.
    received: { value: amount, symbol: "iKAS" },
    status: igraDepositStatus(d),
    actions: [],
    meta: {
      route: "l1-to-l2",
      txHash: d.txId,
      sourceTxUrl: `${explorer}${d.txId}`,
      destination: d.evmAddress,
      // Both observed outputs of the L1 payment, so both are exact and both
      // are KAS (the cut is taken on L1, before anything reaches Igra).
      // A 0 here is a real 0: 10 of the 32 surveyed deposits pay
      // KASTLE_FEE_ADDRESS nothing anywhere in the transaction, so "0 KAS" is a
      // true statement about them. An 11th pays exactly 0.75% of gross with no
      // base. Deriving the figure from today's 0.2 + 0.75% instead would invent
      // a charge on 10 rows and overstate an 11th. Why those 11 differ is not
      // on chain — see the header of lib/bridge/igra-deposit-history.ts for the
      // two explanations that were tried there and do not hold.
      kastleFee: `${trimDecimal(d.kastleFeeSompi / SOMPI_PER_KAS)} KAS`,
      fee: `${trimDecimal(providerFeeSompi / SOMPI_PER_KAS)} KAS`,
    },
  };
}

// ─── kurve bridge (Kaspa ↔ Kasplex, KAT registry + local backup) ────────────

export const KURVE_BRIDGE_ACTIVITY_TYPE = "bridge_kurve";

const KURVE_STATUS_TOKEN: Record<KurveRegistryStatus, ActivityStatusToken> = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
  NOT_FOUND: "unknown",
};

// The received leg and provider fee come from the settlement
// applyKurveCompletions observed (the L1 payout on an exit, the Kasplex credit
// on a deposit): received = that payout, fee = amount − payout.
//
// Without an observation only a deposit keeps a figure, because its flat fee
// has chain backing: the L2 credit is exactly 0.5 KAS under the vault deposit
// on every mainnet Kurve entry surveyed 2026-08-26 (11.71→11.21,
// 4.7625→4.2625, 118.90→118.4, 99.05→98.55, 9.725→9.225). The exit rate has
// no such backing — 0.5% is only the hook's estimate — so an unobserved exit
// shows neither a received leg nor a fee.
const KURVE_DEPOSIT_FLAT_FEE = 0.5;

/** 8dp, trailing zeros dropped. Exported so adapters.tsx renders fees the same
 * way the mappers write them, rather than inventing a second format. */
export function trimDecimal(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, "");
}

export function mapKurveBridgeActivity(
  a: KurveBridgeActivity,
): ActivityRowDescriptor {
  const deposit = a.direction === "l1-to-l2";
  const amountNum = Number(a.amount);
  // Payouts are KAS; they say nothing about a non-KAS row.
  const observedKas =
    a.observedPayoutSompi !== undefined && a.tokenSymbol === "KAS"
      ? a.observedPayoutSompi / SOMPI_PER_KAS
      : null;
  const receivedNum = !Number.isFinite(amountNum)
    ? null
    : observedKas !== null
      ? observedKas
      : deposit
        ? amountNum - KURVE_DEPOSIT_FLAT_FEE
        : null;
  const feeKas =
    receivedNum !== null ? Math.max(0, amountNum - receivedNum) : null;
  // The registry amount is the LANE output, already net of Kastle's cut, so
  // the gross the user parted with is lane + cut. Symbol-gated: the cut is
  // always KAS, and adding it to a KRC-20 amount would be nonsense.
  const kastleFeeKas =
    deposit && a.kastleFeeSompi !== undefined && a.tokenSymbol === "KAS"
      ? a.kastleFeeSompi / SOMPI_PER_KAS
      : null;
  const sentValue =
    kastleFeeKas !== null && Number.isFinite(amountNum)
      ? trimDecimal(amountNum + kastleFeeKas)
      : a.amount;

  const kasplexExplorer = kasplexMainnet.blockExplorers.default.url;
  const l1Explorer = TX_EXPLORER[NetworkType.Mainnet];
  const sourceTxUrl = deposit
    ? `${l1Explorer}${a.originTxHash}`
    : `${kasplexExplorer}/tx/${a.originTxHash}`;
  const destinationTxUrl = a.destTxHash
    ? deposit
      ? `${kasplexExplorer}/tx/${a.destTxHash}`
      : `${l1Explorer}${a.destTxHash}`
    : null;

  const meta: Record<string, string> = {
    txHash: a.originTxHash,
    route: a.direction,
    sourceTxUrl,
  };
  if (feeKas !== null) meta.fee = `${trimDecimal(feeKas)} ${a.tokenSymbol}`;

  // Kastle's cut is direction-specific, and the adapter used to print a flat
  // "0 KAS" for both — true on exits, false on entries.
  //
  // Exit (Kasplex → Kaspa): a real 0, but the import is only half the argument.
  // Kastle charges through two independent mechanisms — an L1 output to
  // KASTLE_FEE_ADDRESS, and a rate read from the fee-collector contract on L2
  // (useKatEvmToKasBridge). Not importing the address rules out the first only.
  // The second is ruled out separately: useKasplexToKaspaBridge never reads a
  // collector rate either, it sets kastleFees: 0 outright, and no exit in
  // either mainnet test wallet pays KASTLE_FEE_ADDRESS anything (surveyed
  // 2026-08-27 — every transaction that pays it is an entry).
  //
  // Entry (Kaspa → Kasplex): useKaspaToEvmBridge pays KASTLE_BASE_FEE +
  // amount × KASTLE_FEE_RATE to KASTLE_FEE_ADDRESS as an extraOutput. Observed
  // on mainnet 2026-08-26 at 0.29, 0.275, 0.95, 1.09999999 and 0.2375 KAS — so
  // "0 KAS" was false on every one of them. All five are 0.2 + 0.75% of gross
  // (re-derived 2026-08-27), the same schedule the Igra lane charges.
  //
  // The /kurve-bridge registry does not carry it (it stores the post-cut vault
  // amount), so this row's own data cannot show it — but the cut is a plain
  // output of the origin L1 transaction the row already names. Watched live on
  // 2026-08-27: the row for 60111b29c28d rendered "Kastle Fees –" while that
  // transaction pays 0.3125 KAS to KASTLE_FEE_ADDRESS alongside 14.6875 to the
  // lane. attachKurveKastleFees now reads exactly that output, so entries show
  // the cut; only entries whose L1 read failed keep the dash.
  if (!deposit) meta.kastleFee = `0 ${a.tokenSymbol}`;
  else if (kastleFeeKas !== null)
    meta.kastleFee = `${trimDecimal(kastleFeeKas)} KAS`;
  else meta.kastleFeeUnobserved = "1";

  if (a.destTxHash) meta.destinationTxHash = a.destTxHash;
  if (destinationTxUrl) meta.destinationTxUrl = destinationTxUrl;

  return {
    id: `bridge_kurve:${a.originTxHash}`,
    type: KURVE_BRIDGE_ACTIVITY_TYPE,
    timestampMs: a.timestampMs,
    direction: deposit ? "in" : "out",
    // Gross, not the registry amount. The registry stores what
    // useKaspaToEvmBridge POSTs, which is already `amount - kastleFee` (the
    // vault output) — a 15 KAS entry is recorded as 14.6875. Adding the cut
    // back is only possible once it has been read; unread entries still show
    // the understated lane amount rather than a guess.
    sent: { value: sentValue, symbol: a.tokenSymbol },
    // Spread, not `? … : undefined` — same rule as mapSwapActivity.
    ...(receivedNum !== null && receivedNum > 0
      ? { received: { value: trimDecimal(receivedNum), symbol: a.tokenSymbol } }
      : {}),
    status: KURVE_STATUS_TOKEN[a.status] ?? "unknown",
    actions: [],
    meta,
  };
}

registerActivityMapper(SWAP_ACTIVITY_TYPE, mapSwapActivity);
registerActivityMapper(KURVE_BRIDGE_ACTIVITY_TYPE, mapKurveBridgeActivity);
registerActivityMapper(
  BRIDGE_TRANSFER_ACTIVITY_TYPE,
  mapBridgeTransferActivity,
);
registerActivityMapper(IGRA_DEPOSIT_ACTIVITY_TYPE, mapIgraDepositActivity);

export type ActivityPageType = "swap" | "bridge";

/**
 * Figma splits activity into separate Bridge / Swap pages; the feed is
 * shared, so pages filter by mapper type. Lives here (not feed.ts) because
 * this module owns the type constants — feed.ts importing them back would be
 * circular.
 */
export function rowsForPage(
  rows: ActivityRowDescriptor[],
  pageType: ActivityPageType,
): ActivityRowDescriptor[] {
  // Every registered non-swap type is a bridge row.
  return rows.filter(
    (row) => (row.type === SWAP_ACTIVITY_TYPE) === (pageType === "swap"),
  );
}
