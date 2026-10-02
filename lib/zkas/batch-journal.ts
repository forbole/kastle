import type { ZKasSelection } from "./selection";
import { withZKasPaymentAccountGate } from "./payment-account-gate";

export const BATCH_JOURNAL_KEY = "zkasBatchJournal" as const;

export type ZKasBatchIntent = {
  selection: ZKasSelection;
  account: string;
  genesis: string;
  origin: string;
  logicalId: string;
  outputs: { recipient: string; amountSompi: string; memoHex: string }[];
  maxFeeSompi: string;
};

export type ZKasSignedBytes = {
  transactionHex: string;
  txid: string;
  sha256: string;
};

export type ZKasBatchRecord = {
  intent: ZKasBatchIntent;
  status:
    | "preparing"
    | "finalized"
    | "unknown"
    | "mempool"
    | "included"
    | "settled"
    | "conflicted";
  transactionHex?: string;
  txid?: string;
  sha256?: string;
};

type PrivateStore = {
  getValue<T>(key: typeof BATCH_JOURNAL_KEY): Promise<T | null>;
  updateValue<T>(
    key: typeof BATCH_JOURNAL_KEY,
    update: (current: T | null) => T | Promise<T>,
  ): Promise<void>;
};

function accountKey(selection: ZKasSelection): string {
  return JSON.stringify([
    selection.walletId,
    selection.accountIndex,
    selection.network,
  ]);
}

function assertHex(value: string, bytes: number): void {
  if (
    typeof value !== "string" ||
    value.length !== bytes * 2 ||
    !/^[0-9a-f]+$/.test(value)
  ) {
    throw new Error("Invalid batch journal identity");
  }
}

function assertIntent(intent: ZKasBatchIntent): void {
  assertHex(intent.genesis, 32);
  assertHex(intent.logicalId, 32);
  if (
    !intent.selection?.walletId ||
    !Number.isSafeInteger(intent.selection.accountIndex) ||
    intent.selection.accountIndex < 0 ||
    intent.selection.network !== "mainnet"
  ) {
    throw new Error("Invalid batch account selection");
  }
  if (
    !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/.test(intent.origin) ||
    intent.origin.length > 200
  ) {
    throw new Error("Invalid batch origin");
  }
  if (
    !/^zkas:[a-z0-9]+$/.test(intent.account) ||
    intent.account.length > 120 ||
    !intent.outputs.length ||
    intent.outputs.length > 8
  ) {
    throw new Error("Invalid batch account or outputs");
  }
  const decimal = (value: string) =>
    /^(0|[1-9][0-9]{0,19})$/.test(value) &&
    BigInt(value) > 0n &&
    BigInt(value) <= 0x7fff_ffff_ffff_ffffn;
  if (!decimal(intent.maxFeeSompi))
    throw new Error("Invalid batch fee ceiling");
  const recipients = new Set<string>();
  for (const output of intent.outputs) {
    if (
      !/^zkas:[a-z0-9]+$/.test(output.recipient) ||
      output.recipient.length > 120 ||
      output.recipient === intent.account ||
      recipients.has(output.recipient) ||
      !decimal(output.amountSompi)
    ) {
      throw new Error("Invalid batch recipient or amount");
    }
    assertHex(output.memoHex, 512);
    recipients.add(output.recipient);
  }
}

function assertRecord(record: ZKasBatchRecord): void {
  assertIntent(record.intent);
  if (
    ![
      "preparing",
      "finalized",
      "unknown",
      "mempool",
      "included",
      "settled",
      "conflicted",
    ].includes(record.status)
  ) {
    throw new Error("Invalid batch journal status");
  }
  if (record.status !== "preparing") {
    if (
      !record.transactionHex ||
      record.transactionHex.length > 1_000_000 ||
      record.transactionHex.length % 2 !== 0 ||
      !/^[0-9a-f]+$/.test(record.transactionHex)
    ) {
      throw new Error("Invalid stored signed transaction");
    }
    assertHex(record.txid ?? "", 32);
    assertHex(record.sha256 ?? "", 32);
  }
}

async function assertSignedDigest(record: ZKasBatchRecord): Promise<void> {
  if (!record.transactionHex) return;
  const bytes = new Uint8Array(record.transactionHex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = parseInt(
      record.transactionHex.slice(index * 2, index * 2 + 2),
      16,
    );
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const actual = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (actual !== record.sha256)
    throw new Error("Signed transaction digest mismatch");
}

export class ZKasBatchJournal {
  private readonly store: PrivateStore;
  private readonly legacyReserved: (
    selection: ZKasSelection,
  ) => Promise<boolean>;

  constructor(
    store: PrivateStore,
    legacyReserved: (selection: ZKasSelection) => Promise<boolean>,
  ) {
    this.store = store;
    this.legacyReserved = legacyReserved;
  }

  private async all(): Promise<Record<string, ZKasBatchRecord>> {
    const records =
      (await this.store.getValue<Record<string, ZKasBatchRecord>>(
        BATCH_JOURNAL_KEY,
      )) ?? {};
    if (
      !records ||
      Array.isArray(records) ||
      typeof records !== "object" ||
      Object.keys(records).length > 128
    ) {
      throw new Error("Invalid private batch journal");
    }
    for (const [id, record] of Object.entries(records)) {
      assertHex(id, 32);
      assertRecord(record);
      if (record.intent.logicalId !== id)
        throw new Error("Invalid private batch journal identity");
    }
    return records;
  }

  async get(logicalId: string): Promise<ZKasBatchRecord | undefined> {
    assertHex(logicalId, 32);
    const record = (await this.all())[logicalId];
    if (record) await assertSignedDigest(record);
    return record;
  }

  async hasReservation(selection: ZKasSelection): Promise<boolean> {
    return Object.values(await this.all()).some(
      (record) => accountKey(record.intent.selection) === accountKey(selection),
    );
  }

  async reserve(intent: ZKasBatchIntent): Promise<void> {
    assertIntent(intent);
    return withZKasPaymentAccountGate(async () => {
      if (await this.legacyReserved(intent.selection))
        throw new Error(
          "An unresolved legacy ZKas payment reserves this account",
        );
      await this.store.updateValue<Record<string, ZKasBatchRecord>>(
        BATCH_JOURNAL_KEY,
        async (current) => {
          const records = current ?? {};
          const same = records[intent.logicalId];
          if (same) {
            assertRecord(same);
            if (
              same.status === "preparing" &&
              JSON.stringify(same.intent) === JSON.stringify(intent)
            )
              return records;
            throw new Error("Batch intent changed or has already been signed");
          }
          if (
            Object.values(records).some(
              (record) =>
                accountKey(record.intent.selection) ===
                accountKey(intent.selection),
            )
          ) {
            throw new Error(
              "An unresolved batch payment reserves this account",
            );
          }
          if (Object.keys(records).length >= 128)
            throw new Error("Private batch journal is full");
          return {
            ...records,
            [intent.logicalId]: {
              intent: structuredClone(intent),
              status: "preparing",
            },
          };
        },
      );
    });
  }

  async saveFinalized(
    intent: ZKasBatchIntent,
    signed: ZKasSignedBytes,
  ): Promise<void> {
    assertIntent(intent);
    if (
      !signed.transactionHex ||
      signed.transactionHex.length > 1_000_000 ||
      signed.transactionHex.length % 2 !== 0 ||
      !/^[0-9a-f]+$/.test(signed.transactionHex)
    )
      throw new Error("Invalid signed transaction bytes");
    assertHex(signed.txid, 32);
    assertHex(signed.sha256, 32);
    await assertSignedDigest({ intent, status: "finalized", ...signed });
    await this.store.updateValue<Record<string, ZKasBatchRecord>>(
      BATCH_JOURNAL_KEY,
      (current) => {
        const records = current ?? {};
        const record = records[intent.logicalId];
        if (!record || JSON.stringify(record.intent) !== JSON.stringify(intent))
          throw new Error("Batch intent changed");
        if (record.status !== "preparing") {
          if (
            record.transactionHex === signed.transactionHex &&
            record.txid === signed.txid &&
            record.sha256 === signed.sha256
          )
            return records;
          throw new Error("Signed transaction is immutable");
        }
        return {
          ...records,
          [intent.logicalId]: { ...record, ...signed, status: "finalized" },
        };
      },
    );
  }

  async markUnknown(logicalId: string): Promise<void> {
    assertHex(logicalId, 32);
    await this.store.updateValue<Record<string, ZKasBatchRecord>>(
      BATCH_JOURNAL_KEY,
      (current) => {
        const records = current ?? {};
        const record = records[logicalId];
        if (!record || record.status === "preparing")
          throw new Error("No finalized transaction to submit");
        return { ...records, [logicalId]: { ...record, status: "unknown" } };
      },
    );
  }
}

let journal: ZKasBatchJournal | undefined;
export async function getZKasBatchJournal(): Promise<ZKasBatchJournal> {
  const [{ ExtensionService }, { getZKasPaymentJournal }] = await Promise.all([
    import("@/lib/service/extension-service"),
    import("./payment-journal"),
  ]);
  journal ??= new ZKasBatchJournal(
    ExtensionService.getInstance().getKeyring(),
    async (selection) => {
      const legacy = await getZKasPaymentJournal().get(selection);
      return legacy !== undefined && legacy.status !== "success";
    },
  );
  return journal;
}
