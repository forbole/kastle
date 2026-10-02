import { z } from "zod";
import type { Keyring } from "@/lib/keyring-manager";
import { isAllowedZKasDappOrigin } from "./connection";
import {
  assertHistoryGenesis,
  canonicalHistoryDaemonOrigin,
  canonicalHistoryIndexOrigin,
} from "./history-config";

export const HISTORY_GRANTS_KEY = "zkasHistoryGrants" as const;

const AudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("website"), origin: z.string() }).strict(),
  z.object({ kind: z.literal("walletSelf") }).strict(),
]);
const ContextSchema = z
  .object({
    audience: AudienceSchema,
    walletId: z.string().min(1).max(128),
    accountIndex: z.number().int().nonnegative().safe().max(0x7fff_ffff),
    address0: z.string().regex(/^zkas:[a-z0-9]{1,115}$/),
    network: z.literal("mainnet"),
    genesis: z.string().regex(/^[0-9a-f]{64}$/),
    daemonUrl: z.string(),
    indexUrl: z.string(),
  })
  .strict();
const GrantSchema = ContextSchema.extend({
  scope: z.literal("mj3ProtocolMessagesRead"),
  revision: z.string().uuid(),
}).strict();
const DocumentSchema = z
  .object({ version: z.literal(1), records: z.array(GrantSchema).max(64) })
  .strict();

export type HistoryGrantContext = z.infer<typeof ContextSchema>;
type Grant = z.infer<typeof GrantSchema>;
type Document = z.infer<typeof DocumentSchema>;

function context(value: HistoryGrantContext): HistoryGrantContext {
  const parsed = ContextSchema.parse(value);
  if (
    parsed.audience.kind === "website" &&
    !isAllowedZKasDappOrigin(parsed.audience.origin)
  ) {
    throw new Error("Invalid history grant audience");
  }
  assertHistoryGenesis(parsed.genesis);
  canonicalHistoryDaemonOrigin(parsed.daemonUrl);
  canonicalHistoryIndexOrigin(parsed.indexUrl);
  return parsed;
}

function identity(value: HistoryGrantContext): string {
  return JSON.stringify([
    value.audience.kind,
    value.audience.kind === "website" ? value.audience.origin : "",
    value.walletId,
    value.accountIndex,
    value.network,
  ]);
}

function document(value: unknown): Document {
  const parsed: Document =
    value === null ? { version: 1, records: [] } : DocumentSchema.parse(value);
  const identities = new Set<string>();
  const revisions = new Set<string>();
  for (const record of parsed.records) {
    context({
      audience: record.audience,
      walletId: record.walletId,
      accountIndex: record.accountIndex,
      address0: record.address0,
      network: record.network,
      genesis: record.genesis,
      daemonUrl: record.daemonUrl,
      indexUrl: record.indexUrl,
    });
    const key = identity(record);
    if (identities.has(key) || revisions.has(record.revision)) {
      throw new Error("Invalid history grant records");
    }
    identities.add(key);
    revisions.add(record.revision);
  }
  return parsed;
}

function sameContext(a: HistoryGrantContext, b: HistoryGrantContext): boolean {
  return (
    identity(a) === identity(b) &&
    a.address0 === b.address0 &&
    a.genesis === b.genesis &&
    a.daemonUrl === b.daemonUrl &&
    a.indexUrl === b.indexUrl
  );
}

/** Background-private grant storage. A record alone cannot issue a read lease. */
export class HistoryGrantStore {
  private readonly keyring: Keyring;

  constructor(keyring: Keyring) {
    this.keyring = keyring;
  }

  async approve(
    captured: HistoryGrantContext,
    assertCurrent: () => Promise<void>,
  ): Promise<string> {
    const checked = context(captured);
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    await assertCurrent();
    if (
      !this.keyring.isUnlocked() ||
      this.keyring.getSessionVersion() !== session
    )
      throw new Error("History grant context changed");
    const revision = crypto.randomUUID();
    const writtenGeneration =
      await this.keyring.updateValueIfGeneration<unknown>(
        HISTORY_GRANTS_KEY,
        generation,
        (current) => {
          const previous = document(current);
          const records = previous.records.filter(
            (record) => identity(record) !== identity(checked),
          );
          if (records.length >= 64)
            throw new Error("History grant limit reached");
          const next: Grant = {
            ...checked,
            scope: "mj3ProtocolMessagesRead",
            revision,
          };
          return { version: 1, records: [...records, next] };
        },
      );
    // A selection change during encrypted storage can leave an unusable stale
    // record; it must never return an authoritative lease.
    await assertCurrent();
    if (
      !this.keyring.isUnlocked() ||
      this.keyring.getSessionVersion() !== session ||
      this.keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !==
        writtenGeneration
    )
      throw new Error("History grant context changed");
    return revision;
  }

  async revoke(captured: HistoryGrantContext): Promise<void> {
    const checked = context(captured);
    await this.keyring.updateValue<unknown>(HISTORY_GRANTS_KEY, (current) => {
      const previous = document(current);
      return {
        version: 1,
        records: previous.records.filter(
          (record) => identity(record) !== identity(checked),
        ),
      };
    });
  }

  /** Check both sides of decryption; the caller must rederive the live context. */
  async active(
    captured: HistoryGrantContext,
    revision: string,
    session: number,
    assertCurrent: () => Promise<void>,
  ): Promise<boolean> {
    const checked = context(captured);
    const generation = this.keyring.getMutationGeneration(HISTORY_GRANTS_KEY);
    if (
      !this.keyring.isUnlocked() ||
      this.keyring.getSessionVersion() !== session
    )
      return false;
    await assertCurrent();
    if (
      !this.keyring.isUnlocked() ||
      this.keyring.getSessionVersion() !== session ||
      this.keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !== generation
    )
      return false;
    let raw: unknown;
    try {
      raw = await this.keyring.getValue<unknown>(HISTORY_GRANTS_KEY);
    } catch (cause) {
      if (
        !this.keyring.isUnlocked() ||
        this.keyring.getSessionVersion() !== session
      )
        return false;
      throw cause;
    }
    const grants = document(raw);
    await assertCurrent();
    if (
      !this.keyring.isUnlocked() ||
      this.keyring.getSessionVersion() !== session ||
      this.keyring.getMutationGeneration(HISTORY_GRANTS_KEY) !== generation
    )
      return false;
    return grants.records.some(
      (record) =>
        record.revision === revision &&
        record.scope === "mj3ProtocolMessagesRead" &&
        sameContext(record, checked),
    );
  }
}
