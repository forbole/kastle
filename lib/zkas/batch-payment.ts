import type {
  DirectActionApproval,
  ZKasBatchIntent,
  ZKasBatchRecord,
  ZKasSignedBytes,
} from "./batch-journal";
import { ZKasBatchJournal } from "./batch-journal";
import { withZKasPaymentAccountGate } from "./payment-account-gate";
import type {
  ZKasBatchInventory,
  ZKasPreparedBatch,
  ZKasBatchSendStatus,
  ZKasBatchClient,
} from "./batch-client";
import { assertFreshSettledBatchEvidence } from "./batch-settlement-evidence";

type Signature = { actionIndex: number; signatureHex: string };

export type PrivateBatchSigner = {
  sign(): Promise<Signature[]>;
  exportTicket(): Promise<string>;
  importTicket(ticket: string): Promise<void>;
  verifyFinalized(signed: ZKasSignedBytes): Promise<void>;
  close(): void;
};

type BatchDaemon = {
  readonly identity: string;
  grant(
    intent: ZKasBatchIntent,
  ): Promise<{ capability: string; logicalId: string; expiresAtUnix: number }>;
  prepared(logicalId: string): Promise<ZKasPreparedBatch>;
  finalize(
    intent: ZKasBatchIntent,
    session: string,
    signatures: Signature[],
  ): Promise<ZKasSignedBytes>;
  finalizedJournal(intent: ZKasBatchIntent): Promise<ZKasSignedBytes>;
  submit(
    intent: ZKasBatchIntent,
    signed: ZKasSignedBytes,
  ): Promise<ZKasBatchSendStatus>;
};

type PrivateFreshSettledAdmission = {
  client: Pick<ZKasBatchClient, "discoverRecords" | "status">;
  openRecoverySigner(approved: ZKasBatchIntent): Promise<PrivateBatchSigner>;
  // The future background factory must capture authoritative wallet, grant,
  // origin, daemon, and unlock generations. A page value is not a fence.
  assertCurrent(intent: ZKasBatchIntent): void;
  monotonicNow?: () => number;
};

function assertFirstInventory(
  inventory: ZKasBatchInventory,
  records: readonly ZKasBatchRecord[],
): void {
  if (
    !inventory ||
    inventory.inventoryOnly !== true ||
    !/^[0-9a-f]{64}$/.test(inventory.epoch) ||
    inventory.unlistedReservationCount !== 0 ||
    !Array.isArray(inventory.entries) ||
    inventory.entries.length !== records.length
  ) {
    throw new Error("Incomplete batch inventory or unlisted reservation");
  }
  const originals = new Map(
    records.map((record) => [record.intent.logicalId, record]),
  );
  if (originals.size !== records.length) {
    throw new Error("Repeated private batch logical identity");
  }
  const seen = new Set<string>();
  for (const entry of inventory.entries) {
    const original = originals.get(entry.logicalId);
    if (
      !original ||
      seen.has(entry.logicalId) ||
      !/^[0-9a-f]{64}$/.test(entry.logicalId) ||
      !/^[0-9a-f]{64}$/.test(entry.txid) ||
      !/^[0-9a-f]{64}$/.test(entry.sha256) ||
      entry.txid !== original.txid ||
      entry.sha256 !== original.sha256
    ) {
      throw new Error("Batch inventory differs from private signed history");
    }
    seen.add(entry.logicalId);
  }
}

function sameIntent(left: ZKasBatchIntent, right: ZKasBatchIntent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertEmptyDirectInventory(value: ZKasBatchInventory): void {
  if (
    !value ||
    Object.keys(value).sort().join() !==
      "entries,epoch,inventoryOnly,unlistedReservationCount" ||
    value.inventoryOnly !== true ||
    !/^[0-9a-f]{64}$/.test(value.epoch) ||
    value.unlistedReservationCount !== 0 ||
    !Array.isArray(value.entries) ||
    value.entries.length !== 0
  )
    throw new Error("Incomplete or nonempty direct first-use inventory");
}

export class ZKasBatchPayment {
  private readonly daemon: BatchDaemon;
  private readonly journal: ZKasBatchJournal;
  private readonly checkSelection: (intent: ZKasBatchIntent) => Promise<void>;
  private readonly settledAdmission?: PrivateFreshSettledAdmission;
  private readonly begunHere = new Set<string>();
  private readonly freshBegunHere = new Set<string>();

  constructor(
    daemon: BatchDaemon,
    journal: ZKasBatchJournal,
    checkSelection: (intent: ZKasBatchIntent) => Promise<void>,
    settledAdmission?: PrivateFreshSettledAdmission,
  ) {
    this.daemon = daemon;
    this.journal = journal;
    this.checkSelection = checkSelection;
    this.settledAdmission = settledAdmission;
  }

  /** Wallet-private first use: the caller must witness an immutable, ready FromBirth actor. */
  async beginDirectFirstUse(
    incomingIntent: ZKasBatchIntent,
    incomingApproval: DirectActionApproval,
    assertReadyFromBirth: () => Promise<void>,
  ): Promise<{ capability: string; logicalId: string; expiresAtUnix: number }> {
    const intent = structuredClone(incomingIntent);
    const approval = structuredClone(incomingApproval);
    const admission = this.settledAdmission;
    if (!admission)
      throw new Error("Private direct admission provider is unavailable");
    const now = admission.monotonicNow ?? (() => performance.now());
    const started = now();
    const assertCurrent = () => {
      if (
        (admission.assertCurrent(structuredClone(intent)) as unknown) !==
        undefined
      )
        throw new Error(
          "Private admission requires a synchronous context fence",
        );
      const elapsed = now() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 120_000)
        throw new Error("Direct first-use admission deadline exceeded");
    };
    const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
      assertCurrent();
      const result = await operation();
      assertCurrent();
      return result;
    };
    await guarded(() => this.checkSelection(structuredClone(intent)));
    await guarded(assertReadyFromBirth);
    const existing = await guarded(() => this.journal.get(intent.logicalId));
    if (existing)
      throw new Error("Original direct first-use approval requires resume");
    await guarded(() =>
      this.journal.reserveDirectFirstUse(
        intent,
        approval,
        assertCurrent,
        async () => {
          await guarded(assertReadyFromBirth);
          const before = structuredClone(
            await guarded(() =>
              admission.client.discoverRecords({
                account: intent.account,
                genesis: intent.genesis,
              }),
            ),
          );
          assertEmptyDirectInventory(before);
          await guarded(assertReadyFromBirth);
          const after = structuredClone(
            await guarded(() =>
              admission.client.discoverRecords({
                account: intent.account,
                genesis: intent.genesis,
              }),
            ),
          );
          assertEmptyDirectInventory(after);
          await guarded(assertReadyFromBirth);
        },
      ),
    );
    this.begunHere.add(intent.logicalId);
    this.freshBegunHere.add(intent.logicalId);
    const grant = await guarded(() =>
      this.daemon.grant(structuredClone(intent)),
    );
    if (grant.logicalId !== intent.logicalId)
      throw new Error("Batch capability changed logical payment");
    return grant;
  }

  /** Regrant only the exact encrypted original after a lost first-use reply. */
  async resumeDirectGrant(
    logicalId: string,
    assertReadyFromBirth: () => Promise<void>,
  ): Promise<{ capability: string; logicalId: string; expiresAtUnix: number }> {
    const admission = this.settledAdmission;
    if (!admission)
      throw new Error("Private direct admission provider is unavailable");
    return withZKasPaymentAccountGate(async () => {
      const record = await this.journal.get(logicalId);
      if (
        !record?.directApproval ||
        record.status !== "preparing" ||
        record.signedTicket
      )
        throw new Error("Original direct approval is unavailable");
      const intent = record.intent;
      const check = () => {
        if (
          (admission.assertCurrent(structuredClone(intent)) as unknown) !==
          undefined
        )
          throw new Error(
            "Private admission requires a synchronous context fence",
          );
      };
      check();
      await this.journal.assertNoLegacyReservation(intent.selection);
      check();
      await this.checkSelection(structuredClone(intent));
      check();
      await assertReadyFromBirth();
      check();
      await this.journal.assertNoLegacyReservation(intent.selection);
      check();
      const grant = await this.daemon.grant(structuredClone(intent));
      check();
      if (grant.logicalId !== intent.logicalId)
        throw new Error("Batch capability changed logical payment");
      return grant;
    });
  }

  async beginAfterFreshSettlement(
    incomingIntent: ZKasBatchIntent,
  ): Promise<{ capability: string; logicalId: string; expiresAtUnix: number }> {
    const intent = structuredClone(incomingIntent);
    const admission = this.settledAdmission;
    if (!admission)
      throw new Error("Private batch admission provider is unavailable");
    // This is a fail-closed elapsed-time budget, checked after each await;
    // synchronous SDK or WebCrypto work is not preempted by this clock.
    const now = admission.monotonicNow ?? (() => performance.now());
    const started = now();
    const assertCurrent = () => {
      if (
        (admission.assertCurrent(structuredClone(intent)) as unknown) !==
        undefined
      ) {
        throw new Error(
          "Private admission requires a synchronous context fence",
        );
      }
      const elapsed = now() - started;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 120_000) {
        throw new Error("Fresh batch admission deadline exceeded");
      }
    };
    const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
      assertCurrent();
      const result = await operation();
      assertCurrent();
      return result;
    };
    await guarded(() => this.checkSelection(structuredClone(intent)));
    if (this.freshBegunHere.has(intent.logicalId)) {
      const existing = await guarded(() => this.journal.get(intent.logicalId));
      if (
        !existing ||
        !sameIntent(existing.intent, intent) ||
        existing.status !== "preparing" ||
        existing.signedTicket
      ) {
        throw new Error("Original private batch approval is unavailable");
      }
    } else {
      await guarded(() =>
        this.journal.reserveAfterFreshSettlement(
          structuredClone(intent),
          assertCurrent,
          async (records) => {
            const before = structuredClone(
              await guarded(() =>
                admission.client.discoverRecords({
                  account: intent.account,
                  genesis: intent.genesis,
                }),
              ),
            );
            assertFirstInventory(before, records);
            const statuses: ZKasBatchSendStatus[] = [];
            for (const record of records) {
              assertCurrent();
              if (
                !record.signedTicket ||
                !record.transactionHex ||
                !record.txid ||
                !record.sha256 ||
                record.signedTicket.daemonIdentity !== this.daemon.identity
              ) {
                throw new Error(
                  "Original signed batch ticket or bytes are unavailable",
                );
              }
              assertCurrent();
              const signer = await admission.openRecoverySigner(
                structuredClone(record.intent),
              );
              try {
                assertCurrent();
                await guarded(() =>
                  signer.importTicket(record.signedTicket!.value),
                );
                await guarded(() =>
                  signer.verifyFinalized({
                    transactionHex: record.transactionHex!,
                    txid: record.txid!,
                    sha256: record.sha256!,
                  }),
                );
              } finally {
                signer.close();
              }
              assertCurrent();
              const status = structuredClone(
                await guarded(() =>
                  admission.client.status(structuredClone(record.intent)),
                ),
              );
              if (
                status.status !== "settled" ||
                status.logicalId !== record.intent.logicalId ||
                status.txid !== record.txid ||
                status.sha256 !== record.sha256
              ) {
                throw new Error(
                  "Original batch payment is not freshly settled",
                );
              }
              statuses.push(status);
            }
            const after = structuredClone(
              await guarded(() =>
                admission.client.discoverRecords({
                  account: intent.account,
                  genesis: intent.genesis,
                }),
              ),
            );
            await guarded(() =>
              assertFreshSettledBatchEvidence({
                selection: intent.selection,
                account: intent.account,
                genesis: intent.genesis,
                daemonIdentity: this.daemon.identity,
                records,
                before,
                statuses,
                after,
              }),
            );
          },
        ),
      );
      this.freshBegunHere.add(intent.logicalId);
    }
    this.begunHere.add(intent.logicalId);
    const grant = await guarded(() =>
      this.daemon.grant(structuredClone(intent)),
    );
    if (grant.logicalId !== intent.logicalId) {
      throw new Error("Batch capability changed logical payment");
    }
    return grant;
  }

  async begin(
    intent: ZKasBatchIntent,
  ): Promise<{ capability: string; logicalId: string; expiresAtUnix: number }> {
    if (this.freshBegunHere.has(intent.logicalId)) {
      throw new Error(
        "Private fresh batch approval requires its fenced grant path",
      );
    }
    await this.checkSelection(intent);
    const created = await this.journal.reserve(intent);
    if (created) this.begunHere.add(intent.logicalId);
    else if (!this.begunHere.has(intent.logicalId))
      throw new Error("Original batch approval is unavailable after restart");
    await this.checkSelection(intent);
    if ((await this.journal.get(intent.logicalId))?.signedTicket)
      throw new Error("Original signed batch ticket requires recovery");
    await this.checkSelection(intent);
    const grant = await this.daemon.grant(intent);
    await this.checkSelection(intent);
    return grant;
  }

  async complete(
    intent: ZKasBatchIntent,
    openPrivateSigner: (
      prepared: ZKasPreparedBatch,
      approved: ZKasBatchIntent,
    ) => Promise<PrivateBatchSigner>,
  ): Promise<ZKasBatchSendStatus> {
    return this.completeCore(intent, openPrivateSigner, false);
  }

  /** Restart-safe only for the exact durable native direct approval. */
  async completeDirectFromJournal(
    logicalId: string,
    openPrivateSigner: (
      prepared: ZKasPreparedBatch,
      approved: ZKasBatchIntent,
    ) => Promise<PrivateBatchSigner>,
  ): Promise<ZKasBatchSendStatus> {
    return withZKasPaymentAccountGate(async () => {
      const record = await this.journal.get(logicalId);
      if (!record?.directApproval)
        throw new Error("Original direct approval is unavailable");
      return this.completeCore(record.intent, openPrivateSigner, true);
    });
  }

  private async completeCore(
    intent: ZKasBatchIntent,
    openPrivateSigner: (
      prepared: ZKasPreparedBatch,
      approved: ZKasBatchIntent,
    ) => Promise<PrivateBatchSigner>,
    durableDirect: boolean,
  ): Promise<ZKasBatchSendStatus> {
    await this.checkSelection(intent);
    const record = await this.journal.get(intent.logicalId);
    await this.checkSelection(intent);
    if (
      !record ||
      !sameIntent(record.intent, intent) ||
      record.status !== "preparing"
    ) {
      throw new Error("Batch payment intent is unavailable or already signed");
    }
    if (record.signedTicket)
      throw new Error("Original signed batch ticket requires recovery");
    if (durableDirect !== !!record.directApproval)
      throw new Error("Original direct approval path changed");
    if (!durableDirect && !this.begunHere.has(intent.logicalId))
      throw new Error("Original batch approval is unavailable after restart");
    const prepared = await this.daemon.prepared(intent.logicalId);
    if (
      prepared.status !== "prepared" ||
      !prepared.session ||
      !prepared.preparedPayment ||
      prepared.logicalId !== intent.logicalId
    ) {
      throw new Error("Batch preparation is incomplete");
    }
    await this.checkSelection(intent);
    if (durableDirect) {
      await this.journal.pinDirectPrepared(record.intent, {
        session: prepared.session,
        checksum: prepared.preparedPayment.checksum,
      });
      await this.checkSelection(intent);
    }
    const signer = await openPrivateSigner(prepared, record.intent);
    try {
      await this.checkSelection(intent);
      const signatures = await signer.sign();
      await this.checkSelection(intent);
      const signedTicket = await signer.exportTicket();
      await this.checkSelection(intent);
      await this.journal.saveSignedTicket(record.intent, {
        signedTicket,
        session: prepared.session,
        daemonIdentity: this.daemon.identity,
        preparedChecksum: prepared.preparedPayment.checksum,
        signatures,
      });
      await this.checkSelection(intent);
      let signed: ZKasSignedBytes;
      try {
        signed = await this.daemon.finalize(
          record.intent,
          prepared.session,
          signatures,
        );
      } catch {
        // A lost reply may follow successful daemon finalization. The stored
        // ticket retains this handle's exact original signatures.
        await this.checkSelection(intent);
        signed = await this.daemon.finalizedJournal(record.intent);
      }
      await this.checkSelection(intent);
      await signer.verifyFinalized(signed);
      await this.checkSelection(intent);
      await this.journal.saveFinalized(record.intent, signed);
      await this.checkSelection(intent);
    } finally {
      signer.close();
    }
    return this.retryStored(intent);
  }

  async recover(
    intent: ZKasBatchIntent,
    openRecoverySigner: (
      approved: ZKasBatchIntent,
    ) => Promise<PrivateBatchSigner>,
  ): Promise<ZKasBatchSendStatus> {
    await this.checkSelection(intent);
    const record = await this.journal.get(intent.logicalId);
    await this.checkSelection(intent);
    if (
      !record ||
      !sameIntent(record.intent, intent) ||
      record.status !== "preparing" ||
      !record.signedTicket ||
      record.signedTicket.daemonIdentity !== this.daemon.identity
    ) {
      throw new Error("Original signed batch payment ticket is unavailable");
    }
    const signer = await openRecoverySigner(record.intent);
    try {
      await this.checkSelection(intent);
      await signer.importTicket(record.signedTicket.value);
      await this.checkSelection(intent);
      let signed: ZKasSignedBytes;
      try {
        signed = await this.daemon.finalizedJournal(record.intent);
      } catch {
        await this.checkSelection(intent);
        const signatures = JSON.parse(record.signedTicket.value)
          .signatures as Signature[];
        signed = await this.daemon.finalize(
          record.intent,
          record.signedTicket.session,
          signatures,
        );
      }
      await this.checkSelection(intent);
      await signer.verifyFinalized(signed);
      await this.checkSelection(intent);
      await this.journal.saveFinalized(record.intent, signed);
      await this.checkSelection(intent);
    } finally {
      signer.close();
    }
    return this.retryStored(intent);
  }

  async retryStored(intent: ZKasBatchIntent): Promise<ZKasBatchSendStatus> {
    await this.checkSelection(intent);
    const record = await this.journal.get(intent.logicalId);
    await this.checkSelection(intent);
    if (
      !record ||
      !sameIntent(record.intent, intent) ||
      !record.transactionHex ||
      !record.txid ||
      !record.sha256 ||
      record.signedTicket?.daemonIdentity !== this.daemon.identity
    ) {
      throw new Error(
        "No verified signed batch payment for this daemon is stored",
      );
    }
    await this.journal.markUnknown(intent.logicalId);
    await this.checkSelection(intent);
    // The daemon retrieves its own exact journaled bytes using these identities.
    // A timeout or malformed response leaves this local record UNKNOWN.
    const result = await this.daemon.submit(record.intent, {
      transactionHex: record.transactionHex,
      txid: record.txid,
      sha256: record.sha256,
    });
    await this.checkSelection(intent);
    if (
      result.logicalId !== intent.logicalId ||
      result.txid !== record.txid ||
      result.sha256 !== record.sha256
    ) {
      throw new Error(
        "Batch submission status changed signed transaction identity",
      );
    }
    return result;
  }
}
