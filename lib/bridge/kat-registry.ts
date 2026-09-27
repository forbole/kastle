// KAT bridge REST registry (api.katbridge.com), read side only.
// Docs: kaspakat.gitbook.io/kat-bridge/developer-integration.
//
// /kurve-bridge is a SELF-REPORTED registry for Kurve (Kaspa ↔ Kasplex) txs:
// only POSTed txs appear. Ported from kastle-mobile lib/bridge/kat-registry.ts
// minus the POST, the local backup record and the Igra exit-status probe —
// the extension's bridge flow writes none of those, so nothing read them here.

export const KAT_BRIDGE_API = "https://api.katbridge.com";

const TIMEOUT_MS = 10_000;

/** Kurve registry row fields (the POST /kurve-bridge body shape). */
export interface KurveBridgePostBody {
  mechanism: "kas-kurve" | "kurve-stablecoin";
  direction: "l1-to-l2" | "l2-to-l1";
  /** 0 = Kaspa L1, 202555 = Kasplex (KAT chain-id table). */
  originChainId: number;
  destChainId: number;
  /** Idempotency key — POST is safe to retry. */
  originTxHash: string;
  sender: string;
  recipient: string;
  tokenSymbol: string;
  /** null for native KAS. */
  tokenAddress: string | null;
  /** Decimal display units — "not raw wei or sompi" per docs. */
  amount: string;
}

export type KurveRegistryStatus =
  | "PENDING"
  | "COMPLETED"
  | "FAILED"
  | "NOT_FOUND";

/** Row returned by GET /kurve-bridge?wallet= (fields we consume; API is additive-only). */
export interface KurveRegistryRecord extends Partial<KurveBridgePostBody> {
  originTxHash: string;
  status?: KurveRegistryStatus;
  destTxHash?: string | null;
  createdAt?: string;
}

// ─── HTTP (best-effort: null on any failure, never throws) ──────────────────

export async function requestJson(
  url: string,
  init?: RequestInit,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── GET /kurve-bridge (wallet history) ─────────────────────────────────────

/** Envelope unwrap: bare array, {data: [...]}, or {data: {transactions: [...]}}. */
export function unwrapRegistryRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const data = (payload as { data?: unknown })?.data;
  if (Array.isArray(data)) return data;
  const txs = (data as { transactions?: unknown })?.transactions;
  return Array.isArray(txs) ? txs : [];
}

function isRegistryRecord(row: unknown): row is KurveRegistryRecord {
  return (
    typeof row === "object" &&
    row !== null &&
    typeof (row as KurveRegistryRecord).originTxHash === "string"
  );
}

/** Rows for a wallet (matches sender OR recipient). null = registry unreachable. */
export async function fetchKurveRegistry(
  wallet: string,
): Promise<KurveRegistryRecord[] | null> {
  const payload = await requestJson(
    `${KAT_BRIDGE_API}/kurve-bridge?wallet=${encodeURIComponent(wallet)}&limit=50&offset=0`,
  );
  if (payload === null) return null;
  return unwrapRegistryRows(payload).filter(isRegistryRecord);
}

// ─── merged history (deduped across the two wallet queries) ─────────────────

/** One Kurve bridge tx, ready for the activity mapper. */
export interface KurveBridgeActivity {
  originTxHash: string;
  direction: "l1-to-l2" | "l2-to-l1";
  /** Decimal display units (amount sent into the bridge). */
  amount: string;
  tokenSymbol: string;
  status: KurveRegistryStatus;
  destTxHash: string | null;
  timestampMs: number;
  /**
   * Kastle's cut, sompi, read from the origin L1 tx by
   * `attachKurveKastleFees`. Entries only, and absent when the read failed —
   * absent means "not observed", never zero.
   */
  kastleFeeSompi?: number;
}

export function mergeKurveHistory(
  remote: KurveRegistryRecord[],
): KurveBridgeActivity[] {
  const rows: KurveBridgeActivity[] = [];
  const seen = new Set<string>();

  // The same record can arrive twice — the feed queries by kaspa AND evm
  // wallet and the registry matches sender OR recipient — so mark each hash
  // as seen.
  for (const r of remote) {
    if (seen.has(r.originTxHash)) continue;
    seen.add(r.originTxHash);
    if (r.direction !== "l1-to-l2" && r.direction !== "l2-to-l1") continue;
    if (typeof r.amount !== "string") continue;
    const parsed = r.createdAt ? Date.parse(r.createdAt) : NaN;
    rows.push({
      originTxHash: r.originTxHash,
      direction: r.direction,
      amount: r.amount,
      tokenSymbol: r.tokenSymbol ?? "KAS",
      status: r.status ?? "PENDING",
      destTxHash: r.destTxHash ?? null,
      timestampMs: Number.isFinite(parsed) ? parsed : 0,
    });
  }

  return rows;
}
