import { kasplexMainnet } from "@/lib/layer2";
import { KASPLEX_BRIDGE_CONTRACT, KURVE_ENTRY_ADDRESS } from "@/lib/bridge/bridge";
import {
  fetchVaultPayouts,
  PayoutCandidate,
} from "@/lib/activity/exit-payout";
import type { KurveBridgeActivity } from "@/lib/bridge/kat-registry";

// ─── Kurve (Kaspa ↔ Kasplex) completion detection ────────────────────────────
//
// KAT's /kurve-bridge registry is SELF-REPORTED and its operator does not
// complete third-party-POSTed rows: registry ids 127 (deposit) and 128 (exit)
// were both observed settled on-chain on 2026-08-18 yet stayed PENDING in the
// registry. Left alone, every Kastle-posted row shows "Bridging" forever.
// Completion is therefore observed on-chain, mirroring the Igra exit probe
// (lib/activity/exit-payout.ts):
//  - exits (l2-to-l1): the Kurve L1 hot wallet pays amount × (1 − 0.5%) KAS
//    to the recipient (observed: 12 → 11.94, tx 1c1e66b4…, ~40 s after lock).
//  - deposits (l1-to-l2): the Kasplex bridge contract releases amount − 0.5
//    KAS to the recipient as an internal tx (observed: 11.71 → 11.21,
//    tx 0x13172563…, ~1 min after L1 acceptance).
// Registry statuses still win when present: only PENDING/NOT_FOUND rows are
// upgraded, never FAILED, and an existing destTxHash is kept.

/** Kurve deposit receiver = the hot wallet that also pays exits on L1. */
export const KURVE_L1_HOT_WALLET = KURVE_ENTRY_ADDRESS.mainnet;
/** lockForBridge / releaseTo contract on Kasplex. */
export const KURVE_L2_BRIDGE_CONTRACT = KASPLEX_BRIDGE_CONTRACT.mainnet;

const SOMPI_PER_KAS = 1e8;
/** 18-dec wei → 8-dec sompi. */
const WEI_PER_SOMPI = 10n ** 10n;
/**
 * How much older than the record a settlement may be and still match. Local
 * rows are stamped at broadcast, but registry-only rows carry the POST time
 * (`createdAt`), which trails settlement by however late the POST was —
 * observed 1 h 34 m on registry id 127 (credited 10:55, posted 12:29).
 * ponytail: 2 h window; rows POSTed later than that stay Bridging — fetch the
 * origin tx's chain time instead if that ever bites.
 */
const CLOCK_SKEW_MS = 2 * 60 * 60 * 1000;

// Fee schedule (same numbers the bridge hooks display) plus caps so KAT
// raising fees degrades to "still matches", not "stuck at Bridging" again.
const DEPOSIT_FLAT_FEE_KAS = 0.5;
const DEPOSIT_FEE_CAP_KAS = 2;
const EXIT_FEE_RATE = 0.005;
const EXIT_FEE_RATE_CAP = 0.02;

// ─── Kasplex L2 credits (deposits) ───────────────────────────────────────────

/** Blockscout /api/v2 internal-transactions item (fields we consume). */
interface KasplexInternalTx {
  transaction_hash?: string;
  from?: { hash?: string };
  to?: { hash?: string };
  value?: string;
  timestamp?: string;
}

/** Pure parse: bridge-contract → recipient native credits, as candidates. */
export function parseKasplexBridgeCredits(
  payload: unknown,
  recipient: string,
): PayoutCandidate[] {
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const bridge = KURVE_L2_BRIDGE_CONTRACT.toLowerCase();
  const to = recipient.toLowerCase();
  const out: PayoutCandidate[] = [];
  for (const raw of items as KasplexInternalTx[]) {
    if (raw?.from?.hash?.toLowerCase() !== bridge) continue;
    if (raw?.to?.hash?.toLowerCase() !== to) continue;
    if (typeof raw.transaction_hash !== "string") continue;
    let amountSompi: number;
    try {
      amountSompi = Number(BigInt(raw.value ?? "0") / WEI_PER_SOMPI);
    } catch {
      continue;
    }
    if (amountSompi <= 0) continue;
    const timeMs = raw.timestamp ? Date.parse(raw.timestamp) : NaN;
    out.push({
      txHash: raw.transaction_hash,
      amountSompi,
      timeMs: Number.isFinite(timeMs) ? timeMs : 0,
    });
  }
  return out;
}

/**
 * Native KAS the bridge contract released to `recipient` on Kasplex.
 * Throws on HTTP/network failure — callers degrade to "no completion info".
 */
export async function fetchKasplexBridgeCredits(
  recipient: string,
): Promise<PayoutCandidate[]> {
  const url = `${kasplexMainnet.apiUrl}/api/v2/addresses/${recipient}/internal-transactions`;
  // Bounded like every other activity source (mobile left this one open): an
  // unsettled fetch would keep the Activity refresh spinner going forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`kasplex explorer ${res.status}`);
  return parseKasplexBridgeCredits(await res.json(), recipient);
}

// ─── matching ────────────────────────────────────────────────────────────────

/**
 * Earliest unclaimed candidate newer than the record (minus clock skew) with
 * amount in [minSompi, 100.1% of expected]. FIFO like matchExitPayout: call
 * oldest-record-first with a shared `claimed` set per candidate list.
 */
export function matchKurveCompletion(
  expectedSompi: number,
  minSompi: number,
  timestampMs: number,
  candidates: PayoutCandidate[],
  claimed: Set<string>,
): PayoutCandidate | null {
  if (!Number.isFinite(expectedSompi) || expectedSompi <= 0) return null;
  let best: PayoutCandidate | null = null;
  for (const c of candidates) {
    if (claimed.has(c.txHash)) continue;
    if (c.timeMs < timestampMs - CLOCK_SKEW_MS) continue;
    if (c.amountSompi < minSompi || c.amountSompi > expectedSompi * 1.001)
      continue;
    if (!best || c.timeMs < best.timeMs) best = c;
  }
  if (best) claimed.add(best.txHash);
  return best;
}

/** [expected, min] payout window in sompi for one row, by direction. */
export function kurveExpectedSompi(
  row: Pick<KurveBridgeActivity, "direction" | "amount">,
): { expected: number; min: number } | null {
  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (row.direction === "l1-to-l2") {
    const expected = (amount - DEPOSIT_FLAT_FEE_KAS) * SOMPI_PER_KAS;
    const min = Math.max(0, (amount - DEPOSIT_FEE_CAP_KAS) * SOMPI_PER_KAS);
    return expected > 0 ? { expected, min } : null;
  }
  return {
    expected: amount * (1 - EXIT_FEE_RATE) * SOMPI_PER_KAS,
    min: amount * (1 - EXIT_FEE_RATE_CAP) * SOMPI_PER_KAS,
  };
}

// ─── feed integration ────────────────────────────────────────────────────────

export interface KurveWallets {
  /** L1 recipient of exits (the user's own kaspa address). */
  kaspaAddress: string | null;
  /** L2 recipient of deposits (the user's own evm address). */
  evmAddress: string | null;
}

const upgradeable = (row: KurveBridgeActivity) =>
  row.status === "PENDING" || row.status === "NOT_FOUND";

/**
 * Upgrade PENDING Kurve rows whose settlement is visible on-chain. Candidate
 * lists are fetched at most once per side and only when a pending row of that
 * direction exists. Best-effort: a failed fetch leaves that side's rows as-is.
 */
export async function applyKurveCompletions(
  rows: KurveBridgeActivity[],
  wallets: KurveWallets,
  fetchers = {
    l1Payouts: (addr: string) => fetchVaultPayouts(addr, KURVE_L1_HOT_WALLET),
    l2Credits: fetchKasplexBridgeCredits,
  },
): Promise<KurveBridgeActivity[]> {
  const wantExits =
    wallets.kaspaAddress &&
    rows.some((r) => r.direction === "l2-to-l1" && upgradeable(r));
  const wantDeposits =
    wallets.evmAddress &&
    rows.some((r) => r.direction === "l1-to-l2" && upgradeable(r));
  if (!wantExits && !wantDeposits) return rows;

  const [payouts, credits] = await Promise.all([
    wantExits
      ? fetchers.l1Payouts(wallets.kaspaAddress as string).catch(() => null)
      : null,
    wantDeposits
      ? fetchers.l2Credits(wallets.evmAddress as string).catch(() => null)
      : null,
  ]);

  const claimedPayouts = new Set<string>();
  const claimedCredits = new Set<string>();
  const matched = new Map<string, PayoutCandidate>();
  for (const row of [...rows].sort((a, b) => a.timestampMs - b.timestampMs)) {
    if (!upgradeable(row)) continue;
    const deposit = row.direction === "l1-to-l2";
    const candidates = deposit ? credits : payouts;
    if (!candidates) continue;
    const window = kurveExpectedSompi(row);
    if (!window) continue;
    const match = matchKurveCompletion(
      window.expected,
      window.min,
      row.timestampMs,
      candidates,
      deposit ? claimedCredits : claimedPayouts,
    );
    if (match) matched.set(row.originTxHash, match);
  }

  return rows.map((row) => {
    const match = matched.get(row.originTxHash);
    if (!match) return row;
    return {
      ...row,
      status: "COMPLETED" as const,
      destTxHash: row.destTxHash ?? match.txHash,
    };
  });
}
