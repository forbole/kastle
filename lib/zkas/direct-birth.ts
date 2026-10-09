import type { Keyring } from "@/lib/keyring-manager";
import type { HistoryGrantContext } from "./history-grant";
import type { DirectBirthWitness } from "./direct-receive-codec";

export const DIRECT_BIRTHS_KEY = "zkasDirectBirths" as const;
const HASH = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const U64 = (1n << 64n) - 1n;

type Birth = {
  walletId: string;
  accountIndex: number;
  address0: string;
  genesis: string;
  daemonUrl: string;
  indexUrl: string;
  birthHash: string;
  birthDaa: string;
  birthBlue: string;
  originalSourceGeneration: string;
  sessionId: string;
};
type Document = { version: 1; records: Birth[] };

function checked(value: unknown): Document {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved direct-chat starting point");
  const document = value as Record<string, unknown>;
  if (
    Object.keys(document).sort().join("|") !== "records|version" ||
    document.version !== 1 ||
    !Array.isArray(document.records) ||
    document.records.length > 32
  )
    throw new Error("Invalid saved direct-chat starting point");
  const keys = new Set<string>();
  const records = document.records.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid saved direct-chat starting point");
    const row = raw as Record<string, unknown>;
    if (
      Object.keys(row).sort().join("|") !==
        "accountIndex|address0|birthBlue|birthDaa|birthHash|daemonUrl|genesis|indexUrl|originalSourceGeneration|sessionId|walletId" ||
      typeof row.walletId !== "string" ||
      row.walletId.length < 1 ||
      row.walletId.length > 128 ||
      !Number.isSafeInteger(row.accountIndex) ||
      (row.accountIndex as number) < 0 ||
      (row.accountIndex as number) > 0x7fffffff ||
      typeof row.address0 !== "string" ||
      !/^zkas:[a-z0-9]{1,115}$/.test(row.address0) ||
      typeof row.genesis !== "string" ||
      !HASH.test(row.genesis) ||
      typeof row.daemonUrl !== "string" ||
      row.daemonUrl.length > 256 ||
      typeof row.indexUrl !== "string" ||
      row.indexUrl.length > 256 ||
      typeof row.birthHash !== "string" ||
      !HASH.test(row.birthHash) ||
      typeof row.sessionId !== "string" ||
      !/^[0-9a-f]{32}$/.test(row.sessionId)
    )
      throw new Error("Invalid saved direct-chat starting point");
    for (const name of [
      "birthDaa",
      "birthBlue",
      "originalSourceGeneration",
    ] as const) {
      const number = row[name];
      if (
        typeof number !== "string" ||
        !DECIMAL.test(number) ||
        BigInt(number) > U64
      )
        throw new Error("Invalid saved direct-chat starting point");
    }
    const key = `${row.walletId}:${row.accountIndex}`;
    if (keys.has(key)) throw new Error("Duplicate direct-chat starting point");
    keys.add(key);
    return row as Birth;
  });
  return { version: 1, records };
}

function account(row: Birth, ctx: HistoryGrantContext): boolean {
  return row.walletId === ctx.walletId && row.accountIndex === ctx.accountIndex;
}
function source(row: Birth, ctx: HistoryGrantContext): boolean {
  return (
    account(row, ctx) &&
    row.address0 === ctx.address0 &&
    row.genesis === ctx.genesis &&
    row.daemonUrl === ctx.daemonUrl &&
    row.indexUrl === ctx.indexUrl
  );
}

export class DirectBirthStore {
  private readonly keyring: Keyring;
  constructor(keyring: Keyring) {
    this.keyring = keyring;
  }

  async read(
    ctx: HistoryGrantContext,
    assertCurrent: () => Promise<void>,
  ): Promise<Birth | undefined> {
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(DIRECT_BIRTHS_KEY);
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    await assertCurrent();
    const value = await this.keyring.getValue<unknown>(DIRECT_BIRTHS_KEY);
    await assertCurrent();
    if (
      !this.keyring.isUnlocked() ||
      this.keyring.getSessionVersion() !== session ||
      this.keyring.getMutationGeneration(DIRECT_BIRTHS_KEY) !== generation
    )
      throw new Error("Direct-chat starting point changed");
    const found =
      value === null
        ? undefined
        : checked(value).records.find((row) => account(row, ctx));
    if (found && !source(found, ctx))
      throw new Error("Direct-chat source changed");
    return found;
  }

  async enroll(
    ctx: HistoryGrantContext,
    witness: DirectBirthWitness,
    assertCurrent: () => Promise<void>,
  ): Promise<Birth> {
    const existing = await this.read(ctx, assertCurrent);
    if (existing) return existing;
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(DIRECT_BIRTHS_KEY);
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    const sessionId = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    if (/^0+$/.test(sessionId))
      throw new Error("Direct-chat session unavailable");
    const proposed: Birth = {
      walletId: ctx.walletId,
      accountIndex: ctx.accountIndex,
      address0: ctx.address0,
      genesis: ctx.genesis,
      daemonUrl: ctx.daemonUrl,
      indexUrl: ctx.indexUrl,
      birthHash: witness.hash,
      birthDaa: witness.daa.toString(),
      birthBlue: witness.blue.toString(),
      originalSourceGeneration: witness.sourceGeneration.toString(),
      sessionId,
    };
    await assertCurrent();
    await this.keyring.updateValueIfGeneration<unknown>(
      DIRECT_BIRTHS_KEY,
      generation,
      (current) => {
        if (
          !this.keyring.isUnlocked() ||
          this.keyring.getSessionVersion() !== session
        )
          throw new Error("Direct-chat account changed");
        const doc =
          current === null
            ? { version: 1 as const, records: [] }
            : checked(current);
        const existing = doc.records.find((row) => account(row, ctx));
        if (existing) {
          if (!source(existing, ctx))
            throw new Error("Direct-chat source changed");
          return doc;
        }
        if (doc.records.length >= 32)
          throw new Error("Direct-chat starting point capacity exceeded");
        return checked({ version: 1, records: [...doc.records, proposed] });
      },
    );
    await assertCurrent();
    const saved = await this.read(ctx, assertCurrent);
    if (!saved) throw new Error("Direct-chat starting point unavailable");
    return saved;
  }
}
