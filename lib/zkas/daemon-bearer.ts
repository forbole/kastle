import { z } from "zod";
import type { Keyring } from "@/lib/keyring-manager";
import { canonicalHistoryDaemonOrigin } from "./history-config";

export const DAEMON_BEARERS_KEY = "zkasDaemonBearers" as const;

const tokenPattern = /^[0-9a-f]{64}$/;
const RecordSchema = z
  .object({
    origin: z.string(),
    bearer: z.string(),
    revision: z.string().uuid(),
  })
  .strict();
const DocumentSchema = z
  .object({
    version: z.literal(1),
    records: z.array(RecordSchema).max(8),
  })
  .strict();

type Record = z.infer<typeof RecordSchema>;
type Document = z.infer<typeof DocumentSchema>;
export type DaemonBearerRow = Pick<Record, "origin" | "revision">;

export function canonicalDaemonBearerOrigin(value: unknown): string {
  try {
    return canonicalHistoryDaemonOrigin(value as string);
  } catch {
    throw new Error("Invalid daemon pairing origin");
  }
}

function checkedBearer(value: unknown): string {
  if (typeof value !== "string" || !tokenPattern.test(value))
    throw new Error("Invalid daemon pairing credential");
  return value;
}

function checkedRevision(value: unknown): string {
  if (typeof value !== "string" || !z.string().uuid().safeParse(value).success)
    throw new Error("Invalid daemon pairing revision");
  return value;
}

function document(value: unknown): Document {
  try {
    const parsed =
      value === null
        ? { version: 1 as const, records: [] }
        : DocumentSchema.parse(value);
    const origins = new Set<string>();
    const revisions = new Set<string>();
    for (const record of parsed.records) {
      if (
        canonicalDaemonBearerOrigin(record.origin) !== record.origin ||
        checkedBearer(record.bearer) !== record.bearer ||
        origins.has(record.origin) ||
        revisions.has(record.revision)
      )
        throw new Error("Invalid daemon pairing document");
      origins.add(record.origin);
      revisions.add(record.revision);
    }
    return parsed;
  } catch {
    throw new Error("Invalid daemon pairing document");
  }
}

/** Extension-background storage. The encrypted credential never appears in a response DTO. */
export class DaemonBearerStore {
  constructor(private readonly keyring: Keyring) {}

  private assertActor(session: number, generation: number): void {
    if (
      !this.keyring.isUnlocked() ||
      this.keyring.getSessionVersion() !== session ||
      this.keyring.getMutationGeneration(DAEMON_BEARERS_KEY) !== generation
    )
      throw new Error("Daemon pairing context changed");
  }

  async pair(
    requestedOrigin: unknown,
    requestedBearer: unknown,
    assertCurrent: () => Promise<void>,
  ): Promise<DaemonBearerRow> {
    const origin = canonicalDaemonBearerOrigin(requestedOrigin);
    const bearer = checkedBearer(requestedBearer);
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
    await assertCurrent();
    this.assertActor(session, generation);
    const revision = crypto.randomUUID();
    const writtenGeneration =
      await this.keyring.updateValueIfGeneration<unknown>(
        DAEMON_BEARERS_KEY,
        generation,
        (current) => {
          const previous = document(current);
          const records = previous.records.filter(
            (item) => item.origin !== origin,
          );
          if (records.length >= 8)
            throw new Error("Daemon pairing limit reached");
          return {
            version: 1,
            records: [...records, { origin, bearer, revision }],
          };
        },
      );
    await assertCurrent();
    this.assertActor(session, writtenGeneration);
    return { origin, revision };
  }

  async list(assertCurrent: () => Promise<void>): Promise<DaemonBearerRow[]> {
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
    await assertCurrent();
    this.assertActor(session, generation);
    const saved = document(
      await this.keyring.getValue<unknown>(DAEMON_BEARERS_KEY),
    );
    await assertCurrent();
    this.assertActor(session, generation);
    return saved.records
      .map(({ origin, revision }) => ({ origin, revision }))
      .sort((a, b) => a.origin.localeCompare(b.origin));
  }

  async clear(
    requestedOrigin: unknown,
    requestedRevision: unknown,
    assertCurrent: () => Promise<void>,
  ): Promise<void> {
    const origin = canonicalDaemonBearerOrigin(requestedOrigin);
    const revision = checkedRevision(requestedRevision);
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
    await assertCurrent();
    this.assertActor(session, generation);
    const writtenGeneration =
      await this.keyring.updateValueIfGeneration<unknown>(
        DAEMON_BEARERS_KEY,
        generation,
        (current) => {
          const previous = document(current);
          const saved = previous.records.find((item) => item.origin === origin);
          if (!saved || saved.revision !== revision)
            throw new Error("Daemon pairing view is stale");
          return {
            version: 1,
            records: previous.records.filter((item) => item.origin !== origin),
          };
        },
      );
    await assertCurrent();
    this.assertActor(session, writtenGeneration);
  }

  /** Internal callback only: no page, popup, or generic credential getter. */
  async withBearer<T>(
    requestedOrigin: unknown,
    assertCurrent: () => Promise<void>,
    fixedOperation: (bearer: string | undefined) => Promise<T>,
  ): Promise<T> {
    const origin = canonicalDaemonBearerOrigin(requestedOrigin);
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(DAEMON_BEARERS_KEY);
    await assertCurrent();
    this.assertActor(session, generation);
    const saved = document(
      await this.keyring.getValue<unknown>(DAEMON_BEARERS_KEY),
    );
    await assertCurrent();
    this.assertActor(session, generation);
    const result = await fixedOperation(
      saved.records.find((item) => item.origin === origin)?.bearer,
    );
    await assertCurrent();
    this.assertActor(session, generation);
    return result;
  }
}
