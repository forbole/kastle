import type { ZKasBatchInventory, ZKasBatchSendStatus } from "./batch-client";
import type { ZKasBatchRecord } from "./batch-journal";
import type { ZKasSelection } from "./selection";

const hex32 = /^[0-9a-f]{64}$/;
const hexBytes = /^(?:[0-9a-f]{2})+$/;

// This checker has no wallet authority. Its caller must supply privately
// validated local records, two complete credentialed walks, and fresh exact-ID
// status responses within one future shared-gate operation. It cannot prove
// fetch freshness, original verifyFinalized provenance, context fencing, or
// first-use enrollment, and must never be used alone to relax reserve().
export type FreshSettledEvidenceInput = {
  selection: ZKasSelection;
  account: string;
  genesis: string;
  daemonIdentity: string;
  records: readonly ZKasBatchRecord[];
  before: ZKasBatchInventory;
  statuses: readonly ZKasBatchSendStatus[];
  after: ZKasBatchInventory;
};

type RecordSnapshot = {
  logicalId: string;
  txid: string;
  sha256: string;
  transactionHex: string;
  ticketValue: string;
  ticketSha256: string;
};

function selectionKey(value: ZKasSelection): string {
  if (
    !value ||
    typeof value.walletId !== "string" ||
    !value.walletId ||
    !Number.isSafeInteger(value.accountIndex) ||
    value.accountIndex < 0 ||
    value.network !== "mainnet"
  ) {
    throw new Error("Invalid selected batch account");
  }
  return JSON.stringify([value.walletId, value.accountIndex, value.network]);
}

function snapshotInventory(value: ZKasBatchInventory) {
  if (
    !value ||
    value.inventoryOnly !== true ||
    !hex32.test(value.epoch) ||
    value.unlistedReservationCount !== 0 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 128
  ) {
    throw new Error("Incomplete batch inventory or unlisted reservation");
  }
  return value.entries.map((entry) => ({
    logicalId: entry.logicalId,
    txid: entry.txid,
    sha256: entry.sha256,
  }));
}

function compareInventory(
  entries: ReturnType<typeof snapshotInventory>,
  locals: Map<string, RecordSnapshot>,
): void {
  if (entries.length !== locals.size)
    throw new Error("Batch inventory differs from private records");
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!hex32.test(entry.logicalId) || seen.has(entry.logicalId))
      throw new Error("Batch inventory contains invalid or repeated identity");
    seen.add(entry.logicalId);
    const local = locals.get(entry.logicalId);
    if (
      !local ||
      !hex32.test(entry.txid) ||
      !hex32.test(entry.sha256) ||
      entry.txid !== local.txid ||
      entry.sha256 !== local.sha256
    ) {
      throw new Error("Batch inventory changed signed transaction identity");
    }
  }
}

async function sha256Bytes(hex: string): Promise<string> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256Text(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Structural observation only: success does not admit a new payment. */
export async function assertFreshSettledBatchEvidence(
  input: FreshSettledEvidenceInput,
): Promise<void> {
  // Capture every field needed later before the first await. Caller-owned
  // objects may be mutated while WebCrypto hashes full signed bytes.
  const selected = selectionKey(input.selection);
  const { account, genesis, daemonIdentity } = input;
  if (
    typeof account !== "string" ||
    !/^zkas:[a-z0-9]{1,115}$/.test(account) ||
    !hex32.test(genesis) ||
    typeof daemonIdentity !== "string" ||
    !daemonIdentity
  ) {
    throw new Error("Invalid batch evidence scope");
  }
  if (
    !Array.isArray(input.records) ||
    input.records.length === 0 ||
    input.records.length > 128
  )
    throw new Error(
      "Private batch history requires separate enrollment or retention",
    );
  const records: RecordSnapshot[] = input.records.map((record) => {
    const intent = record?.intent;
    const ticket = record?.signedTicket;
    if (
      !intent ||
      selectionKey(intent.selection) !== selected ||
      intent.account !== account ||
      intent.genesis !== genesis ||
      !hex32.test(intent.logicalId) ||
      record.status === "preparing" ||
      !ticket ||
      ticket.daemonIdentity !== daemonIdentity ||
      !ticket.value ||
      ticket.value.length > 640 * 1024 ||
      !hex32.test(ticket.sha256) ||
      !record.transactionHex ||
      record.transactionHex.length > 1_000_000 ||
      !hexBytes.test(record.transactionHex) ||
      !hex32.test(record.txid ?? "") ||
      !hex32.test(record.sha256 ?? "")
    ) {
      throw new Error("Private batch record lacks original signed evidence");
    }
    return {
      logicalId: intent.logicalId,
      txid: record.txid!,
      sha256: record.sha256!,
      transactionHex: record.transactionHex,
      ticketValue: ticket.value,
      ticketSha256: ticket.sha256,
    };
  });
  const before = snapshotInventory(input.before);
  const after = snapshotInventory(input.after);
  if (
    !Array.isArray(input.statuses) ||
    input.statuses.length !== records.length
  )
    throw new Error("Missing fresh settled status for batch history");
  const statuses = input.statuses.map((status) => ({
    status: status.status,
    logicalId: status.logicalId,
    txid: status.txid,
    sha256: status.sha256,
  }));

  const locals = new Map<string, RecordSnapshot>();
  for (const record of records) {
    if (locals.has(record.logicalId))
      throw new Error("Repeated private batch logical identity");
    locals.set(record.logicalId, record);
  }
  compareInventory(before, locals);
  compareInventory(after, locals);
  const seenStatuses = new Set<string>();
  for (const status of statuses) {
    const local = locals.get(status.logicalId);
    if (
      status.status !== "settled" ||
      !local ||
      seenStatuses.has(status.logicalId) ||
      status.txid !== local.txid ||
      status.sha256 !== local.sha256
    ) {
      throw new Error(
        "Every batch record needs fresh settled status and exact signed identity",
      );
    }
    seenStatuses.add(status.logicalId);
  }
  for (const record of records) {
    if (
      (await sha256Bytes(record.transactionHex)) !== record.sha256 ||
      (await sha256Text(record.ticketValue)) !== record.ticketSha256
    ) {
      throw new Error("Private signed batch bytes changed");
    }
  }
}
