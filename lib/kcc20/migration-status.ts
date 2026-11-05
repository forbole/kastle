// Status of one KRC-20 → KCC-20 migration, read from the Kat Bridge status API
// by the deposit's reveal txid. Ported from kastle-mobile. The parse is
// deliberately one-way: only a confirmed payout with a well-formed txid is ever
// `completed`, only an explicit "failed" is ever `failed`. Anything the service
// says that we do not recognise stays pending.
//
// The popup closes when the migration tool opens, so the pending migration is
// persisted at CTA time and resolved on the next popup open.

import { KCC20_MIGRATION_STATUS_API } from "@/lib/kcc20/migration";

export type MigrationStatus =
  | { kind: "not_detected" }
  | { kind: "pending"; raw?: string }
  | { kind: "held" }
  | { kind: "completed"; payoutTxId: string }
  | { kind: "failed"; raw: string }
  | { kind: "malformed" };

export type MigrationStatusResult =
  | MigrationStatus
  | { kind: "transport_error"; error: unknown };

const HEX32 = /^[0-9a-f]{64}$/i;
const TIMEOUT_MS = 10_000;

// Mobile stops polling after 30 minutes and never promotes the last answer;
// a pending entry older than this is dropped.
export const MIGRATION_PENDING_TTL_MS = 30 * 60_000;

export const MIGRATION_PENDING_KEY = "kcc20_migration_pending";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseMigrationStatus(
  httpStatus: number,
  body: unknown,
): MigrationStatus {
  if (httpStatus === 404) return { kind: "not_detected" };
  if (httpStatus !== 200) return { kind: "malformed" };
  if (!isRecord(body) || typeof body.status !== "string") {
    return { kind: "malformed" };
  }
  switch (body.status) {
    case "completed": {
      const payout = body.payout;
      if (
        isRecord(payout) &&
        payout.stage === "confirmed" &&
        typeof payout.txId === "string" &&
        HEX32.test(payout.txId)
      ) {
        return { kind: "completed", payoutTxId: payout.txId.toLowerCase() };
      }
      // "completed" without a confirmed payout is not done yet.
      return { kind: "pending", raw: body.status };
    }
    case "held":
      return { kind: "held" };
    case "failed":
      return { kind: "failed", raw: body.status };
    default:
      return { kind: "pending", raw: body.status };
  }
}

export const isTerminalMigrationStatus = (s: MigrationStatusResult) =>
  s.kind === "completed" || s.kind === "failed";

export const isRevealTxId = (id: unknown): id is string =>
  typeof id === "string" && HEX32.test(id);

/** GET {base}/{revealTxId}; a 404 is `not_detected`, never an error. */
export async function fetchMigrationStatus(
  revealTxId: string,
  base: string = KCC20_MIGRATION_STATUS_API,
): Promise<MigrationStatusResult> {
  if (!isRevealTxId(revealTxId)) return { kind: "malformed" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/${revealTxId.toLowerCase()}`, {
      signal: controller.signal,
    });
    // Only a 200 body is read: an error page says nothing about the migration.
    if (res.status !== 200) return parseMigrationStatus(res.status, null);
    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      // A body cut off by the timeout is a transport failure, not a bad body.
      if (controller.signal.aborted) return { kind: "transport_error", error };
      return { kind: "malformed" };
    }
    return parseMigrationStatus(200, body);
  } catch (error) {
    return { kind: "transport_error", error };
  } finally {
    clearTimeout(timeout);
  }
}

// What the popup knows when the user opens the migration tool. The tool does
// not hand the reveal txid back, so `revealTxId` is only ever set if a future
// tool return supplies it; without it the status API cannot be asked.
export type PendingMigration = {
  tick: string;
  address: string;
  network: string;
  openedAt: number;
  revealTxId?: string;
};

export function parsePendingMigration(
  v: unknown,
): PendingMigration | undefined {
  if (!isRecord(v)) return undefined;
  const { tick, address, network, openedAt, revealTxId } = v;
  if (
    typeof tick !== "string" ||
    typeof address !== "string" ||
    typeof network !== "string" ||
    typeof openedAt !== "number" ||
    !Number.isFinite(openedAt)
  ) {
    return undefined;
  }
  return {
    tick,
    address,
    network,
    openedAt,
    ...(isRevealTxId(revealTxId)
      ? { revealTxId: revealTxId.toLowerCase() }
      : {}),
  };
}

export async function readPendingMigration() {
  const stored = await browser.storage.local.get(MIGRATION_PENDING_KEY);
  return parsePendingMigration(stored[MIGRATION_PENDING_KEY]);
}

export async function writePendingMigration(entry: PendingMigration) {
  await browser.storage.local.set({ [MIGRATION_PENDING_KEY]: entry });
}

export async function clearPendingMigration() {
  await browser.storage.local.remove(MIGRATION_PENDING_KEY);
}

// What the dashboard may say. `unconfirmed` is pending with no answer from
// the service (no txid, 404, error): "check on next open", never success.
export type MigrationBannerStatus =
  | { kind: "pending"; tick: string; unconfirmed: boolean }
  | { kind: "failed"; tick: string };

export type ResolvedMigration = {
  // undefined: drop the stored entry.
  entry: PendingMigration | undefined;
  status: MigrationBannerStatus | undefined;
};

/**
 * One resolution of a stored entry on popup open. Expired entries and a
 * confirmed payout clear it; a completed migration shows nothing rather than
 * a success the dashboard cannot stand behind.
 */
export async function resolvePendingMigration(
  entry: PendingMigration,
  now: number,
  fetchStatus: (txId: string) => Promise<MigrationStatusResult> = (txId) =>
    fetchMigrationStatus(txId),
): Promise<ResolvedMigration> {
  if (now - entry.openedAt >= MIGRATION_PENDING_TTL_MS || now < entry.openedAt)
    return { entry: undefined, status: undefined };
  if (!entry.revealTxId)
    return {
      entry,
      status: { kind: "pending", tick: entry.tick, unconfirmed: true },
    };
  const result = await fetchStatus(entry.revealTxId);
  switch (result.kind) {
    case "completed":
      return { entry: undefined, status: undefined };
    case "failed":
      return { entry, status: { kind: "failed", tick: entry.tick } };
    case "pending":
    case "held":
      return {
        entry,
        status: { kind: "pending", tick: entry.tick, unconfirmed: false },
      };
    default:
      return {
        entry,
        status: { kind: "pending", tick: entry.tick, unconfirmed: true },
      };
  }
}
