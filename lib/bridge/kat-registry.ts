// KAT bridge REST registry (api.katbridge.com).
// Docs: kaspakat.gitbook.io/kat-bridge/developer-integration.
//
// /kurve-bridge is a SELF-REPORTED registry for Kurve (Kaspa ↔ Kasplex) txs:
// only POSTed txs appear, so every broadcast also appends a local backup
// record (kurve-local-history.ts) — a failed POST must never silently drop a
// feed row. Ported from kastle-mobile lib/bridge/kat-registry.ts minus the
// Igra exit-status probe (the extension keeps no local exit log to probe).

export const KAT_BRIDGE_API = "https://api.katbridge.com";

const TIMEOUT_MS = 10_000;

/** POST /kurve-bridge body. Server validates with a strict whitelist — any unknown field is a 400, so this shape must match the docs exactly. */
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

/** Local backup record (persistence lives in kurve-local-history.ts). */
export interface LocalKurveRecord extends KurveBridgePostBody {
  /** Broadcast time, ms. */
  timestamp: number;
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

/** POST /kurve-bridge — idempotent by originTxHash. True = accepted. */
export async function postKurveBridgeRecord(
  body: KurveBridgePostBody,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${KAT_BRIDGE_API}/kurve-bridge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
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

/** Shown when a wallet's registry rows ran past REGISTRY_MAX_PAGES. */
export type KurveRegistryDegradation = "kurve_registry_partial";

const REGISTRY_PAGE_SIZE = 100; // endpoint maximum; 101 is a 400
// Cost ceiling, same as kat-bridge-history's MAX_PAGES: re-paid every poll.
const REGISTRY_MAX_PAGES = 4;

/**
 * Rows for a wallet (matches sender OR recipient), paged until the registry's
 * own `hasMore` says no. null = registry unreachable. `truncated` = the page
 * cap ran out with rows left on the server, so older records are missing.
 */
export async function fetchKurveRegistry(
  wallet: string,
): Promise<{ rows: KurveRegistryRecord[]; truncated: boolean } | null> {
  const rows: KurveRegistryRecord[] = [];
  for (let page = 0; page < REGISTRY_MAX_PAGES; page++) {
    const payload = await requestJson(
      `${KAT_BRIDGE_API}/kurve-bridge?wallet=${encodeURIComponent(wallet)}` +
        `&limit=${REGISTRY_PAGE_SIZE}&offset=${page * REGISTRY_PAGE_SIZE}`,
    );
    // A later page failing keeps what was read, but flagged as short.
    if (payload === null) return page === 0 ? null : { rows, truncated: true };
    rows.push(...unwrapRegistryRows(payload).filter(isRegistryRecord));
    const pagination = (
      payload as { data?: { pagination?: { hasMore?: boolean } } }
    )?.data?.pagination;
    if (!pagination?.hasMore) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

// ─── merged history (registry status wins; local rows survive alone) ────────

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
  /**
   * KAS the destination actually paid out, sompi — the L1 payout (exits) or
   * the Kasplex credit (deposits) that `applyKurveCompletions` matched. Absent
   * when no settlement was observed; the mapper then shows no received leg.
   */
  observedPayoutSompi?: number;
}

export function mergeKurveHistory(
  local: LocalKurveRecord[],
  remote: KurveRegistryRecord[],
): KurveBridgeActivity[] {
  const byHash = new Map<string, KurveRegistryRecord>();
  for (const r of remote) byHash.set(r.originTxHash, r);

  const rows: KurveBridgeActivity[] = [];
  const seen = new Set<string>();

  for (const l of local) {
    const r = byHash.get(l.originTxHash);
    seen.add(l.originTxHash);
    rows.push({
      originTxHash: l.originTxHash,
      direction: l.direction,
      amount: l.amount,
      tokenSymbol: l.tokenSymbol,
      status: r?.status ?? "PENDING",
      destTxHash: r?.destTxHash ?? null,
      timestampMs: l.timestamp,
    });
  }

  // Registry-only rows (posted by another device or KAT's own UI). The same
  // record can arrive twice — the feed queries by kaspa AND evm wallet and
  // the registry matches sender OR recipient — so mark each hash as seen.
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
