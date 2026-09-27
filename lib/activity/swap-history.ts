import { formatUnits, numberToHex } from "viem";
import {
  getSwapProvidersForChain,
  getWkasAddress,
} from "@/lib/evm/swap/constants";
import { igraMainnet, kasplexMainnet } from "@/lib/layer2";
import type { SwapActivityRecord } from "@/lib/activity/mappers";

/**
 * Swap history from the per-chain Blockscout explorers (etherscan-compatible v1
 * API). Igra and Kasplex both run Blockscout and answer the same three actions
 * with the same envelope, so one parameterised client serves both; the only
 * shape difference this module has to handle is that `txlistinternal` names the
 * tx `transactionHash` rather than `hash` (normalised in groupByHash).
 *
 * Why the explorer and not the chain: the routers are Uniswap-V2-style and
 * stateless — they keep no per-user history — and scanning pool event logs from
 * a phone is not viable. The explorer is the only practical source for the
 * rows. What it cannot answer comes from the chain, batched JSON-RPC per chain
 * (see observeSwapReceipts): Kastle's own cut, which never leaves the collector
 * and so appears in no address-scoped collection — and, on Igra, which indexes
 * no internal transactions at all, the native receive leg of a token → iKAS
 * swap, reconciled from the swap's receipt against the owner's balance delta.
 *
 * Best-effort by design: every failure path degrades (fewer or no swap rows
 * plus an opaque token) and never throws into the feed. Degradation is reported
 * per chain, so one explorer being down neither hides the other chain's rows
 * nor mislabels which list is short.
 *
 * Read-only: explorer GETs, plus JSON-RPC POSTs that only ever call
 * eth_getTransactionReceipt and eth_getBalance. Nothing here signs or sends.
 */

// ─── router config ───────────────────────────────────────────────────────────

export interface SwapRouterConfig {
  providerId: string;
  name: string;
  routerAddress: string | null;
  chainId: number;
  /**
   * Every address a swap tx may be sent *to*. The app routes through the
   * provider's FeeCollector (Zealous) or proxy (KaspaCom) rather than the
   * router itself, so classifying on routerAddress alone would miss every swap
   * the app made. Empty ⇒ provider is unconfigured and is skipped.
   */
  entryAddresses: string[];
  /**
   * The one entry address that retains Kastle's cut, lowercased. Absent when
   * the provider has no collector: entering the router (or KaspaCom's proxy)
   * directly pays Kastle nothing, which is not a guess — 3 of the 9 real Igra
   * swaps did exactly that and their receipts carry no fee log at all.
   */
  feeCollectorAddress?: string;
}

export function toProviderId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Chains whose entry-address set is known. getSwapProvidersForChain() answers
 * the Kasplex set for every chain that is not Igra — including `undefined` —
 * which is a defensible default for the live swap UI (it must offer something)
 * but wrong here: history would classify an unknown chain's transactions
 * against Kasplex's addresses and invent swaps. Gated here rather than in
 * constants.ts, which the swap screen shares.
 */
const HISTORY_CHAIN_IDS: readonly number[] = [igraMainnet.id, kasplexMainnet.id];

/**
 * Venues that are NOT routable by the app but that users reach elsewhere, so
 * their transactions still belong in history. Kept here rather than in
 * lib/evm/swap/constants.ts because that list is what useAvailableSwapProviders
 * and the swap screen build their provider options from — an entry added there
 * is offered as a route, and the app has no code to trade through this one.
 * Rows from these venues carry a providerId absent from ALL_SWAP_PROVIDERS, so
 * adapters.tsx falls back to swapVenueName() for the Provider label — since
 * ed8e512 that renders "Launchpad" (name only, no logo), not a blank row.
 */
const HISTORY_ONLY_ROUTERS: Record<number, SwapRouterConfig[]> = {
  [kasplexMainnet.id]: [
    {
      // buyTokens(uint256) / sellTokens(uint256,uint256) against a bonding
      // curve: no pair and no Swap event, so only the `to` address identifies
      // it. Both legs are still readable from tokentx + tx.value + internals.
      providerId: "bonding-curve-launchpad",
      name: "Launchpad",
      routerAddress: null,
      chainId: kasplexMainnet.id,
      entryAddresses: ["0x5068a71dd6412db44f450e8e64f7903f33fd94af"],
    },
  ],
};

/**
 * Derived from the swap feature's own provider config — the addresses are not
 * duplicated here. A provider with no usable address yields no entryAddresses
 * and is skipped by the classifier rather than guessed at.
 *
 * Strictly per chain: the sets must never be unioned. `0xdfa17269…` is
 * Kasplex's fee collector and has no code on Igra, where calls to it execute
 * nothing — a unioned set would render those as completed swaps.
 */
export function swapRoutersForChain(chainId: number): SwapRouterConfig[] {
  if (!HISTORY_CHAIN_IDS.includes(chainId)) return [];
  return [
    ...getSwapProvidersForChain(numberToHex(chainId)).map((p) => ({
      providerId: toProviderId(p.name),
      name: p.name,
      routerAddress: p.routerAddress?.toLowerCase() ?? null,
      chainId,
      entryAddresses: [
        p.routerAddress,
        p.proxyAddress,
        p.feeCollectorAddress,
      ].flatMap((a) => (a ? [a.toLowerCase()] : [])),
      ...(p.feeCollectorAddress
        ? { feeCollectorAddress: p.feeCollectorAddress.toLowerCase() }
        : {}),
    })),
    ...(HISTORY_ONLY_ROUTERS[chainId] ?? []),
  ];
}

/**
 * Display name for any venue this module classifies, keyed by the providerId it
 * stamps on the row. Exists because adapters.tsx resolves names out of
 * ALL_SWAP_PROVIDERS, which by design excludes HISTORY_ONLY_ROUTERS — so a
 * launchpad row used to render no Provider line at all. Since ed8e512
 * adapters.tsx calls this as the fallback and both real Kasplex launchpad rows
 * name their venue.
 *
 * ponytail ceiling: a name, no logo — history-only venues ship no image asset,
 * so the Provider row is text-only. Upgrade path: give the router table an
 * image and adapters.tsx collapses back to one lookup.
 */
export function swapVenueName(providerId: string): string | null {
  for (const chainId of HISTORY_CHAIN_IDS) {
    const hit = swapRoutersForChain(chainId).find(
      (r) => r.providerId === providerId,
    );
    if (hit) return hit.name;
  }
  return null;
}

// ─── explorer response rows (all fields arrive as strings) ───────────────────

export interface ExplorerTx {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  /**
   * Calldata. Both explorers return the full `input` on every txlist row (157
   * of 157 across both test wallets); Igra additionally returns `methodId`,
   * Kasplex does not — so read `input` and accept `methodId` as the fallback.
   */
  input?: string;
  methodId?: string;
  isError?: string;
  txreceipt_status?: string;
  timeStamp?: string;
  gasUsed?: string;
  gasPrice?: string;
  /**
   * Both explorers return it on every txlist row (checked live 2026-08-25).
   * The native-exit reconciliation brackets this block with two balance reads.
   */
  blockNumber?: string;
}

export interface ExplorerTokenTx {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  /** The ERC-20's own address. Identifies a non-native fee token — see resolveKastleFee. */
  contractAddress?: string;
}

export interface ExplorerInternalTx {
  hash?: string;
  /** Kasplex's name for the parent tx on txlistinternal; Etherscan uses `hash`. */
  transactionHash?: string;
  to?: string;
  value?: string;
}

// ─── classification (pure) ───────────────────────────────────────────────────

const NATIVE_DECIMALS = 18;

/**
 * Entrypoints whose native `tx.value` IS the amount given up. An exact-INPUT
 * swap spends everything it is sent, so there is nothing to refund and nothing
 * for an internal-tx credit to correct; an exact-OUTPUT one overpays on purpose
 * and hands the difference straight back, so its input is only knowable once
 * the refund is. Every selector below is a keccak fact, not a guess about
 * behaviour: six name a function this repo already ships an ABI for
 * (lib/evm/swap/utils.ts), and the two launchpad ones were recovered from
 * observed calldata and then confirmed by keccak preimage — sellTokens and
 * buyTokens appear nowhere in utils.ts, which is the ponytail note below.
 *
 * Enumerated from the 32 real swaps on both test wallets across both chains.
 * OBSERVED on chain, with counts:
 *   0x0a1193dd ×13  swapExactKASForTokens        (Zealous router + FeeCollector)
 *   0x38ed1739 × 9  swapExactTokensForTokens     (Zealous router + FeeCollector)
 *   0x7ff36ab5 × 4  swapExactETHForTokens        (KaspaCom router + proxy)
 *   0xa00e728c × 3  swapExactTokensForKAS        (Zealous router + FeeCollector)
 *   0xfb3bdb41 × 1  swapETHForExactTokens        — exact-OUTPUT, deliberately
 *                   absent. This is 0x2cbc2402… on Kasplex, the one real tx
 *                   that refunded (10.05 KAS in, 0.05 back).
 *   0xed9772b6 × 1  sellTokens(uint256,uint256)  — Launchpad, also absent
 *   0x3610724e × 1  buyTokens(uint256)           — Launchpad, also absent
 *
 * ponytail: the two Launchpad selectors are named but NOT trusted. Their
 * contract is unverified on the Kasplex explorer and this repo ships no ABI for
 * it, so whether a bonding-curve buy can refund is unknown — and an unknown
 * shape stays flagged. Both real launchpad rows are on Kasplex, which indexes
 * internals, so today they resolve without ever consulting this table.
 *
 * 0x18cbafe5 is the one entry added from the ABI WITHOUT seeing it on chain;
 * it takes a token input, so the native-input rule never reads it either way.
 * Ceiling: a table, not a decoder. Upgrade path: decode the calldata against
 * the ABI and read the shape off the argument list instead of the four bytes.
 */
const EXACT_INPUT_SELECTORS: ReadonlySet<string> = new Set([
  "0x0a1193dd", // swapExactKASForTokens(uint256,address[],address,uint256)
  "0xa00e728c", // swapExactTokensForKAS(uint256,uint256,address[],address,uint256)
  "0x38ed1739", // swapExactTokensForTokens(uint256,uint256,address[],address,uint256)
  "0x7ff36ab5", // swapExactETHForTokens(uint256,address[],address,uint256)
  "0x18cbafe5", // swapExactTokensForETH(uint256,uint256,address[],address,uint256) — ABI only
]);

/** First four calldata bytes, or "" when the explorer gave neither field. */
function selectorOf(tx: ExplorerTx): string {
  return (tx.input ?? tx.methodId ?? "").slice(0, 10).toLowerCase();
}

/** Formats a raw integer string by its decimals; null when either is unusable. */
function toDisplayAmount(
  raw: string | undefined,
  decimals: string | number | undefined,
): string | null {
  const d = typeof decimals === "number" ? decimals : parseInt(decimals ?? "", 10);
  if (!Number.isInteger(d) || d < 0 || d > 36) return null;
  try {
    return formatUnits(BigInt(raw ?? ""), d);
  } catch {
    return null;
  }
}

/** gasUsed × gasPrice → native display string; null when either is unusable. */
function toNetworkFee(tx: ExplorerTx): string | null {
  try {
    const fee = BigInt(tx.gasUsed ?? "") * BigInt(tx.gasPrice ?? "");
    return fee > 0n ? formatUnits(fee, NATIVE_DECIMALS) : null;
  } catch {
    return null;
  }
}

function isNonZero(raw: string | undefined): boolean {
  try {
    return BigInt(raw ?? "0") > 0n;
  } catch {
    return false;
  }
}

function toBigIntOrZero(raw: string | undefined): bigint {
  try {
    return BigInt(raw ?? "0");
  } catch {
    return 0n;
  }
}

/**
 * Keyed on the parent transaction hash. Kasplex's txlistinternal names that
 * field `transactionHash`, not Etherscan's `hash` (verified live), so reading
 * `hash` alone drops every internal row there — and with it every token →
 * native receive leg. Igra indexes no internal transactions at all, so its
 * field name is unobserved; both names are accepted.
 */
function groupByHash<T extends { hash?: string; transactionHash?: string }>(
  rows: T[],
): Map<string, T[]> {
  const byHash = new Map<string, T[]>();
  for (const row of rows) {
    const hash = (row.transactionHash ?? row.hash)?.toLowerCase();
    if (!hash) continue;
    const bucket = byHash.get(hash);
    if (bucket) bucket.push(row);
    else byHash.set(hash, [row]);
  }
  return byHash;
}

/**
 * A swap row plus the one thing the row itself cannot say: whether the native
 * amount shown as the input was verified against this chain's internal
 * transactions, or is only the gross `tx.value` because nothing could confirm
 * it. SwapActivityRecord lives in mappers.ts and is shared with the live-swap
 * path, which has no such doubt, so the flag rides alongside instead.
 */
export type SwapHistoryRecord = SwapActivityRecord & {
  /**
   * Set only when it is true: the native input is shown gross and a refund, if
   * one happened, is still inside it. hasUnresolvedLeg() reports it.
   */
  nativeInputUnverified?: true;
  /**
   * Set only when it is true: this swap entered through a FeeCollector, so a
   * cut was retained, and the receipt that would say how much could not be
   * read. Distinct from "the receipt was read and logged nothing", which is an
   * observed ZERO and leaves both this and kastleFeeAmount unset.
   * hasUnresolvedLeg() reports it; the sheet renders "-", never a number.
   */
  kastleFeeUnobserved?: true;
};

/**
 * One FeeCollected log, as the collector emitted it.
 *
 * `token` is "" for the native cut (the event's indexed token is the zero
 * address) and the ERC-20's address otherwise — Kastle charges in the INPUT
 * token, not always native: 0xe60a0705… on Igra retained 352557222150000000
 * of 0x093d77d3… (IGRA), the token that tx spent.
 */
export interface KastleFeeLog {
  token: string;
  amountRaw: string;
}

/**
 * Per-transaction fee observations, keyed by tx hash.
 *
 * The whole point of the type is the third state. `null` = the receipt WAS
 * read and carried no fee log ⇒ zero. A hash simply ABSENT = the receipt could
 * not be read ⇒ unknown, which is not zero and must never render as one.
 */
export type KastleFeeMap = Map<string, KastleFeeLog | null>;

export interface BuildSwapRecordsInput {
  txs: ExplorerTx[];
  transfers: ExplorerTokenTx[];
  /** Native credits back to the user (token → native leg). May be empty. */
  internals?: ExplorerInternalTx[];
  account: string;
  routers: SwapRouterConfig[];
  nativeSymbol: string;
  /**
   * Fee observations for the collector-entry rows, from observeSwapReceipts().
   * Omitted entirely ⇒ no fee was looked for and none is claimed either way;
   * that is the shape the pure unit tests use. fetchSwapHistory always passes
   * a map, so in production an absent hash means "could not read", not "not
   * asked" — see KastleFeeMap.
   */
  kastleFees?: KastleFeeMap;
  /**
   * Receipt-reconciled native payouts for token → native rows that no internal
   * credit answers for, from observeSwapReceipts(): hash → wei received. A
   * hash is present ONLY when the owner's balance delta equalled the receipt's
   * Withdrawal minus its native cuts — an entry is an observation, an absent
   * hash is an unread leg, exactly the internals' contract.
   */
  nativeExitPayouts?: Map<string, string>;
}

/**
 * Turns one fee log into a display amount + symbol, using the metadata this tx
 * already carries. Null when the token cannot be named.
 *
 * ponytail: the fee token's symbol/decimals are read off this transaction's own
 * tokentx legs rather than from the contract. All 3 non-native fees observed
 * (Igra 0xe60a0705… IGRA, Kasplex 0x0ce57125… and 0x6b98d3eb… NACHO) charge in
 * a token the same tx transferred, so the leg is always there — and taking the
 * symbol from the same place as the input leg's keeps the two lines on the
 * sheet agreeing with each other, which a separate lookup could not promise.
 * Ceiling: a fee in a token this tx never moved has never been observed, and
 * rather than assume 18/native for it the row reports the fee unknown. Upgrade
 * path: eth_call symbol()/decimals() on that address, two more requests.
 */
function resolveKastleFee(
  fee: KastleFeeLog,
  legs: ExplorerTokenTx[],
  nativeSymbol: string,
): { amount: string; symbol: string } | null {
  if (!fee.token) {
    const amount = toDisplayAmount(fee.amountRaw, NATIVE_DECIMALS);
    return amount ? { amount, symbol: nativeSymbol } : null;
  }
  const leg = legs.find(
    (l) => l.contractAddress?.toLowerCase() === fee.token && !!l.tokenSymbol,
  );
  const amount = leg && toDisplayAmount(fee.amountRaw, leg.tokenDecimal);
  return amount && leg?.tokenSymbol
    ? { amount, symbol: leg.tokenSymbol }
    : null;
}

/**
 * One row per swap transaction: a tx is a swap when its `to` is one of the
 * configured providers' entry addresses. Token legs come from tokentx, the
 * native leg from the tx `value` (native → token) or an internal tx credit
 * (token → native), since native transfers never appear in tokentx. Where no
 * credit is indexed — Igra indexes none chain-wide — the receipt-reconciled
 * payout (nativeExitPayouts) is the token → native fallback.
 */
export function buildSwapRecords({
  txs,
  transfers,
  internals = [],
  account,
  routers,
  nativeSymbol,
  kastleFees,
  nativeExitPayouts,
}: BuildSwapRecordsInput): SwapHistoryRecord[] {
  const owner = account.toLowerCase();

  const providerByEntry = new Map<string, SwapRouterConfig>();
  for (const router of routers) {
    for (const entry of router.entryAddresses) {
      providerByEntry.set(entry.toLowerCase(), router);
    }
  }
  if (providerByEntry.size === 0) return []; // nothing configured — skip, don't guess

  const transfersByHash = groupByHash(transfers);
  const internalsByHash = groupByHash(internals);

  // Whether this explorer indexes internal transactions for this address AT
  // ALL. Igra answers txlistinternal with status "0" / "No internal
  // transactions found" for every address (checked live 2026-08-24 against both
  // test wallets), and a txlistinternal that failed outright reaches this
  // function as [] too. In both cases an empty bucket for one tx is evidence of
  // nothing. One credit anywhere in this address' history proves the endpoint
  // works, and only then does an empty bucket mean "no native was paid back".
  //
  // ponytail: address-scoped, so a wallet whose only swaps are native → token
  // on a chain that DOES index internals still reads as unindexed. The selector
  // rule below caps what that costs: reading unindexed now doubts a row only
  // when its entrypoint is exact-output or unrecognised, which is exactly the
  // set worth being conservative about. Upgrade path: a per-tx trace, which no
  // explorer action exposes.
  const internalsIndexed = internals.length > 0;

  const records: SwapHistoryRecord[] = [];
  for (const tx of txs) {
    const hash = tx.hash?.toLowerCase();
    if (!hash) continue;
    const provider = providerByEntry.get(tx.to?.toLowerCase() ?? "");
    if (!provider) continue; // plain send / unrelated contract call

    const legs = transfersByHash.get(hash) ?? [];
    const sentLeg = legs.find((t) => t.from?.toLowerCase() === owner);
    const receivedLeg = legs.find((t) => t.to?.toLowerCase() === owner);
    // Native paid back to the user inside this tx. It is the receive leg of a
    // token → native swap, and exact-output change when the output is a token.
    const nativeCredits = (internalsByHash.get(hash) ?? []).filter(
      (i) => i.to?.toLowerCase() === owner && isNonZero(i.value),
    );
    // One semantic for both roles below: every credit to the owner inside this
    // tx counts. Reading one of several would silently drop the rest — of an
    // output, or of a refund. No transaction with more than one credit to the
    // owner exists across either test wallet on either chain, so this is the
    // reading that cannot lose value, not an observed shape.
    const creditedNative = nativeCredits.reduce(
      (sum, i) => sum + toBigIntOrZero(i.value),
      0n,
    );

    let fromSymbol = "";
    let fromAmount: string | null = null;
    // True when the input is shown gross and nothing could confirm that gross
    // is also net. See SwapHistoryRecord.nativeInputUnverified.
    let nativeInputUnverified = false;
    if (sentLeg) {
      fromSymbol = sentLeg.tokenSymbol ?? "";
      fromAmount = toDisplayAmount(sentLeg.value, sentLeg.tokenDecimal);
    } else if (isNonZero(tx.value)) {
      fromSymbol = nativeSymbol;
      // An exact-output swap overpays and refunds the difference in the same
      // tx — 0x2cbc2402… on Kasplex sends 10.05 KAS and gets 0.05 straight
      // back (confirmed by debug_traceTransaction: a CALL from the proxy to the
      // owner for exactly 5e16 wei) — so tx.value alone overstates what the
      // user gave up. When the output is a token, native credited back is
      // change, not the output: the only role observed for one here. Both
      // numbers are read from this transaction; no rate is assumed.
      const gross = toBigIntOrZero(tx.value);
      const change = receivedLeg && internalsIndexed ? creditedNative : 0n;
      // A credit at or above the input is not change — it is a shape this code
      // does not model, and netting it would render 0 or a negative amount.
      const netted = change > 0n && change < gross;
      fromAmount = toDisplayAmount(
        (netted ? gross - change : gross).toString(),
        NATIVE_DECIMALS,
      );
      // The failure mode this closes: with internals unreadable — the permanent
      // chain-wide state on Igra — an exact-output swap rendered gross and both
      // legs looked populated, so nothing signalled. Gross still renders; the
      // row now says the number is unconfirmed rather than passing as verified.
      //
      // Refined by the calldata selector, because internals are only NEEDED
      // where a refund is possible. Doubting an exact-input swap fired on 8 of
      // the 32 real rows permanently — every one of them an exact-input Igra
      // swap where tx.value is the input by construction — and a warning that
      // can never clear is one users learn to ignore. An unrecognised selector
      // is still doubted: this narrows the rule, it does not assume past it.
      nativeInputUnverified =
        !!receivedLeg &&
        !(internalsIndexed && (change === 0n || netted)) &&
        !EXACT_INPUT_SELECTORS.has(selectorOf(tx));
    }

    let toSymbol = "";
    let toAmount: string | null = null;
    if (receivedLeg) {
      toSymbol = receivedLeg.tokenSymbol ?? "";
      toAmount = toDisplayAmount(receivedLeg.value, receivedLeg.tokenDecimal);
    } else if (creditedNative > 0n) {
      toSymbol = nativeSymbol;
      toAmount = toDisplayAmount(creditedNative.toString(), NATIVE_DECIMALS);
    } else {
      // No token came back and no internal credit answers for a native payout
      // — on Igra none ever does, internals being unindexed chain-wide. The
      // receipt-reconciled amount is the one remaining observation; absent
      // that, the leg stays "0"/"" and hasUnresolvedLeg reports it. An indexed
      // credit deliberately wins over the receipt: the credit is the path the
      // Kasplex rows were verified chain-exact on (11/11, #147), and the
      // receipt path exists for the chain that cannot offer one.
      const payout = nativeExitPayouts?.get(hash);
      if (payout) {
        toSymbol = nativeSymbol;
        toAmount = toDisplayAmount(payout, NATIVE_DECIMALS);
      }
    }

    const networkFee = toNetworkFee(tx);
    const timestampMs = Number(tx.timeStamp ?? 0) * 1000;
    const failed = tx.isError === "1" || tx.txreceipt_status === "0";

    // Kastle's cut, three states kept apart on purpose. A swap that entered
    // the router (or KaspaCom's proxy) directly retained nothing and gets no
    // fee at all — observed, not assumed: none of the 22 non-collector rows'
    // receipts carries a fee log. A collector-entry swap gets whatever its own
    // receipt said; when that receipt could not be read the row says so rather
    // than passing "nothing found" off as "nothing charged".
    let kastleFee: { amount: string; symbol: string } | null = null;
    let kastleFeeUnobserved = false;
    const viaCollector =
      !!provider.feeCollectorAddress &&
      tx.to?.toLowerCase() === provider.feeCollectorAddress;
    if (viaCollector && kastleFees && !failed) {
      const observed = kastleFees.get(hash);
      if (observed === undefined) kastleFeeUnobserved = true;
      else if (observed !== null) {
        kastleFee = resolveKastleFee(observed, legs, nativeSymbol);
        kastleFeeUnobserved = !kastleFee;
      }
    }

    records.push({
      id: hash,
      txHash: hash,
      providerId: provider.providerId,
      // Which L2 this executed on. Rows from both chains land in one feed, so
      // without it the adapter cannot tell them apart.
      chainId: provider.chainId,
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
      fromSymbol,
      toSymbol,
      // ponytail: a failed swap (and an unindexed leg) has no transfer to read,
      // so the unknown side stays "0"/"" rather than being invented.
      // hasUnresolvedLeg() turns the second case into a degradation signal.
      fromAmount: fromAmount ?? "0",
      toAmount: toAmount ?? "0",
      status: failed ? "failed" : "completed",
      ...(networkFee ? { feeAmount: networkFee, feeSymbol: nativeSymbol } : {}),
      ...(nativeInputUnverified ? { nativeInputUnverified: true as const } : {}),
      ...(kastleFee
        ? { kastleFeeAmount: kastleFee.amount, kastleFeeSymbol: kastleFee.symbol }
        : {}),
      ...(kastleFeeUnobserved ? { kastleFeeUnobserved: true as const } : {}),
    });
  }
  return records;
}

/**
 * True when a side of a successful swap is missing OR unconfirmed.
 *
 * Missing: both legs read "0"/"" when their source was unreadable. Igra's
 * token → native rows used to live here permanently — their receive leg is an
 * internal value transfer and Igra indexes no internal transactions — until
 * the receipt reconciliation (observeSwapReceipts) started answering for
 * them; they land here now only when it refuses: an unreadable receipt or
 * balance, a provider cut at or above the withdrawal, a balance delta the
 * receipt cannot explain.
 *
 * Unconfirmed: a native input that could not be netted against this tx's
 * internal credits is shown gross, and gross is only right for an exact-input
 * swap. Both legs are populated, so the check above cannot see it.
 *
 * Measured live across both test wallets with the receipt path in place
 * (2026-08-25): 0 of the 48 real rows reaches either branch — all four Igra
 * native exits reconcile and render. Before it, the then-only Igra
 * token → iKAS row was permanently missing its receive leg.
 *
 * Unconfirmed also covers Kastle's own cut: a collector-entry swap definitely
 * paid one, so a receipt we could not read leaves a real amount unknown.
 *
 * A failed swap legitimately moved nothing, so it is not counted.
 */
export function hasUnresolvedLeg(record: SwapHistoryRecord): boolean {
  if (record.status === "failed") return false;
  if (record.nativeInputUnverified || record.kastleFeeUnobserved) return true;
  const observed = (amount: string, symbol: string) => !!symbol && amount !== "0";
  return (
    !observed(record.fromAmount, record.fromSymbol) ||
    !observed(record.toAmount, record.toSymbol)
  );
}

// ─── fetch ───────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;
// ≤1000 rows per collection. Still a phone, not an indexer — but hitting the
// bound now reports "truncated" instead of silently dropping the older half.
const MAX_PAGES = 10;
const TIMEOUT_MS = 8_000;

/**
 * What one chain's fetch established. A merge over several chains reports every
 * condition it finds, not the worst one — see mergeSwapHistories.
 *
 * "ok" is also the answer for a wallet with no swaps at all: an explorer that
 * returns an empty history is healthy, not degraded. That is a different state
 * from "unreachable", which contributes no rows because none could be read.
 */
export type SwapChainHealth =
  | "ok"
  | "legs_unresolved" // rows are real; a side of at least one is missing or unconfirmed
  | "truncated" // rows are real; the page bound cut history short
  | "unreachable"; // txlist/tokentx unreadable — this chain contributed nothing

/** Opaque, non-fatal token for the UI layer. Visual PR owns the wording. */
export type SwapHistoryDegradation =
  | "swap_history_unavailable"
  | "swap_history_igra_unavailable"
  | "swap_history_kasplex_unavailable"
  | "swap_history_partial"
  | "swap_history_legs_unresolved";

export interface SwapHistoryResult {
  chainId: number;
  swaps: SwapHistoryRecord[];
  health: SwapChainHealth;
}

/**
 * GET, or POST when a body is given. Timeout + a single retry, null on any
 * failure — never throws. Same policy for both because the caller's answer to
 * a failure is the same either way: report the gap, keep the rows.
 */
async function sendJson(url: string, body?: unknown): Promise<unknown | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        ...(body === undefined
          ? {}
          : {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      // timeout / network / rate limit / malformed body — retry once, then give up
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// ─── Kastle's cut, read off the receipt ──────────────────────────────────────

/**
 * topics[0] of FeeCollected(address token, address payer, uint256 amount) —
 * keccak-verified, and emitted by both collectors: Igra's
 * 0x2f15c748a51438d02347878a2a0f26bc35b5e938 and Kasplex's
 * 0xdfa17269221ce9fdba5bbd28f209a3a23b738978 both carry it, on all 10
 * collector-entry swaps across the two test wallets. Both index token and
 * payer, so the retained amount is the whole of `data`.
 */
const KASTLE_FEE_TOPIC =
  "0xf228de527fc1b9843baac03b9a04565473a263375950e63435d4138464386f46";

/**
 * Requests per JSON-RPC POST, receipts and balances alike. Both nodes answer
 * a 25-request batch in one
 * 200 OK, echo the ids back, and return `result: null` — not an error — for an
 * unknown hash. (Re-checked live 2026-08-25 on Igra: ids echoed in order, and
 * an unknown hash answered `result: null` alongside a normal answer.)
 *
 * Roughly 120 KB / ~1 s on Igra and ~115 KB / ~0.3 s on Kasplex. Approximate on
 * purpose: both figures depend on WHICH 25 hashes are asked for — receipts of
 * different swaps carry different numbers of logs — so repeat runs land in the
 * same order of magnitude without reproducing to the digit.
 */
const RECEIPT_BATCH = 25;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** The address packed into an indexed address topic, lowercased; "" if absent. */
function topicAddress(topic: string | undefined): string {
  return topic && topic.length === 66 ? `0x${topic.slice(26).toLowerCase()}` : "";
}

interface RpcLog {
  address?: string;
  topics?: string[];
  data?: string;
}

/**
 * topics[0] of WKAS's Withdrawal(address indexed src, uint256 wad) —
 * keccak-verified. The unwrap that ends every token → native swap emits it on
 * the chain's WKAS contract, with src = the provider contract unwrapping: the
 * router on all three real Zealous Igra native exits, the proxy on the one
 * real KaspaCom exit (all four checked on chain, 2026-08-25).
 */
const WKAS_WITHDRAWAL_TOPIC =
  "0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65";

/**
 * topics[0] of PartnerFeeCheckpoint(address,address,bytes32,uint256), the log
 * KaspaCom's proxy emits when it retains a cut of the native payout it is
 * forwarding — keccak-verified against the signature the explorer decodes on
 * the VERIFIED Igra proxy. Its uint256 word enters the reconciliation below
 * and nothing else: whether the contract means it per-swap or cumulatively is
 * unknowable from the one real observation, and a reading that is not this
 * swap's cut fails the balance-delta equality and yields no amount, never a
 * wrong one.
 */
const PARTNER_FEE_TOPIC =
  "0xb456d30f7d6b4ef452e9314c56ff3fd50b02de9b2bf1d091d4e2e77e1723f403";

/** A hex quantity as eth_getBalance answers one. */
const HEX_QUANTITY = /^0x[0-9a-f]+$/i;

/** What a native-exit reconciliation needs beyond the receipt itself. */
export interface NativeExitProbe {
  /** The chain's WKAS contract, lowercased — the Withdrawal emitter. */
  wkas: string;
  /**
   * Every address the provider acts through, lowercased (the router config's
   * entryAddresses): the Withdrawal's src and a fee log's emitter must be one
   * of them. A Withdrawal an unrelated contract triggered in the same tx is
   * not this swap's payout.
   */
  providers: string[];
  /** Decimal txlist blockNumber — the balance delta brackets this block. */
  blockNumber: string;
  /** gasUsed × gasPrice in wei: the sender's native debit besides tx.value. */
  gasCostRaw: string;
  /** tx.value in wei. */
  valueRaw: string;
}

/**
 * One receipt-costing row. `collector` set ⇒ read Kastle's cut (see
 * KastleFeeMap). `exit` set ⇒ reconcile the native payout from the same
 * receipt plus the two balances bracketing its block. Both set share ONE
 * receipt request — three of the four real Igra native-exit rows entered
 * through the FeeCollector and are both at once.
 */
export interface SwapReceiptProbe {
  hash: string;
  /** Lowercased owner: FeeCollected's payer topic and the balance address. */
  payer: string;
  collector?: string;
  exit?: NativeExitProbe;
}

/**
 * Which rows cost RPC requests, and what each is asked for.
 *
 * Fee probes: successful collector-entry rows — a reverted swap retained
 * nothing, the call rolled back, fee included. Exit probes: a token left the
 * owner, nothing came back in tokentx, no native value was attached and no
 * internal credit answers for a payout — the token → native shape on a chain
 * whose internals cannot say what came back. A row whose reconciliation
 * inputs (block, gas) are unreadable gets no exit probe and keeps today's
 * honest dash. Rows that entered a router directly and got their token back
 * cost nothing, as before.
 */
export function swapReceiptProbes(input: {
  txs: ExplorerTx[];
  transfers: ExplorerTokenTx[];
  internals: ExplorerInternalTx[];
  account: string;
  routers: SwapRouterConfig[];
  /** The chain's WKAS address, lowercased. */
  wkas: string;
}): SwapReceiptProbe[] {
  const owner = input.account.toLowerCase();
  const providerByEntry = new Map<string, SwapRouterConfig>();
  for (const router of input.routers) {
    for (const entry of router.entryAddresses) {
      providerByEntry.set(entry.toLowerCase(), router);
    }
  }
  const transfersByHash = groupByHash(input.transfers);
  const internalsByHash = groupByHash(input.internals);

  const probes: SwapReceiptProbe[] = [];
  for (const tx of input.txs) {
    const hash = tx.hash?.toLowerCase();
    const to = tx.to?.toLowerCase() ?? "";
    const provider = providerByEntry.get(to);
    if (!hash || !provider) continue;
    // A reverted swap retained nothing and paid nothing out — the call rolled
    // back, fee, unwrap and all.
    if (tx.isError === "1" || tx.txreceipt_status === "0") continue;

    const collector = provider.feeCollectorAddress === to ? to : undefined;

    const legs = transfersByHash.get(hash) ?? [];
    const sentToken = legs.some((t) => t.from?.toLowerCase() === owner);
    const receivedToken = legs.some((t) => t.to?.toLowerCase() === owner);
    const credited = (internalsByHash.get(hash) ?? []).some(
      (i) => i.to?.toLowerCase() === owner && isNonZero(i.value),
    );
    let exit: NativeExitProbe | undefined;
    if (sentToken && !receivedToken && !isNonZero(tx.value) && !credited) {
      try {
        const block = BigInt(tx.blockNumber ?? "");
        const gasCost = BigInt(tx.gasUsed ?? "") * BigInt(tx.gasPrice ?? "");
        // Block 0 has no parent balance to read; gas 0 is not a mined tx.
        if (block > 0n && gasCost > 0n) {
          exit = {
            wkas: input.wkas,
            providers: provider.entryAddresses.map((a) => a.toLowerCase()),
            blockNumber: block.toString(),
            gasCostRaw: gasCost.toString(),
            valueRaw: toBigIntOrZero(tx.value).toString(),
          };
        }
      } catch {
        // unreadable block or gas — no probe, the row keeps its dash
      }
    }
    if (collector || exit) {
      probes.push({
        hash,
        payer: owner,
        ...(collector ? { collector } : {}),
        ...(exit ? { exit } : {}),
      });
    }
  }
  return probes;
}

/** One uint256 log word, or a throw. BigInt("") is 0n and does NOT throw, so
 * an absent or empty data field used to become a confident zero — the one
 * state these maps exist to keep apart from "unknown". The LENGTH does the
 * work: BigInt already throws on "0x", "0xzzzz" and "0x_1", but it reads the
 * truncated word "0x0" as a perfectly good 0n. A uint256 is one 32-byte word —
 * 66 characters — and every log word both nodes returned is exactly that. */
function logWord(data: string | undefined): bigint {
  if (!/^0x[0-9a-f]{64}$/i.test(data ?? "")) throw new Error("not an amount");
  return BigInt(data as string);
}

/** Kastle's cut from one corroborated receipt's logs — writes the three
 * KastleFeeMap states: an amount, an observed null zero, or nothing. */
function readKastleFee(
  probe: SwapReceiptProbe,
  logs: RpcLog[],
  fees: KastleFeeMap,
): void {
  const relevant = logs.filter(
    (log) =>
      log.address?.toLowerCase() === probe.collector &&
      log.topics?.[0]?.toLowerCase() === KASTLE_FEE_TOPIC &&
      topicAddress(log.topics?.[2]) === probe.payer,
  );
  if (relevant.length === 0) {
    fees.set(probe.hash, null); // receipt read, nothing charged
    return;
  }
  // Every cut in this tx counts, for the same reason every native credit
  // does — reading one of several would silently drop the rest. No receipt
  // with more than one has been seen, so this is the reading that cannot
  // lose value, not an observed shape; two DIFFERENT tokens is a shape not
  // modelled here and is left unknown rather than summed into nonsense.
  const token = topicAddress(relevant[0].topics?.[1]);
  // "" means the token topic was absent or not a 32-byte word, so no
  // address could be read out of it. The zero address — the native cut —
  // is a full word and does NOT land here; it is handled below.
  if (!token) return;
  if (relevant.some((log) => topicAddress(log.topics?.[1]) !== token)) return;
  try {
    const total = relevant.reduce((sum, log) => sum + logWord(log.data), 0n);
    fees.set(probe.hash, {
      // The event's zero address is the native cut; "" says that plainly.
      token: token === ZERO_ADDRESS ? "" : token,
      amountRaw: total.toString(),
    });
  } catch {
    // no readable amount — unknown, which is the map's default
  }
}

/**
 * This probe's Withdrawal total and native provider cuts, from one
 * corroborated receipt's logs. Undefined — not zero — when any relevant word
 * is not a clean uint256: an unreadable payout must stay unknown.
 */
function readExitLogs(
  exit: NativeExitProbe,
  logs: RpcLog[],
): { wad: bigint; cuts: bigint } | undefined {
  const providers = new Set(exit.providers);
  let wad = 0n;
  let cuts = 0n;
  try {
    for (const log of logs) {
      const address = log.address?.toLowerCase() ?? "";
      const topic0 = log.topics?.[0]?.toLowerCase() ?? "";
      if (
        address === exit.wkas &&
        topic0 === WKAS_WITHDRAWAL_TOPIC &&
        providers.has(topicAddress(log.topics?.[1]))
      ) {
        wad += logWord(log.data);
      } else if (providers.has(address) && topic0 === PARTNER_FEE_TOPIC) {
        cuts += logWord(log.data);
      }
    }
  } catch {
    return undefined;
  }
  return { wad, cuts };
}

/**
 * Kastle's retained cut and the reconciled native exit payout for the rows
 * that need them, read out of each row's own receipt — batched, receipts and
 * balances together, ≤RECEIPT_BATCH requests per POST.
 *
 * Why receipts and not a log filter: the cut never leaves the collector, so
 * it appears in none of the address-scoped collections above — the user-side
 * legs show the gross input only. A chain-wide eth_getLogs on (collector,
 * topic) would find every row in one query in principle, but Igra's node
 * refuses a range over 100,000 blocks, which made a full sweep 151 paged
 * requests as of head 15,090,052 — O(chain), and it needs a deployment block
 * to stop being a full scan. That count is ceil(head / 100,000): it is pinned
 * to the head it was measured at, only grows, and is not reproducible later
 * at the same value — a run today reads higher.
 *
 * The exit payout is NEVER a log value printed as money. What renders is the
 * owner's balance delta across the swap's block — after − before + gas +
 * value, what the account measurably gained — and it renders only when it
 * equals, to the wei, the receipt's WKAS Withdrawal minus the provider's
 * native cuts from the same receipt. On the four real Igra native exits
 * (2026-08-25): the three Zealous rows pay wad exactly, their fee having been
 * taken in the INPUT token before the swap, and the KaspaCom row pays wad
 * minus its PartnerFeeCheckpoint amount exactly (wad 0.8948…, cut 0.0067…,
 * delta agrees to the wei). Everything else — another tx of the same account
 * in the block, a fee shape not seen before, a cut at or above the
 * withdrawal, an unreadable balance — fails the equality and the row keeps
 * its dash: a missing number invites a tap on the explorer link, a wrong one
 * gets believed.
 *
 * Balances carry no transactionHash to corroborate id pairing the way
 * receipts do. A node that mispairs them can only fail the equality (or
 * repeat the same true value); the wad side always comes from a
 * hash-corroborated receipt, so no mispairing mints an amount.
 *
 * A hash absent from a map means what it needed could not be read or did not
 * reconcile — a failed POST, a per-id error, a null result, a failed
 * equality. Callers must read absent as unknown; see KastleFeeMap.
 */
export async function observeSwapReceipts(
  rpcUrl: string,
  probes: SwapReceiptProbe[],
): Promise<{
  kastleFees: KastleFeeMap;
  /** hash → wei the owner measurably received; reconciled rows only. */
  nativeExitPayouts: Map<string, string>;
}> {
  const kastleFees: KastleFeeMap = new Map();
  const nativeExitPayouts = new Map<string, string>();

  // Whole probes per POST: one costs 1 request (its receipt) or 3 (receipt
  // plus the two balances bracketing its block), and splitting a probe across
  // POSTs would let half a reconciliation fail alone.
  const groups: SwapReceiptProbe[][] = [];
  let group: SwapReceiptProbe[] = [];
  let groupCost = 0;
  for (const probe of probes) {
    const cost = probe.exit ? 3 : 1;
    if (group.length > 0 && groupCost + cost > RECEIPT_BATCH) {
      groups.push(group);
      group = [];
      groupCost = 0;
    }
    group.push(probe);
    groupCost += cost;
  }
  if (group.length > 0) groups.push(group);

  for (const chunk of groups) {
    // id = index into `slots`: what each answer is FOR, not just which probe.
    const slots: {
      probe: SwapReceiptProbe;
      kind: "receipt" | "before" | "after";
    }[] = [];
    const requests: unknown[] = [];
    const request = (method: string, params: unknown[]) =>
      requests.push({ jsonrpc: "2.0", id: requests.length, method, params });
    for (const probe of chunk) {
      slots.push({ probe, kind: "receipt" });
      request("eth_getTransactionReceipt", [probe.hash]);
      if (probe.exit) {
        // Parseability was the probe's admission test, so this cannot throw.
        const block = BigInt(probe.exit.blockNumber);
        slots.push({ probe, kind: "before" });
        request("eth_getBalance", [probe.payer, numberToHex(block - 1n)]);
        slots.push({ probe, kind: "after" });
        request("eth_getBalance", [probe.payer, numberToHex(block)]);
      }
    }

    const payload = await sendJson(rpcUrl, requests);
    // Ids come back in whatever order the node likes, so index by id, never by
    // position. A body that is not an array is not an answer to a batch.
    if (!Array.isArray(payload)) continue;

    // Per-exit-probe scratch. `undefined` = not answered yet; a balance slot a
    // confused node answered twice with DIFFERENT values is poisoned to null.
    const scratch = new Map<
      SwapReceiptProbe,
      {
        logs?: { wad: bigint; cuts: bigint };
        before?: bigint | null;
        after?: bigint | null;
      }
    >();
    for (const probe of chunk) if (probe.exit) scratch.set(probe, {});

    for (const item of payload) {
      const { id, result } = (item ?? {}) as {
        id?: number | string;
        result?: unknown;
      };
      // ponytail: JSON-RPC permits a STRING id, and a node that echoed "0"
      // instead of 0 matched nothing — every fee row on that chain degraded to
      // "-" plus a banner, for a node behaving to spec. The id only has to
      // index into the slots; a receipt's transactionHash is what actually
      // corroborates its pairing, so there is nothing left for the numeric
      // restriction to buy. Ceiling: an id that is neither (an object, say)
      // is still unknown, which is the safe direction.
      const slot =
        typeof id === "number" || typeof id === "string"
          ? slots[Number(id)]
          : undefined;
      if (!slot) continue;

      if (slot.kind === "receipt") {
        const receipt = result as
          | { logs?: RpcLog[]; transactionHash?: string }
          | null
          | undefined;
        if (!Array.isArray(receipt?.logs)) continue; // error / unknown tx
        // The id is only the node's echo of OUR numbering, so it corroborates
        // nothing; transactionHash is the receipt saying what it actually is.
        // Requiring the two to agree costs nothing while healthy — every
        // receipt Igra returned for a 9-request batch carried it and matched
        // (checked live 2026-08-25) — and an id the node got wrong would
        // otherwise hand one swap's cut to another, confidently and in the
        // wrong token. Absent or mismatched ⇒ left out of the map ⇒ unknown.
        if (
          receipt.transactionHash?.toLowerCase() !==
          slot.probe.hash.toLowerCase()
        ) {
          continue;
        }
        if (slot.probe.collector) {
          readKastleFee(slot.probe, receipt.logs, kastleFees);
        }
        const exitState = scratch.get(slot.probe);
        if (slot.probe.exit && exitState) {
          exitState.logs = readExitLogs(slot.probe.exit, receipt.logs);
        }
        continue;
      }

      const exitState = scratch.get(slot.probe);
      if (!exitState) continue;
      const balance =
        typeof result === "string" && HEX_QUANTITY.test(result)
          ? BigInt(result)
          : null;
      const previous = exitState[slot.kind];
      exitState[slot.kind] =
        previous === undefined || previous === balance ? balance : null;
    }

    for (const probe of chunk) {
      const exit = probe.exit;
      const state = exit && scratch.get(probe);
      if (!exit || !state?.logs) continue;
      if (state.before == null || state.after == null) continue;
      const { wad, cuts } = state.logs;
      const received =
        state.after -
        state.before +
        BigInt(exit.gasCostRaw) +
        BigInt(exit.valueRaw);
      // The equality IS the safety story — see the docstring.
      if (wad > 0n && received > 0n && received === wad - cuts) {
        nativeExitPayouts.set(probe.hash, received.toString());
      }
    }
  }
  return { kastleFees, nativeExitPayouts };
}

/**
 * Unwraps the Blockscout envelope. `result` is the whole discriminator: an
 * ARRAY is a successful collection, empty or not, and anything else is a
 * request that did not produce one. Null = unusable, which degrades the chain.
 *
 * status "0" cannot be that discriminator, because BOTH answers use it —
 * checked live 2026-08-25 on both explorers, all three actions:
 *
 *   error:         {"message":"Invalid address format","result":null,"status":"0"}
 *                  {"message":"Unknown action","result":null,"status":"0"}
 *   empty success: {"message":"No transactions found","result":[],"status":"0"}
 *
 * Reading status "0" as "empty history" therefore turned every rejected,
 * malformed or rate-limited request into an empty SUCCESSFUL collection, and
 * the wallet rendered "no swaps" at health "ok" — no banner, nothing missing
 * as far as the user could tell. The message prose is not the test either: it
 * varies per action. (Not per explorer — Igra and Kasplex return byte-identical
 * prose in all six combinations. An earlier version of this comment claimed
 * they differ; they do not. `result` is still the right discriminator, for the
 * per-action reason alone.)
 */
function resultRows(payload: unknown): Record<string, string>[] | null {
  if (!payload || typeof payload !== "object") return null;
  const { result } = payload as { result?: unknown };
  if (!Array.isArray(result)) return null;
  return result.filter(
    (row): row is Record<string, string> => !!row && typeof row === "object",
  );
}

interface PagedResult {
  rows: Record<string, string>[];
  /** MAX_PAGES was exhausted before an empty page — older rows may exist. */
  truncated: boolean;
}

/**
 * Pages until a genuinely empty page. A short page is NOT treated as the end:
 * neither explorer documents that guarantee. (Neither test wallet reproduced a
 * short page mid-history on either chain, so this fixes a latent defect rather
 * than an observed loss.) The cost is one extra request per collection.
 *
 * That extra request is issued alongside page 1 instead of after it, so for the
 * common two-request collection it costs wall-clock nothing. It matters because
 * Kasplex answers txlistinternal in ~2.6 s against ~0.23 s for txlist/tokentx on
 * the same host (measured 2026-08-28), so a wallet with a single internal row
 * was paying ~5.1 s for two round trips that had no reason to be serial. Only
 * page 2 is prefetched: from page 3 on, every prior page came back full, so the
 * request count — not the round-trip count — is what dominates, and speculating
 * further would spend bandwidth for it.
 *
 * Paging policy is unchanged: the same pages are requested in the same order, a
 * short page is still not terminal, and only a genuinely empty page ends the
 * loop. Steady-state request count is unchanged too; the one case that now
 * costs an extra request is page 1 failing, where page 2 is already in flight.
 * It is left to settle unread — sendJson resolves null and never throws.
 */
async function fetchPaged(
  apiUrl: string,
  action: string,
  address: string,
): Promise<PagedResult | null> {
  const rows: Record<string, string>[] = [];
  const request = (page: number) =>
    sendJson(
      `${apiUrl}/api?module=account&action=${action}` +
        `&address=${address}&page=${page}&offset=${PAGE_SIZE}&sort=desc`,
    );
  let inFlight = request(1);
  let prefetchedPage2 = MAX_PAGES > 1 ? request(2) : null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const parsed = resultRows(await inFlight);
    if (parsed === null) return null;
    rows.push(...parsed);
    if (parsed.length === 0) return { rows, truncated: false };
    if (page < MAX_PAGES) {
      inFlight = prefetchedPage2 ?? request(page + 1);
      prefetchedPage2 = null;
    }
  }
  return { rows, truncated: true };
}

export interface FetchSwapHistoryOptions {
  address: string;
  /** Explorer origin, e.g. igraMainnet.apiUrl — the v1 API lives at `${apiUrl}/api`. */
  apiUrl: string;
  chainId: number;
  nativeSymbol: string;
  /**
   * JSON-RPC endpoint, e.g. igraMainnet.rpcUrls.default.http[0]. Required, not
   * optional: Kastle's cut is only in the receipts, and a caller that forgot to
   * pass this would silently render every collector-entry swap as having paid
   * nothing. Making it a type error is cheaper than making it a bug.
   */
  rpcUrl: string;
}

export async function fetchSwapHistory({
  address,
  apiUrl,
  chainId,
  nativeSymbol,
  rpcUrl,
}: FetchSwapHistoryOptions): Promise<SwapHistoryResult> {
  const routers = swapRoutersForChain(chainId);
  if (!routers.some((r) => r.entryAddresses.length > 0)) {
    // Unknown chain, or one with nothing configured. No rows and no complaint:
    // there is nothing here to be missing.
    return { chainId, swaps: [], health: "ok" };
  }

  const [txs, transfers, internals] = await Promise.all([
    fetchPaged(apiUrl, "txlist", address),
    fetchPaged(apiUrl, "tokentx", address),
    fetchPaged(apiUrl, "txlistinternal", address),
  ]);

  // txlist/tokentx are load-bearing: without them there is nothing to classify.
  if (!txs || !transfers) {
    return { chainId, swaps: [], health: "unreachable" };
  }

  // Only rows with something to read off their receipt cost RPC requests:
  // Kastle's cut for collector-entry rows, the native payout for exit
  // candidates — swapReceiptProbes decides which rows those are, and a row
  // that is both shares one receipt (three of the four real Igra exits do).
  // getWkasAddress's Kasplex-for-unknown default cannot leak here: unknown
  // chains already returned above with no routers configured.
  const { kastleFees, nativeExitPayouts } = await observeSwapReceipts(
    rpcUrl,
    swapReceiptProbes({
      txs: txs.rows,
      transfers: transfers.rows,
      internals: internals?.rows ?? [],
      account: address,
      routers,
      wkas: getWkasAddress(numberToHex(chainId)).toLowerCase(),
    }),
  );

  try {
    const swaps = buildSwapRecords({
      txs: txs.rows,
      transfers: transfers.rows,
      // A failed txlistinternal is not fatal, but it is not free either. It
      // carries the native credits, which are BOTH the receive leg of a token →
      // native swap AND the refund that makes an exact-output native → token
      // swap's input smaller than tx.value. Losing it therefore costs a side of
      // the row in one direction and the accuracy of a shown number in the
      // other. Rows still render, and buildSwapRecords reports both cases
      // unresolved: [] here is indistinguishable from "this chain indexes no
      // internals", which is exactly Igra's permanent state.
      internals: internals?.rows ?? [],
      account: address,
      routers,
      nativeSymbol,
      kastleFees,
      nativeExitPayouts,
    });
    const truncated =
      txs.truncated || transfers.truncated || !!internals?.truncated;
    return {
      chainId,
      swaps,
      health: truncated
        ? "truncated"
        : swaps.some(hasUnresolvedLeg)
          ? "legs_unresolved"
          : "ok",
    };
  } catch {
    return { chainId, swaps: [], health: "unreachable" };
  }
}

/**
 * Folds per-chain results into one feed and EVERY degradation token that
 * applies. Rows are always kept: a chain that failed contributes none, but it
 * never removes another chain's, and the token names the chain that failed so
 * the banner cannot claim the whole list is short when only half of it is.
 *
 * The defect this closes: a severity ranking used to collapse the list to its
 * worst entry, so an unreachable Igra hid a truncated Kasplex and the user was
 * never told the half they could see was also short. The conditions are
 * independent — one chain down, another clipped, a third with an unconfirmed
 * leg — so they are reported independently. Ordering is stable, worst first.
 */
export function mergeSwapHistories(results: SwapHistoryResult[]): {
  swaps: SwapHistoryRecord[];
  degraded: SwapHistoryDegradation[];
} {
  const swaps = results.flatMap((r) => r.swaps);
  const degraded: SwapHistoryDegradation[] = [];

  const unreachable = results.filter((r) => r.health === "unreachable");
  if (results.length > 0 && unreachable.length === results.length) {
    // Nothing was read anywhere, so no chain can also be truncated or
    // unresolved: the whole-feature token is the complete story.
    degraded.push("swap_history_unavailable");
  } else {
    for (const r of unreachable) {
      degraded.push(
        r.chainId === igraMainnet.id
          ? "swap_history_igra_unavailable"
          : "swap_history_kasplex_unavailable",
      );
    }
  }
  if (results.some((r) => r.health === "truncated")) {
    degraded.push("swap_history_partial");
  }
  if (results.some((r) => r.health === "legs_unresolved")) {
    degraded.push("swap_history_legs_unresolved");
  }
  return { swaps, degraded };
}

/** Chains whose swap history the feed reads, in feed order. */
const HISTORY_CHAINS = [igraMainnet, kasplexMainnet];

/**
 * Feed entry point: swap history for the user's EVM address on both mainnet
 * L2s, merged. One address, two chains — the same EVM key signs on both, so a
 * swap made on either belongs in this wallet's history.
 */
export async function fetchAllSwapHistory(address: string): Promise<{
  swaps: SwapHistoryRecord[];
  degraded: SwapHistoryDegradation[];
}> {
  return mergeSwapHistories(
    await Promise.all(
      HISTORY_CHAINS.map((chain) =>
        fetchSwapHistory({
          address,
          apiUrl: chain.apiUrl,
          chainId: chain.id,
          nativeSymbol: chain.nativeCurrency.symbol,
          rpcUrl: chain.rpcUrls.default.http[0],
        }),
      ),
    ),
  );
}
