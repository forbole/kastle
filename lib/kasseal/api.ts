import type { KassealNetwork, SubmitState } from "@kassealhq/sdk";
import { KASSEAL_API_URLS, NetworkType } from "@/contexts/SettingsContext.tsx";

export function kassealBaseUrl(network: KassealNetwork): string {
  return KASSEAL_API_URLS[network as NetworkType];
}

export function kassealNetworkOf(
  networkId: string | undefined,
): KassealNetwork | undefined {
  return networkId === NetworkType.Mainnet ||
    networkId === NetworkType.TestnetT10
    ? networkId
    : undefined;
}

export class KassealApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(detail ?? `Kasseal API ${path} answered ${status}`);
    this.name = "KassealApiError";
  }
}

export type KassealPhase = "bonding" | "graduated" | "listed" | "unknown";

export interface KassealCurve {
  lotsSold: number;
  curveLots: number;
  /** Token base units per lot. */
  lotSize: bigint;
  nextLotPrice: bigint;
  raisedSompi: bigint;
  targetSompi: bigint;
}

export interface KassealToken {
  covenantId: string;
  name: string;
  ticker: string;
  decimals: number;
  imageUrl?: string;
  description?: string;
  totalSupply: bigint;
  holders: number;
  phase: KassealPhase;
  verification: "verified" | "unvalidated" | "invalid";
  curve?: KassealCurve;
  marketCapSompi?: bigint;
}

type Wire = Record<string, unknown>;

// Every large integer is a decimal string on the wire.
const big = (v: unknown): bigint => BigInt((v as string | number) ?? 0);
const optBig = (v: unknown): bigint | undefined =>
  v === undefined || v === null ? undefined : big(v);

export function parseToken(j: Wire): KassealToken {
  const meta = (j.meta ?? {}) as Wire;
  const supply = (j.supply ?? {}) as Wire;
  const curve = j.curve as Wire | undefined;
  return {
    covenantId: String(meta.covenantId),
    name: String(meta.name ?? ""),
    ticker: String(meta.ticker ?? ""),
    decimals: Number(meta.decimals ?? 0),
    imageUrl: (meta.imageUrl as string | undefined) ?? undefined,
    description: (meta.description as string | undefined) ?? undefined,
    totalSupply: big(supply.total),
    holders: Number(supply.holders ?? 0),
    phase: (j.phase as KassealPhase) ?? "unknown",
    verification:
      (j.verification as KassealToken["verification"]) ?? "unvalidated",
    curve: curve && {
      lotsSold: Number(curve.lotsSold),
      curveLots: Number(curve.curveLots),
      lotSize: big(curve.lotSize),
      nextLotPrice: big(curve.nextLotPrice),
      raisedSompi: big(curve.raisedSompi),
      targetSompi: big(curve.targetSompi),
    },
    marketCapSompi: optBig(j.marketCapSompi),
  };
}

async function request(
  baseUrl: string,
  path: string,
  init?: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const res = await fetchImpl(`${baseUrl}${path}`, init);
  if (!res.ok && res.status !== 409) {
    // RFC 9457 problem body when the API classified the failure.
    const problem = (await res.json().catch(() => undefined)) as
      | Wire
      | undefined;
    throw new KassealApiError(
      path,
      res.status,
      problem?.detail as string | undefined,
    );
  }
  return res;
}

export async function fetchKassealTokens(
  baseUrl: string,
  query: { sort?: string; search?: string; limit?: number } = {},
): Promise<KassealToken[]> {
  const params = new URLSearchParams();
  params.set("sort", query.sort ?? "active");
  params.set("limit", String(query.limit ?? 50));
  if (query.search) params.set("search", query.search);
  const res = await request(baseUrl, `/tokens?${params}`);
  const page = (await res.json()) as { tokens?: Wire[] };
  return (page.tokens ?? []).map(parseToken);
}

export async function fetchKassealToken(
  baseUrl: string,
  covenantId: string,
): Promise<KassealToken> {
  const res = await request(
    baseUrl,
    `/tokens/${encodeURIComponent(covenantId)}`,
  );
  return parseToken((await res.json()) as Wire);
}

/** Raw bundle: only `verifyLaunchProofJson` may judge it. */
export async function fetchLaunchProof(
  baseUrl: string,
  covenantId: string,
): Promise<unknown> {
  const res = await request(
    baseUrl,
    `/tokens/${encodeURIComponent(covenantId)}/launch-proof`,
  );
  return res.json();
}

/** Server quote: display cross-check only, never a build input. */
export async function fetchServerQuote(
  baseUrl: string,
  covenantId: string,
  side: "buy" | "sell",
  lots: bigint,
): Promise<{ totalSompi: bigint; feeSompi: bigint }> {
  const res = await request(
    baseUrl,
    `/tokens/${encodeURIComponent(covenantId)}/quote?side=${side}&lots=${lots}`,
  );
  const q = (await res.json()) as Wire;
  return { totalSompi: big(q.totalSompi), feeSompi: big(q.feeSompi) };
}

export async function fetchFeerate(baseUrl: string): Promise<bigint> {
  const res = await request(baseUrl, "/fees");
  const j = (await res.json()) as Wire;
  return BigInt(String(j.feerateSompiPerGram).split(".")[0]);
}

/** A `/tx` status: the submission machine's own state shape, or not seen. */
export type KassealTxStatus = SubmitState | { kind: "dropped" | "unknown" };

export async function fetchTxStatus(
  baseUrl: string,
  txid: string,
  fetchImpl?: typeof fetch,
): Promise<KassealTxStatus> {
  try {
    const res = await request(
      baseUrl,
      `/tx/${encodeURIComponent(txid)}`,
      undefined,
      fetchImpl,
    );
    return { txid, ...((await res.json()) as Wire) } as KassealTxStatus;
  } catch (e) {
    if (e instanceof KassealApiError && e.status === 404)
      return { kind: "unknown" };
    throw e;
  }
}

/** 200 = in mempool; 409 = refused with a classified body. */
export async function postTx(
  baseUrl: string,
  txid: string,
  txJson: string,
  fetchImpl?: typeof fetch,
): Promise<SubmitState> {
  const res = await request(
    baseUrl,
    "/tx",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txJson }),
    },
    fetchImpl,
  );
  if (res.status === 409) {
    return { txid, ...((await res.json()) as Wire) } as SubmitState;
  }
  return { kind: "submitted", txid, at: Date.now() };
}
