import type { ZKasSelection } from "./selection";
import { withZKasPaymentAccountGate } from "./payment-account-gate";
import { assertBatchOrigin } from "./batch-origin";

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

export type ZKasSignedTicket = {
  value: string;
  sha256: string;
  session: string;
  daemonIdentity: string;
  preparedChecksum: string;
};

/** Native-sealed, wallet-private approval metadata. The exact memos live in intent. */
export type DirectActionApproval = {
  version: 1;
  actionId: string;
  idempotencyKey: string;
  exactDigest: string;
  birthHash: string;
  sessionId: string;
  sourceGeneration: string;
  ownerPeerId: string;
  recipientPeerId: string;
  recipientCardHex: string;
  kind: "invite" | "decision" | "text";
  referenceActionId: string | null;
  text: string;
};

export type ZKasBatchRecord = {
  intent: ZKasBatchIntent;
  directApproval?: DirectActionApproval;
  directPrepared?: { session: string; checksum: string };
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
  signedTicket?: ZKasSignedTicket;
};

const DIRECT_COLLECTOR =
  "zkas:pxm8d4su40hc95vr0llq7rrf5gqzhmdhh5m3c8qtve2dllfxrqrsh6wlugnyp3krnxe2cgs4fmfwagv";

function assertDirectApproval(
  intent: ZKasBatchIntent,
  approval: DirectActionApproval,
): void {
  if (
    !approval ||
    Object.keys(approval).sort().join() !==
      "actionId,birthHash,exactDigest,idempotencyKey,kind,ownerPeerId,recipientCardHex,recipientPeerId,referenceActionId,sessionId,sourceGeneration,text,version" ||
    approval.version !== 1 ||
    !/^[0-9a-f]{32}$/.test(approval.actionId) ||
    !/^[0-9a-f]{64}$/.test(approval.idempotencyKey) ||
    approval.idempotencyKey !== intent.logicalId ||
    !/^[0-9a-f]{64}$/.test(approval.exactDigest) ||
    !/^[0-9a-f]{64}$/.test(approval.birthHash) ||
    !/^[0-9a-f]{32}$/.test(approval.sessionId) ||
    !/^[0-9a-f]{32}$/.test(approval.ownerPeerId) ||
    !/^[0-9a-f]{32}$/.test(approval.recipientPeerId) ||
    approval.ownerPeerId === approval.recipientPeerId ||
    !/^[0-9a-f]{368}$/.test(approval.recipientCardHex) ||
    approval.recipientCardHex.slice(0, 2) !== "03" ||
    !/^[1-9][0-9]{0,19}$/.test(approval.sourceGeneration) ||
    BigInt(approval.sourceGeneration) > (1n << 64n) - 1n ||
    !["invite", "decision", "text"].includes(approval.kind) ||
    (approval.kind === "invite"
      ? approval.referenceActionId !== null
      : !/^[0-9a-f]{32}$/.test(approval.referenceActionId ?? "")) ||
    typeof approval.text !== "string" ||
    new TextEncoder().encode(approval.text).length >
      (approval.kind === "text"
        ? 216
        : approval.kind === "decision"
          ? 32
          : 33) ||
    intent.outputs.length !== 4 ||
    intent.outputs.some(
      (output, index) =>
        output.amountSompi !== (index === 3 ? "10000000" : "1") ||
        (index === 3
          ? output.recipient !== DIRECT_COLLECTOR ||
            !/^0{1024}$/.test(output.memoHex)
          : !output.memoHex.startsWith("4d4a333a")),
    ) ||
    BigInt(intent.maxFeeSompi) > 5_000_000n
  ) {
    throw new Error("Invalid original direct-action approval");
  }
}

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
  assertBatchOrigin(intent.origin);
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
  if (record.directApproval)
    assertDirectApproval(record.intent, record.directApproval);
  if (
    record.directPrepared &&
    (!record.directApproval ||
      !/^[0-9a-f]{48}$/.test(record.directPrepared.session) ||
      !/^[0-9a-f]{64}$/.test(record.directPrepared.checksum) ||
      (record.signedTicket &&
        (record.signedTicket.session !== record.directPrepared.session ||
          record.signedTicket.preparedChecksum !==
            record.directPrepared.checksum)))
  )
    throw new Error("Original direct preparation changed");
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
    if (!record.signedTicket)
      throw new Error(
        "Signed batch ticket is missing from the private journal",
      );
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
  if (record.signedTicket) assertTicketMetadata(record.signedTicket);
}

function assertTicketMetadata(ticket: ZKasSignedTicket): void {
  if (
    typeof ticket.value !== "string" ||
    ticket.value.length > 640 * 1024 ||
    ticket.value.length === 0 ||
    typeof ticket.daemonIdentity !== "string" ||
    ticket.daemonIdentity.length > 200
  ) {
    throw new Error("Invalid private signed ticket metadata");
  }
  let canonicalDaemon = false;
  try {
    const url = new URL(ticket.daemonIdentity);
    canonicalDaemon =
      url.origin === ticket.daemonIdentity &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/" &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "localhost" || url.hostname === "127.0.0.1")));
  } catch {
    canonicalDaemon = false;
  }
  if (
    !/^[0-9a-f]{48}$/.test(ticket.session) ||
    !/^[0-9a-f]{64}$/.test(ticket.sha256) ||
    !/^[0-9a-f]{64}$/.test(ticket.preparedChecksum) ||
    !canonicalDaemon
  ) {
    throw new Error("Invalid private signed ticket metadata");
  }
}

async function sha256Text(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function assertTicketContents(
  intent: ZKasBatchIntent,
  signedTicket: string,
  preparedChecksum: string,
  signatures: { actionIndex: number; signatureHex: string }[],
): void {
  let ticket: Record<string, unknown>;
  try {
    ticket = JSON.parse(signedTicket);
  } catch {
    throw new Error("Invalid private signed ticket");
  }
  if (
    !ticket ||
    typeof ticket !== "object" ||
    Array.isArray(ticket) ||
    JSON.stringify(ticket) !== signedTicket ||
    Object.keys(ticket).sort().join() !==
      "approvalDigest,format,prepared,signatures,version" ||
    ticket.format !== "zkas-private-signed-payment" ||
    ticket.version !== 1 ||
    !/^[0-9a-f]{64}$/.test(String(ticket.approvalDigest)) ||
    JSON.stringify(ticket.signatures) !== JSON.stringify(signatures)
  ) {
    throw new Error("Private signed ticket differs from original signatures");
  }
  const prepared = ticket.prepared as Record<string, unknown>;
  if (
    !prepared ||
    typeof prepared !== "object" ||
    prepared.format !== "zkas-prepared-payment-multi" ||
    prepared.version !== 3 ||
    prepared.checksum !== preparedChecksum ||
    prepared.account !== intent.account ||
    !Array.isArray(prepared.outputs) ||
    prepared.outputs.length !== intent.outputs.length ||
    prepared.outputs.some((rawOutput, index) => {
      const output = rawOutput as Record<string, unknown>;
      const approved = intent.outputs[index];
      return (
        !output ||
        typeof output !== "object" ||
        output.recipient !== approved.recipient ||
        output.amount !== approved.amountSompi ||
        output.memo !== approved.memoHex
      );
    }) ||
    typeof prepared.fee !== "string" ||
    !/^(0|[1-9][0-9]{0,19})$/.test(prepared.fee) ||
    BigInt(prepared.fee) > BigInt(intent.maxFeeSompi)
  ) {
    throw new Error("Private signed ticket differs from approved payment");
  }
  const spendAuth = prepared.spendAuth;
  if (
    !Array.isArray(spendAuth) ||
    spendAuth.length === 0 ||
    spendAuth.length > 32 ||
    !Array.isArray(ticket.signatures) ||
    ticket.signatures.length !== spendAuth.length ||
    ticket.signatures.some((signature, index) => {
      const item = signature as Record<string, unknown>;
      const request = spendAuth[index] as Record<string, unknown>;
      return (
        !item ||
        typeof item !== "object" ||
        Object.keys(item).sort().join() !== "actionIndex,signatureHex" ||
        !Number.isSafeInteger(item.actionIndex) ||
        item.actionIndex !== request?.actionIndex ||
        !/^[0-9a-f]{128}$/.test(String(item.signatureHex))
      );
    })
  ) {
    throw new Error("Invalid private signed ticket signature map");
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
      if (record.signedTicket) {
        if (
          (await sha256Text(record.signedTicket.value)) !==
          record.signedTicket.sha256
        )
          throw new Error("Private signed ticket digest mismatch");
        assertTicketContents(
          record.intent,
          record.signedTicket.value,
          record.signedTicket.preparedChecksum,
          JSON.parse(record.signedTicket.value).signatures,
        );
      }
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

  async assertNoLegacyReservation(selection: ZKasSelection): Promise<void> {
    if (await this.legacyReserved(structuredClone(selection)))
      throw new Error(
        "An unresolved legacy ZKas payment reserves this account",
      );
  }

  async reserve(intent: ZKasBatchIntent): Promise<boolean> {
    assertIntent(intent);
    return withZKasPaymentAccountGate(async () => {
      let created = false;
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
          created = true;
          return {
            ...records,
            [intent.logicalId]: {
              intent: structuredClone(intent),
              status: "preparing",
            },
          };
        },
      );
      return created;
    });
  }

  /** Only the privileged FromBirth factory may supply the proof while the account gate is held. */
  async reserveDirectFirstUse(
    incomingIntent: ZKasBatchIntent,
    incomingApproval: DirectActionApproval,
    assertCurrent: () => void,
    proveEmpty: () => Promise<void>,
  ): Promise<void> {
    const intent = structuredClone(incomingIntent);
    const approval = structuredClone(incomingApproval);
    assertIntent(intent);
    assertDirectApproval(intent, approval);
    return withZKasPaymentAccountGate(async () => {
      const checkFence = () => {
        if ((assertCurrent() as unknown) !== undefined)
          throw new Error(
            "Direct admission requires a synchronous context fence",
          );
      };
      const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
        checkFence();
        const result = await operation();
        checkFence();
        return result;
      };
      if (
        await guarded(() =>
          this.legacyReserved(structuredClone(intent.selection)),
        )
      )
        throw new Error(
          "An unresolved legacy ZKas payment reserves this account",
        );
      const original = await guarded(() => this.all());
      const originalJson = JSON.stringify(original);
      if (Object.keys(original).length >= 128)
        throw new Error("Private batch journal is full");
      if (
        original[intent.logicalId] ||
        Object.values(original).some(
          (record) =>
            accountKey(record.intent.selection) ===
            accountKey(intent.selection),
        )
      )
        throw new Error(
          "Direct first-use account already has a payment reservation",
        );
      await guarded(proveEmpty);
      if (
        await guarded(() =>
          this.legacyReserved(structuredClone(intent.selection)),
        )
      )
        throw new Error(
          "An unresolved legacy ZKas payment reserves this account",
        );
      await guarded(() =>
        this.store.updateValue<Record<string, ZKasBatchRecord>>(
          BATCH_JOURNAL_KEY,
          (current) => {
            checkFence();
            if (JSON.stringify(current ?? {}) !== originalJson)
              throw new Error(
                "Private batch journal changed during direct enrollment",
              );
            return {
              ...original,
              [intent.logicalId]: {
                intent: structuredClone(intent),
                directApproval: structuredClone(approval),
                status: "preparing",
              },
            };
          },
        ),
      );
    });
  }

  /** Durable first observed prepared envelope identity, before opening a signer. */
  async pinDirectPrepared(
    incomingIntent: ZKasBatchIntent,
    prepared: { session: string; checksum: string },
  ): Promise<void> {
    const intent = structuredClone(incomingIntent);
    if (
      !/^[0-9a-f]{48}$/.test(prepared.session) ||
      !/^[0-9a-f]{64}$/.test(prepared.checksum)
    )
      throw new Error("Invalid direct preparation identity");
    await this.store.updateValue<Record<string, ZKasBatchRecord>>(
      BATCH_JOURNAL_KEY,
      (current) => {
        const records = current ?? {};
        const record = records[intent.logicalId];
        if (
          !record ||
          !record.directApproval ||
          JSON.stringify(record.intent) !== JSON.stringify(intent) ||
          record.status !== "preparing" ||
          record.signedTicket
        )
          throw new Error("Original direct approval is unavailable");
        assertRecord(record);
        if (record.directPrepared) {
          if (
            record.directPrepared.session !== prepared.session ||
            record.directPrepared.checksum !== prepared.checksum
          )
            throw new Error("Original direct preparation changed");
          return records;
        }
        return {
          ...records,
          [intent.logicalId]: {
            ...record,
            directPrepared: {
              session: prepared.session,
              checksum: prepared.checksum,
            },
          },
        };
      },
    );
  }

  // The private coordinator supplies the fresh proof while this shared gate is
  // held. This method cannot be used as a first-use/enrollment shortcut.
  async reserveAfterFreshSettlement(
    incomingIntent: ZKasBatchIntent,
    assertCurrent: () => void,
    prove: (records: readonly ZKasBatchRecord[]) => Promise<void>,
  ): Promise<void> {
    const intent = structuredClone(incomingIntent);
    assertIntent(intent);
    return withZKasPaymentAccountGate(async () => {
      const checkFence = () => {
        if ((assertCurrent() as unknown) !== undefined) {
          throw new Error(
            "Private admission requires a synchronous context fence",
          );
        }
      };
      const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
        checkFence();
        const result = await operation();
        checkFence();
        return result;
      };
      if (
        await guarded(() =>
          this.legacyReserved(structuredClone(intent.selection)),
        )
      ) {
        throw new Error(
          "An unresolved legacy ZKas payment reserves this account",
        );
      }
      const original = await guarded(() => this.all());
      const originalJson = JSON.stringify(original);
      if (Object.keys(original).length >= 128) {
        throw new Error("Private batch journal is full");
      }
      if (original[intent.logicalId]) {
        throw new Error("Batch intent already exists");
      }
      const selected = Object.values(original).filter(
        (record) =>
          accountKey(record.intent.selection) === accountKey(intent.selection),
      );
      if (selected.length === 0) {
        throw new Error("Private batch history requires separate enrollment");
      }
      if (
        selected.some(
          (record) =>
            record.intent.account !== intent.account ||
            record.intent.genesis !== intent.genesis,
        )
      ) {
        throw new Error("Private batch account or genesis changed");
      }
      await guarded(() => prove(structuredClone(selected)));
      if (
        await guarded(() =>
          this.legacyReserved(structuredClone(intent.selection)),
        )
      ) {
        throw new Error(
          "An unresolved legacy ZKas payment reserves this account",
        );
      }
      await guarded(() =>
        this.store.updateValue<Record<string, ZKasBatchRecord>>(
          BATCH_JOURNAL_KEY,
          (current) => {
            checkFence();
            if (JSON.stringify(current ?? {}) !== originalJson) {
              throw new Error("Private batch journal changed during admission");
            }
            const updated = { ...original };
            for (const [id, record] of Object.entries(original)) {
              if (
                accountKey(record.intent.selection) ===
                accountKey(intent.selection)
              ) {
                updated[id] = { ...record, status: "settled" };
              }
            }
            updated[intent.logicalId] = {
              intent: structuredClone(intent),
              status: "preparing",
            };
            return updated;
          },
        ),
      );
    });
  }

  async saveSignedTicket(
    intent: ZKasBatchIntent,
    input: Omit<ZKasSignedTicket, "value" | "sha256"> & {
      signedTicket: string;
      signatures: { actionIndex: number; signatureHex: string }[];
    },
  ): Promise<void> {
    assertIntent(intent);
    if (
      typeof input.signedTicket !== "string" ||
      input.signedTicket.length === 0 ||
      input.signedTicket.length > 640 * 1024
    ) {
      throw new Error("Invalid private signed ticket metadata");
    }
    const ticket: ZKasSignedTicket = {
      value: input.signedTicket,
      sha256: await sha256Text(input.signedTicket),
      session: input.session,
      daemonIdentity: input.daemonIdentity,
      preparedChecksum: input.preparedChecksum,
    };
    assertTicketMetadata(ticket);
    assertTicketContents(
      intent,
      ticket.value,
      ticket.preparedChecksum,
      input.signatures,
    );
    await this.store.updateValue<Record<string, ZKasBatchRecord>>(
      BATCH_JOURNAL_KEY,
      (current) => {
        const records = current ?? {};
        const record = records[intent.logicalId];
        if (!record || JSON.stringify(record.intent) !== JSON.stringify(intent))
          throw new Error("Batch intent changed");
        if (record.signedTicket) {
          if (JSON.stringify(record.signedTicket) === JSON.stringify(ticket))
            return records;
          throw new Error("Signed payment ticket is immutable");
        }
        if (record.status !== "preparing")
          throw new Error("Batch payment is already finalized");
        if (
          record.directApproval &&
          (!record.directPrepared ||
            record.directPrepared.session !== ticket.session ||
            record.directPrepared.checksum !== ticket.preparedChecksum)
        )
          throw new Error("Original direct preparation changed");
        return {
          ...records,
          [intent.logicalId]: { ...record, signedTicket: ticket },
        };
      },
    );
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
        if (!record.signedTicket)
          throw new Error("Original signed batch ticket is unavailable");
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
