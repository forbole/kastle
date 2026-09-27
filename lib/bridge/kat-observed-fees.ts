// KAT bridge fees, read from chain.
//
// /bridge-history carries no fee field of any kind. Live row keys, both test
// wallets, 2026-08-27: amount, completedAt, createdAt, direction, fromChainId,
// fromWallet, id, l1TxId, l2TxHash, status, toChainId, toWallet, tokenContract,
// tokenTick. It does carry the txids, so the fees are recoverable from chain
// and nowhere else.
//
// Deriving them as a leg delta — how every earlier bridge fee on this feed was
// fixed — cannot work for KRC-20: the fees are paid in KAS, the bridged asset
// is the token, and the feed reports ONE token figure per row that the mapper
// puts on both legs — so the delta is a number minus itself. (On the Igra
// deposits there is not even a second leg to subtract: they are COMPLETED with
// l2TxHash: null.) That is why the rows render no fees today.
//
// DEPOSIT (L1 → L2) is a commit/reveal pair on Kaspa L1, built by
// hooks/bridge/useKatKasToEvmBridge.ts:
//   commit → output to KAT_FEE_ADDRESS     = the bridge fee
//          → P2SH output, spent by the reveal
//   reveal → output to KASTLE_FEE_ADDRESS  = our own cut
//          → inscription: KRC-20 transfer to KAT's vault
// KAT's l1TxId is the REVEAL, so the commit is one hop back, reached through
// the reveal's P2SH input.
//
// EXIT (L2 → L1) shares none of that structure — see readExitBridgeFeeWei.
//
// Nothing here is ever computed from a rate. Across the 11 mainnet KRC-20
// deposits of the two test wallets the Kastle cut was 0 on six (they predate
// the fee) and, on the three that bridged an identical 10,000 NACHO, it was
// 0.22235 / 0.225875 / 0.22766 KAS — three different figures for the same
// token amount. Whatever the schedule was on each date, no rate applied to
// `amount` reproduces all three; only the chain does.

import { NetworkType } from "@/contexts/SettingsContext";
import { KASPA_REST_APIS, KASTLE_FEE_ADDRESS } from "@/lib/activity/externals";
import { KAT_FEE_ADDRESS } from "@/lib/activity/externals";
import { MAINNET_SUPPORTED_EVM_L2_CHAINS } from "@/lib/layer2";
import { requestJson } from "@/lib/bridge/kat-registry";
import type { KatBridgeTx } from "@/lib/bridge/kat-bridge-history";
import type { KurveBridgeActivity } from "@/lib/bridge/kat-registry";

/**
 * Fees observed on chain for one KAT row. A field is present only when it was
 * READ; absent means "not derivable", which the mapper renders as a dash.
 *
 * An observed 0 is a real value, not an absence: six of the surveyed deposits
 * carry no Kastle output because they predate the fee, and "0 KAS" is the
 * truthful thing to show them.
 */
export interface KatObservedFees {
  /** Commit-tx output to KAT_FEE_ADDRESS, sompi. Deposits only. */
  bridgeFeeSompi?: number;
  /** Reveal-tx output to KASTLE_FEE_ADDRESS, sompi. Deposits only. */
  kastleFeeSompi?: number;
  /**
   * msg.value of the L2 burn transaction, wei, decimal string. Exits only.
   * Denominated in the SOURCE chain's native token — KAS on Kasplex, iKAS on
   * Igra — never in the bridged token, so whatever renders it must carry that
   * chain's symbol rather than a fixed one.
   */
  exitBridgeFeeWei?: string;
}

/** Kaspa bech32 prefix for pay-to-script-hash — the commit output's shape. */
const P2SH_ADDRESS_PREFIX = "kaspa:p";

/**
 * Is this row the native KAS ↔ iKAS lane rather than a token lane?
 *
 * It decides whether msg.value on an exit may be read as a fee, and getting it
 * wrong prints a wrong number: on the native lane msg.value carries the
 * PRINCIPAL as well as the fee — the four native exits on record sent 50 iKAS
 * for a 40 KAS exit and 11 for a 1 KAS exit — so reading it as a fee would
 * report an 11 KAS fee on a 1 KAS withdrawal. On a token lane the principal
 * moves as an ERC-20 transfer and msg.value is the fee alone.
 *
 * The test is the tick, not tokenContract: the contract does not separate the
 * lanes at all. Of the rows surveyed (2026-08-27) the NACHO deposits to Igra
 * carry the ZERO address while native KAS carries a real one, so a
 * zero-address check would have inverted this exactly where it matters. KAT
 * reporting native KAS as tick "KAS" is the same assumption legSymbol in
 * lib/activity/mappers.ts already runs on.
 */
function isNativeLaneRow(tx: KatBridgeTx): boolean {
  return typeof tx.tokenTick === "string" && tx.tokenTick.toUpperCase() === "KAS";
}

// How many rows one refresh will read from chain, newest first.
//
// A deposit costs two L1 fetches and an exit one L2 RPC call, so an unbounded
// pass over a full history is the expensive shape here. The busiest test wallet
// holds 14 KAT rows and kat-bridge-history's own ceiling is 400, so 50 covers
// every real wallet seen while capping the worst case at ~100 requests.
//
// ponytail: rows past the cap keep their fees absent and render a dash rather
// than a wrong number; the console line below says how many. Raise the cap or
// page it if a wallet ever trips it in the wild.
const MAX_OBSERVED_ROWS = 50;

/**
 * Successful reads only, keyed by txid.
 *
 * The feed polls every 10s and these transactions are immutable once they
 * exist, so a hit never goes stale. Failures are deliberately NOT cached: a
 * transient L1 timeout would otherwise dash a row's fees for the lifetime of
 * the process.
 */
const observedByTx = new Map<string, KatObservedFees>();

/** Test seam — a fresh process starts empty, so only tests need this. */
export function clearKatObservedFeeCache(): void {
  observedByTx.clear();
  kurveKastleFeeByTx.clear();
}

interface KaspaTxOutput {
  amount?: number;
  script_public_key_address?: string;
}

interface KaspaTxInput {
  previous_outpoint_hash?: string;
  previous_outpoint_address?: string;
}

export interface KaspaTx {
  inputs?: KaspaTxInput[];
  outputs?: KaspaTxOutput[];
}

function isKaspaTx(payload: unknown): payload is KaspaTx {
  return typeof payload === "object" && payload !== null;
}

/**
 * Sompi paid to `address` by this transaction, or null when this transaction
 * cannot answer that.
 *
 * A read zero and an unread zero are different answers, and collapsing them
 * into the same number is what made the Kastle cut print "0 KAS" on rows it had
 * never actually read. The caller renders a read zero as "0 KAS" and an unread
 * one as a dash, so this returns 0 only after examining the outputs. Two things
 * stop it from getting that far:
 *
 *   - No outputs array. Nothing was examined; 0 would be invented rather than
 *     observed. `?? []` used to turn that into a confident zero.
 *   - `address` is also an INPUT. An output back to something that funded the
 *     transaction is change, and change is not separable from a fee here. This
 *     is not hypothetical: KASTLE_FEE_ADDRESS spends its own UTXOs, so it shows
 *     up on both sides — 4d106cd5a3 (2026-08-26) funds a 20 KAS bridge deposit
 *     from it and takes 2163.73 KAS back, d57fbb5970e4 (2026-08-11) sends 20
 *     KAS and takes 37.41 back. Summing its outputs blind reports that change
 *     as a Kastle cut.
 */
export function outputsTo(tx: KaspaTx, address: string): number | null {
  if (!Array.isArray(tx.outputs)) return null;
  const funded = (tx.inputs ?? []).some(
    (i) => i?.previous_outpoint_address === address,
  );
  if (funded) return null;
  return tx.outputs.reduce(
    (sum, o) =>
      o?.script_public_key_address === address && typeof o.amount === "number"
        ? sum + o.amount
        : sum,
    0,
  );
}

export async function fetchKaspaTx(txId: string): Promise<KaspaTx | null> {
  const base = KASPA_REST_APIS[NetworkType.Mainnet];
  const payload = await requestJson(
    `${base}/transactions/${encodeURIComponent(txId)}` +
      `?inputs=true&outputs=true&resolve_previous_outpoints=light`,
  );
  return isKaspaTx(payload) ? payload : null;
}

/**
 * Bridge fee and Kastle cut for one L1 → L2 deposit, both read from L1.
 *
 * Returns null — not a partial result — when either transaction cannot be
 * read or the commit cannot be identified. Half a fee breakdown on a money
 * screen reads as a complete one, and the missing half would look like zero.
 */
export async function readDepositFees(
  l1RevealTxId: string,
): Promise<KatObservedFees | null> {
  const reveal = await fetchKaspaTx(l1RevealTxId);
  if (!reveal) return null;

  // The reveal spends exactly one P2SH outpoint: the commit output carrying the
  // inscription. More than one distinct source means this is not the shape
  // useKatKasToEvmBridge builds, so which one funded the bridge fee is a guess.
  const commitTxIds = new Set(
    (reveal.inputs ?? [])
      .filter((i) =>
        (i?.previous_outpoint_address ?? "").startsWith(P2SH_ADDRESS_PREFIX),
      )
      .map((i) => i.previous_outpoint_hash)
      .filter((h): h is string => typeof h === "string" && h.length > 0),
  );
  if (commitTxIds.size !== 1) return null;

  const commit = await fetchKaspaTx([...commitTxIds][0]);
  if (!commit) return null;

  const bridgeFeeSompi = outputsTo(commit, KAT_FEE_ADDRESS);
  // A commit that pays KAT_FEE_ADDRESS nothing is not a free deposit — all 11
  // surveyed pay exactly 10 KAS — it is a deposit whose fee went somewhere this
  // function does not look (a rotated address, or the reveal). Rendering that
  // as "0 KAS" would state a fee we never read.
  //
  // ponytail: the whole read is discarded, so the Kastle cut dashes too. Split
  // the two if a lane ever legitimately charges no bridge fee.
  if (bridgeFeeSompi === null || bridgeFeeSompi === 0) return null;

  // Surveyed on chain 2026-08-27, both test wallets, all 11 mainnet KRC-20
  // deposits: the six that sum to 0 here (2025-09-29, 2025-12-11, 2026-02-03
  // x2, 2026-02-11, 2026-02-27) pay Kastle nothing anywhere. Every output on
  // both their commit and their reveal goes to the P2SH, to KAT_FEE_ADDRESS or
  // back to the sender — no third-party output at all — so the zero is the
  // whole truth and "0 KAS" is the honest row. The alternatives were checked
  // rather than assumed: KASTLE_FEE_ADDRESS has exactly one mainnet value
  // across the entire history of lib/externals.ts (added 2026-05-27 in d6af19f,
  // never changed), so there is no earlier address to have missed; summing it
  // over the COMMIT instead returns 0 on all 11; and all 11 reveals carry
  // exactly one P2SH input, so none of them reaches this line by accident.
  //
  // What stays unresolvable is structural, not historical, and outputsTo()
  // returns null for it rather than a zero: a reveal whose outputs were never
  // read, and one that KASTLE_FEE_ADDRESS itself funded, where its outputs are
  // change. Both dash. A future rotation of the constant would still read as a
  // real zero here — nothing in the transaction reveals an address the scan was
  // not told about, so only updating externals.ts can fix that.
  const kastleFeeSompi = outputsTo(
    reveal,
    KASTLE_FEE_ADDRESS[NetworkType.Mainnet],
  );

  return {
    bridgeFeeSompi,
    ...(kastleFeeSompi === null ? {} : { kastleFeeSompi }),
  };
}

function rpcUrlFor(chainId: number): string | undefined {
  return MAINNET_SUPPORTED_EVM_L2_CHAINS.find((c) => c.id === chainId)?.rpcUrls
    ?.default?.http?.[0];
}

async function ethCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const payload = await requestJson(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (payload as { result?: unknown } | null)?.result;
}

/**
 * Burn fee for one TOKEN exit (L2 → L1): msg.value of the L2 transaction.
 *
 * Token exits only — see isNativeLaneRow. On a token exit the principal moves
 * as an ERC-20 transfer, so msg.value is nothing but the burn fee: both KRC-20
 * exits on record paid exactly 10 KAS against burns of 16,000 and 1,000 NACHO.
 *
 * Only the burn fee. Kastle's cut on this direction is taken in the TOKEN by
 * the fee collector (hooks/bridge/useKatEvmToKasBridge.ts), so reading it means
 * knowing whether /bridge-history's `amount` is gross or net of it — and that
 * is untestable here: both those exits (0x835f091e5c, 0x6b1193545a, Kasplex)
 * predate the fee collector and went straight to KAT's bridge contract at
 * 0x699e7f4a64…, burning the full amount. Zero rows exercise the collector at
 * 0x642638cF9D…, so the mapper dashes that cut rather than picking a reading.
 */
export async function readExitBridgeFeeWei(
  l2TxHash: string,
  chainId: number,
): Promise<string | null> {
  const rpcUrl = rpcUrlFor(chainId);
  if (!rpcUrl) return null;

  const tx = (await ethCall(rpcUrl, "eth_getTransactionByHash", [
    l2TxHash,
  ])) as { value?: unknown } | null;
  const value = tx?.value;
  if (typeof value !== "string") return null;
  try {
    return BigInt(value).toString();
  } catch {
    // A non-numeric `value` is a malformed result, not a zero-fee exit.
    return null;
  }
}

/**
 * Burn fee for one NATIVE exit (L2 → L1), taken from the bridge's own event.
 *
 * msg.value is NOT the fee on this lane: it is principal plus fee, so reading
 * it the way a token exit is read would print "11 iKAS fee" on a 1 iKAS
 * withdrawal. All four native exits on record (Igra, contract 0xb82c5524…)
 * sent 11 iKAS to deliver 1 KAS, and 50 to deliver 40.
 *
 * The contract states the split itself. Its log carries three words —
 * gross / fee / net — 50/10/40 and 11/10/1 on those four rows. Nothing here
 * trusts that layout blind: the decode is accepted only when the log comes
 * from the address the transaction called, gross equals the msg.value we
 * fetched, and fee + net add back up to gross. A layout that does not hold
 * all three fails the check and the row dashes.
 */
async function readNativeExitFeeWei(
  l2TxHash: string,
  chainId: number,
): Promise<string | null> {
  const rpcUrl = rpcUrlFor(chainId);
  if (!rpcUrl) return null;

  const [tx, receipt] = await Promise.all([
    ethCall(rpcUrl, "eth_getTransactionByHash", [l2TxHash]) as Promise<{
      to?: unknown;
      value?: unknown;
    } | null>,
    ethCall(rpcUrl, "eth_getTransactionReceipt", [l2TxHash]) as Promise<{
      logs?: { address?: unknown; data?: unknown }[];
    } | null>,
  ]);
  const to = tx?.to;
  const value = tx?.value;
  if (typeof to !== "string" || typeof value !== "string") return null;

  let gross: bigint;
  try {
    gross = BigInt(value);
  } catch {
    return null;
  }

  for (const log of receipt?.logs ?? []) {
    if (
      typeof log?.address !== "string" ||
      log.address.toLowerCase() !== to.toLowerCase() ||
      typeof log.data !== "string"
    ) {
      continue;
    }
    const body = log.data.startsWith("0x") ? log.data.slice(2) : log.data;
    if (body.length < 192) continue;
    let words: bigint[];
    try {
      words = [0, 1, 2].map((i) =>
        BigInt(`0x${body.slice(i * 64, i * 64 + 64)}`),
      );
    } catch {
      continue;
    }
    const [logGross, fee, net] = words;
    if (logGross !== gross || fee + net !== gross || fee <= 0n) continue;
    return fee.toString();
  }
  return null;
}

/**
 * Attach observed fees to the newest MAX_OBSERVED_ROWS rows, in place of
 * nothing. Best-effort throughout: a row whose chain read fails keeps its fees
 * absent and renders a dash.
 */
export async function attachKatObservedFees(
  txs: KatBridgeTx[],
): Promise<KatBridgeTx[]> {
  const newestFirst = [...txs].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const observed = newestFirst.slice(0, MAX_OBSERVED_ROWS);
  if (newestFirst.length > observed.length) {
    console.warn(
      `[kat-observed-fees] ${newestFirst.length - observed.length} row(s) past ` +
        `the ${MAX_OBSERVED_ROWS}-row cap keep their fees unobserved`,
    );
  }

  const feesById = new Map<string, KatObservedFees>();
  await Promise.all(
    observed.map(async (tx) => {
      const deposit = tx.direction === "DEPOSIT";
      // Deposits need no lane gate, because readDepositFees turns itself off:
      // a native KAT deposit is ONE transaction with a "KAT"-prefixed payload
      // and no commit/reveal at all (4d106cd5a3, 2026-08-26: 20 KAS to the lane
      // plus a 1 KAS fee output to an address that is not KAT_FEE_ADDRESS), so
      // it has no P2SH input and the reader returns null rather than a zero.
      const hash = deposit ? tx.l1TxId : tx.l2TxHash;
      if (!hash) return;
      const key = `${deposit ? "d" : "x"}:${hash}`;

      const cached = observedByTx.get(key);
      if (cached) {
        feesById.set(tx.id, cached);
        return;
      }

      // The two exit lanes carry the fee in different places: a token exit
      // pays it as msg.value, a native one nets it out and states the split in
      // an event. Same field either way — both are the source chain's native
      // coin, and the mapper labels them with that chain's symbol.
      const fees = deposit
        ? await readDepositFees(hash)
        : await (isNativeLaneRow(tx)
            ? readNativeExitFeeWei(hash, tx.fromChainId)
            : readExitBridgeFeeWei(hash, tx.fromChainId)
          ).then((wei) => (wei === null ? null : { exitBridgeFeeWei: wei }));
      if (!fees) return;
      observedByTx.set(key, fees);
      feesById.set(tx.id, fees);
    }),
  );

  return txs.map((tx) => {
    const fees = feesById.get(tx.id);
    return fees ? { ...tx, observedFees: fees } : tx;
  });
}

/**
 * Successful Kurve reads, keyed by origin txid. Same immutability argument as
 * `observedByTx`; failures are not cached.
 */
const kurveKastleFeeByTx = new Map<string, number>();

/**
 * Attach Kastle's cut to Kurve ENTRY rows by reading the origin L1 tx.
 *
 * The /kurve-bridge registry stores the lane output, which is already net of
 * the cut, so the cut is invisible in this row's own data — but it is a plain
 * output of the same transaction the row already names. Read on 2026-08-27:
 * 60111b29c28d pays 0.3125 KAS to KASTLE_FEE_ADDRESS alongside 14.6875 to the
 * lane, so `amount` is 14.6875 and the gross the user sent is 15.
 *
 * Exits are left alone: their origin tx is on L2, where this address means
 * nothing, so the dash there stays a dash.
 */
export async function attachKurveKastleFees(
  rows: KurveBridgeActivity[],
): Promise<KurveBridgeActivity[]> {
  const newestFirst = [...rows]
    .filter((r) => r.direction === "l1-to-l2")
    .sort((a, b) => b.timestampMs - a.timestampMs);
  const observed = newestFirst.slice(0, MAX_OBSERVED_ROWS);
  if (newestFirst.length > observed.length) {
    console.warn(
      `[kat-observed-fees] ${newestFirst.length - observed.length} Kurve row(s) ` +
        `past the ${MAX_OBSERVED_ROWS}-row cap keep their Kastle cut unobserved`,
    );
  }

  await Promise.all(
    observed.map(async (row) => {
      if (kurveKastleFeeByTx.has(row.originTxHash)) return;
      const tx = await fetchKaspaTx(row.originTxHash);
      if (!tx) return;
      // null = unreadable or co-funded by the fee address (its change would
      // over-count as a cut) — leave the row's dash rather than invent a zero.
      const sompi = outputsTo(tx, KASTLE_FEE_ADDRESS[NetworkType.Mainnet]);
      if (sompi !== null) kurveKastleFeeByTx.set(row.originTxHash, sompi);
    }),
  );

  return rows.map((row) => {
    const sompi = kurveKastleFeeByTx.get(row.originTxHash);
    return sompi === undefined || row.direction !== "l1-to-l2"
      ? row
      : { ...row, kastleFeeSompi: sompi };
  });
}
