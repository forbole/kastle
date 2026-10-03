import type { Keyring } from "@/lib/keyring-manager";
import type { HistoryGrantContext } from "./history-grant";

export const DIRECT_PINS_KEY = "zkasDirectPins" as const;
const HASH = /^[0-9a-f]{64}$/;
const SESSION = /^[0-9a-f]{32}$/;
const PEER = /^[0-9a-f]{32}$/;
const CARD = /^[0-9a-f]{368}$/;
const U64 = (1n << 64n) - 1n;
const DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const hex = (data: Uint8Array) =>
  Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
const bytes = (value: string) =>
  Uint8Array.from(value.match(/../g)!, (pair) => Number.parseInt(pair, 16));

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
type Approved = {
  recipientCard: Uint8Array;
  recipientPeerId: Uint8Array;
  birthHash: Uint8Array;
  sessionId: Uint8Array;
  sourceGeneration: bigint;
};
type RecordPin = { peerId: string; card: string };
type Trial = {
  walletId: string;
  accountIndex: number;
  address0: string;
  genesis: string;
  protocolId: "matjam-onchain-v3";
  daemonUrl: string;
  indexUrl: string;
  birthHash: string;
  birthDaa: string;
  birthBlue: string;
  sessionId: string;
  originalSourceGeneration: string;
  pins: RecordPin[];
};
type Document = { version: 1; trials: Trial[] };

function trialOf(ctx: HistoryGrantContext, birth: Birth): Omit<Trial, "pins"> {
  if (
    ctx.network !== "mainnet" ||
    !HASH.test(ctx.genesis) ||
    birth.walletId !== ctx.walletId ||
    birth.accountIndex !== ctx.accountIndex ||
    birth.address0 !== ctx.address0 ||
    birth.genesis !== ctx.genesis ||
    birth.daemonUrl !== ctx.daemonUrl ||
    birth.indexUrl !== ctx.indexUrl ||
    !HASH.test(birth.birthHash) ||
    !DECIMAL.test(birth.birthDaa) ||
    BigInt(birth.birthDaa) > U64 ||
    !DECIMAL.test(birth.birthBlue) ||
    BigInt(birth.birthBlue) > U64 ||
    !SESSION.test(birth.sessionId) ||
    !/^(0|[1-9][0-9]{0,19})$/.test(birth.originalSourceGeneration) ||
    BigInt(birth.originalSourceGeneration) > U64
  )
    throw new Error("Direct-chat trial changed");
  return {
    walletId: ctx.walletId,
    accountIndex: ctx.accountIndex,
    address0: ctx.address0,
    genesis: ctx.genesis,
    protocolId: "matjam-onchain-v3",
    daemonUrl: ctx.daemonUrl,
    indexUrl: ctx.indexUrl,
    birthHash: birth.birthHash,
    birthDaa: birth.birthDaa,
    birthBlue: birth.birthBlue,
    sessionId: birth.sessionId,
    originalSourceGeneration: birth.originalSourceGeneration,
  };
}

function sameTrial(
  left: Omit<Trial, "pins">,
  right: Omit<Trial, "pins">,
): boolean {
  return Object.keys(left).every(
    (key) =>
      left[key as keyof typeof left] === right[key as keyof typeof right],
  );
}

function checked(value: unknown): Document {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid saved direct-chat pins");
  const document = value as Record<string, unknown>;
  if (
    Object.keys(document).sort().join("|") !== "trials|version" ||
    document.version !== 1 ||
    !Array.isArray(document.trials) ||
    document.trials.length > 32
  )
    throw new Error("Invalid saved direct-chat pins");
  const accounts = new Set<string>();
  const trials = document.trials.map((raw: unknown) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid saved direct-chat pins");
    const row = raw as Record<string, unknown>;
    if (
      Object.keys(row).sort().join("|") !==
        "accountIndex|address0|birthBlue|birthDaa|birthHash|daemonUrl|genesis|indexUrl|originalSourceGeneration|pins|protocolId|sessionId|walletId" ||
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
      row.protocolId !== "matjam-onchain-v3" ||
      typeof row.daemonUrl !== "string" ||
      row.daemonUrl.length > 256 ||
      typeof row.indexUrl !== "string" ||
      row.indexUrl.length > 256 ||
      typeof row.birthHash !== "string" ||
      !HASH.test(row.birthHash) ||
      typeof row.birthDaa !== "string" ||
      !DECIMAL.test(row.birthDaa) ||
      BigInt(row.birthDaa) > U64 ||
      typeof row.birthBlue !== "string" ||
      !DECIMAL.test(row.birthBlue) ||
      BigInt(row.birthBlue) > U64 ||
      typeof row.sessionId !== "string" ||
      !SESSION.test(row.sessionId) ||
      typeof row.originalSourceGeneration !== "string" ||
      !/^(0|[1-9][0-9]{0,19})$/.test(row.originalSourceGeneration) ||
      BigInt(row.originalSourceGeneration) > U64 ||
      !Array.isArray(row.pins) ||
      row.pins.length > 128
    )
      throw new Error("Invalid saved direct-chat pins");
    const account = `${row.walletId}:${row.accountIndex}`;
    if (accounts.has(account))
      throw new Error("Duplicate direct-chat pin trial");
    accounts.add(account);
    const peers = new Set<string>();
    const pins = row.pins.map((rawPin: unknown) => {
      if (!rawPin || typeof rawPin !== "object" || Array.isArray(rawPin))
        throw new Error("Invalid saved direct-chat pins");
      const pin = rawPin as Record<string, unknown>;
      if (
        Object.keys(pin).sort().join("|") !== "card|peerId" ||
        typeof pin.peerId !== "string" ||
        !PEER.test(pin.peerId) ||
        typeof pin.card !== "string" ||
        !CARD.test(pin.card) ||
        peers.has(pin.peerId)
      )
        throw new Error("Invalid saved direct-chat pins");
      peers.add(pin.peerId);
      return pin as RecordPin;
    });
    return { ...row, pins } as Trial;
  });
  if (trials.reduce((sum, trial) => sum + trial.pins.length, 0) > 128)
    throw new Error("Direct-chat pin capacity exceeded");
  return { version: 1, trials };
}

async function derivedPeer(genesis: string, card: Uint8Array): Promise<string> {
  const protocol = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("matjam-onchain-v3"),
    ),
  );
  const input = new Uint8Array(96);
  input.set(bytes(genesis));
  input.set(protocol, 32);
  input.set(card.subarray(44, 76), 64);
  return hex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", input)).subarray(
      0,
      16,
    ),
  );
}

/** Private keyring store; the caller must hold a native-approved review stamp. */
export class DirectPinStore {
  private readonly keyring: Keyring;
  constructor(keyring: Keyring) {
    this.keyring = keyring;
  }

  async read(
    ctx: HistoryGrantContext,
    birth: Birth,
    assertCurrent: () => Promise<void>,
  ): Promise<Uint8Array[]> {
    const wanted = trialOf(ctx, birth);
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(DIRECT_PINS_KEY);
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    await assertCurrent();
    const value = await this.keyring.getValue<unknown>(DIRECT_PINS_KEY);
    await assertCurrent();
    if (
      !this.keyring.isUnlocked() ||
      this.keyring.getSessionVersion() !== session ||
      this.keyring.getMutationGeneration(DIRECT_PINS_KEY) !== generation
    )
      throw new Error("Direct-chat pins changed");
    if (value === null) return [];
    const found = checked(value).trials.find(
      (trial) =>
        trial.walletId === wanted.walletId &&
        trial.accountIndex === wanted.accountIndex,
    );
    if (!found) return [];
    const { pins, ...identity } = found;
    if (!sameTrial(identity, wanted))
      throw new Error("Direct-chat pin trial changed");
    for (const pin of pins)
      if ((await derivedPeer(ctx.genesis, bytes(pin.card))) !== pin.peerId)
        throw new Error("Invalid saved direct-chat pin identity");
    await assertCurrent();
    if (
      this.keyring.getSessionVersion() !== session ||
      this.keyring.getMutationGeneration(DIRECT_PINS_KEY) !== generation
    )
      throw new Error("Direct-chat pins changed");
    return pins.map((pin) => bytes(pin.card));
  }

  async recordNativeApproved(
    ctx: HistoryGrantContext,
    birth: Birth,
    approved: Approved,
    sourceGeneration: bigint,
    assertCurrent: () => Promise<void>,
  ): Promise<void> {
    const wanted = trialOf(ctx, birth);
    if (
      sourceGeneration < 0n ||
      sourceGeneration > U64 ||
      approved.sourceGeneration !== sourceGeneration ||
      !(approved.recipientCard instanceof Uint8Array) ||
      approved.recipientCard.length !== 184 ||
      !(approved.recipientPeerId instanceof Uint8Array) ||
      approved.recipientPeerId.length !== 16 ||
      !(approved.birthHash instanceof Uint8Array) ||
      hex(approved.birthHash) !== birth.birthHash ||
      !(approved.sessionId instanceof Uint8Array) ||
      hex(approved.sessionId) !== birth.sessionId
    )
      throw new Error("Direct-chat native review changed");
    const card = hex(approved.recipientCard);
    const peerId = hex(approved.recipientPeerId);
    if ((await derivedPeer(ctx.genesis, approved.recipientCard)) !== peerId)
      throw new Error("Direct-chat native peer changed");
    const session = this.keyring.getSessionVersion();
    const generation = this.keyring.getMutationGeneration(DIRECT_PINS_KEY);
    if (!this.keyring.isUnlocked()) throw new Error("Unlock Kastle first");
    await assertCurrent();
    await this.keyring.updateValueIfGeneration<unknown>(
      DIRECT_PINS_KEY,
      generation,
      async (current) => {
        await assertCurrent();
        if (
          !this.keyring.isUnlocked() ||
          this.keyring.getSessionVersion() !== session
        )
          throw new Error("Direct-chat account changed");
        const doc =
          current === null
            ? { version: 1 as const, trials: [] as Trial[] }
            : checked(current);
        let trial = doc.trials.find(
          (row) =>
            row.walletId === wanted.walletId &&
            row.accountIndex === wanted.accountIndex,
        );
        if (trial) {
          const { pins, ...identity } = trial;
          if (!sameTrial(identity, wanted))
            throw new Error("Direct-chat pin trial changed");
          const existing = pins.find((pin) => pin.peerId === peerId);
          if (existing) {
            if (existing.card !== card)
              throw new Error("Conflicting direct-chat peer card");
            return doc;
          }
        } else {
          if (doc.trials.length >= 32)
            throw new Error("Direct-chat pin trial capacity exceeded");
          trial = { ...wanted, pins: [] };
          doc.trials.push(trial);
        }
        if (doc.trials.reduce((sum, row) => sum + row.pins.length, 0) >= 128)
          throw new Error("Direct-chat pin capacity exceeded");
        trial.pins.push({ peerId, card });
        return checked(doc);
      },
    );
  }
}
