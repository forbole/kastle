import type { ZKasBatchIntent, ZKasSignedBytes } from "./batch-journal";
import { ZKasBatchJournal } from "./batch-journal";
import type { ZKasPreparedBatch, ZKasBatchSendStatus } from "./batch-client";

type Signature = { actionIndex: number; signatureHex: string };

export type PrivateBatchSigner = {
  sign(): Promise<Signature[]>;
  verifyFinalized(signed: ZKasSignedBytes): Promise<void>;
};

type BatchDaemon = {
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

function sameIntent(left: ZKasBatchIntent, right: ZKasBatchIntent): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ZKasBatchPayment {
  private readonly daemon: BatchDaemon;
  private readonly journal: ZKasBatchJournal;
  private readonly checkSelection: (intent: ZKasBatchIntent) => Promise<void>;

  constructor(
    daemon: BatchDaemon,
    journal: ZKasBatchJournal,
    checkSelection: (intent: ZKasBatchIntent) => Promise<void>,
  ) {
    this.daemon = daemon;
    this.journal = journal;
    this.checkSelection = checkSelection;
  }

  async begin(
    intent: ZKasBatchIntent,
  ): Promise<{ capability: string; logicalId: string; expiresAtUnix: number }> {
    await this.checkSelection(intent);
    await this.journal.reserve(intent);
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
    const signer = await openPrivateSigner(prepared, record.intent);
    await this.checkSelection(intent);
    const signatures = await signer.sign();
    await this.checkSelection(intent);
    let signed: ZKasSignedBytes;
    try {
      signed = await this.daemon.finalize(
        record.intent,
        prepared.session,
        signatures,
      );
    } catch {
      // If the reply was lost after daemon finalization, retrieve its exact
      // journaled bytes while this private signing handle still exists.
      await this.checkSelection(intent);
      signed = await this.daemon.finalizedJournal(record.intent);
    }
    await this.checkSelection(intent);
    await signer.verifyFinalized(signed);
    await this.checkSelection(intent);
    await this.journal.saveFinalized(record.intent, signed);
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
      !record.sha256
    ) {
      throw new Error("No verified signed batch payment is stored");
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
