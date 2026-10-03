/** Wallet-private decoding of the pinned native direct-session view. */
const PREFIX = new TextEncoder().encode("MJ3-DIRECT-SESSION-V2\0");
const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL = /^(0|[1-9][0-9]{0,19})$/;
const MAX_U64 = (1n << 64n) - 1n;

export type DirectBirthWitness = {
  hash: string;
  daa: bigint;
  blue: bigint;
  sourceGeneration: bigint;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid selected history response");
  return value as Record<string, unknown>;
}

function decimal(value: unknown): bigint {
  if (typeof value !== "string" || !DECIMAL.test(value))
    throw new Error("Invalid selected history integer");
  const number = BigInt(value);
  if (number > MAX_U64) throw new Error("Invalid selected history integer");
  return number;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HEX64.test(value) || /^0+$/.test(value))
    throw new Error("Invalid selected history hash");
  return value;
}

function tip(value: unknown): { hash: string; daa: bigint; blue: bigint } {
  const fields = record(value);
  if (Object.keys(fields).sort().join("|") !== "blueScore|daa|hash")
    throw new Error("Invalid selected history tip");
  return {
    hash: hash(fields.hash),
    daa: decimal(fields.daa),
    blue: decimal(fields.blueScore),
  };
}

/** A trusted fixed daemon's stable selected tip, scoped to an exact request. */
function selectedWitness(
  raw: Uint8Array,
  after: string,
  limit: number,
  genesis: string,
  stable: boolean,
  cursorDaa?: bigint,
): DirectBirthWitness {
  if (raw.length > 6 * 1024 * 1024 || !HEX64.test(after) || limit !== 1)
    throw new Error("Invalid selected history request");
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new Error("Invalid selected history response");
  }
  const page = record(decoded);
  if (
    Object.keys(page).sort().join("|") !==
      "encoding|floor|page|request|source|tipAfter|tipBefore|version" ||
    page.version !== 1 ||
    page.encoding !== "hex-compact-148-v1"
  )
    throw new Error("Invalid selected history response");
  const request = record(page.request);
  const source = record(page.source);
  const body = record(page.page);
  const floor = record(page.floor);
  if (
    Object.keys(request).sort().join("|") !== "after|limit" ||
    request.after !== after ||
    request.limit !== limit ||
    Object.keys(source).sort().join("|") !==
      "configuredGenesis|configuredNetwork|generation|observedNetwork|syncAfter|syncBefore" ||
    source.configuredGenesis !== genesis ||
    source.configuredNetwork !== "mainnet" ||
    source.observedNetwork !== "mainnet" ||
    source.syncBefore !== true ||
    source.syncAfter !== true ||
    Object.keys(body).sort().join("|") !==
      "blocks|protocolEvidence|reorged|sinkBlueScore" ||
    body.reorged !== false ||
    !Array.isArray(body.blocks) ||
    body.blocks.length > 1 ||
    (body.blocks.length === 0 && body.protocolEvidence !== "unknown") ||
    !["unknown", "id-bearing-actions-observed"].includes(
      String(body.protocolEvidence),
    ) ||
    Object.keys(floor).sort().join("|") !==
      "historyComplete|historyFromDaa|servedCheckpointDaa|servedCheckpointHash" ||
    typeof floor.historyComplete !== "boolean"
  )
    throw new Error("Selected history unavailable");
  const served = decimal(floor.servedCheckpointDaa);
  decimal(floor.historyFromDaa);
  hash(floor.servedCheckpointHash);
  decimal(body.sinkBlueScore);
  const before = tip(page.tipBefore);
  const afterTip = tip(page.tipAfter);
  if (
    (stable &&
      (before.hash !== afterTip.hash ||
        before.daa !== afterTip.daa ||
        before.blue !== afterTip.blue)) ||
    (before.hash === afterTip.hash &&
      (before.daa !== afterTip.daa || before.blue !== afterTip.blue)) ||
    afterTip.daa < before.daa ||
    afterTip.blue < before.blue ||
    served > before.daa ||
    (cursorDaa !== undefined &&
      (served > cursorDaa || before.daa < cursorDaa)) ||
    (body.blocks.length === 0 && after !== before.hash)
  )
    throw new Error("Selected history tip moved");
  const sourceGeneration = decimal(source.generation);
  if (sourceGeneration === 0n)
    throw new Error("Selected history source unavailable");
  return { ...before, sourceGeneration };
}

export function witnessDirectBirth(
  raw: Uint8Array,
  after: string,
  limit: number,
  genesis: string,
): DirectBirthWitness {
  return selectedWitness(raw, after, limit, genesis, true);
}

/** Recheck a wallet-retained reviewed cursor against the current selected source. */
export function witnessReviewedCursor(
  raw: Uint8Array,
  reviewedHash: string,
  reviewedDaa: bigint,
  reviewedGeneration: bigint,
  genesis: string,
): DirectBirthWitness {
  const witness = selectedWitness(
    raw,
    reviewedHash,
    1,
    genesis,
    false,
    reviewedDaa,
  );
  if (
    witness.sourceGeneration !== reviewedGeneration ||
    witness.daa < reviewedDaa ||
    (witness.hash === reviewedHash && witness.daa !== reviewedDaa)
  )
    throw new Error("Reviewed direct-chat cursor changed");
  return {
    hash: reviewedHash,
    daa: reviewedDaa,
    blue: 0n,
    sourceGeneration: reviewedGeneration,
  };
}

export type NativeDirectView = {
  sessionId: string;
  birthHash: string;
  birthDaa: bigint;
  tipHash: string;
  tipDaa: bigint;
  sourceGeneration: bigint;
  invitations: Array<{
    inviterId: string;
    actionId: string;
    publicCard: string;
    note: string;
    status: "pending";
  }>;
  contacts: Array<{
    peerId: string;
    publicCard: string;
    status: "request" | "accepted" | "rejected";
  }>;
  messages: Array<{
    counterpartId: string;
    senderId: string;
    actionId: string;
    text: string;
  }>;
};

/** Native output only. Never call with page-supplied bytes. */
export function decodeNativeDirectView(raw: Uint8Array): NativeDirectView {
  if (!(raw instanceof Uint8Array) || raw.length > 512_000)
    throw new Error("Invalid direct view");
  let offset = 0;
  const take = (length: number) => {
    if (length < 0 || offset + length > raw.length)
      throw new Error("Invalid direct view");
    const slice = raw.subarray(offset, offset + length);
    offset += length;
    return slice;
  };
  const hex = (length: number) =>
    Array.from(take(length), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  const u8 = () => take(1)[0];
  const u16 = () => {
    const b = take(2);
    return b[0] * 256 + b[1];
  };
  const u32 = () => {
    const b = take(4);
    return b[0] * 0x1000000 + (b[1] << 16) + (b[2] << 8) + b[3];
  };
  const u64 = () => {
    let value = 0n;
    for (const b of take(8)) value = (value << 8n) | BigInt(b);
    return value;
  };
  const text = (max: number) => {
    const size = u16();
    if (size > max) throw new Error("Invalid direct text");
    return new TextDecoder("utf-8", { fatal: true }).decode(take(size));
  };
  if (!PREFIX.every((byte, index) => raw[index] === byte))
    throw new Error("Invalid direct view version");
  take(PREFIX.length);
  const sessionId = hex(16),
    birthHash = hex(32),
    birthDaa = u64();
  const tipHash = hex(32),
    tipDaa = u64(),
    sourceGeneration = u64();
  u32();
  u32();
  u32();
  u32(); // Private diagnostics; no page authority.
  const invitationCount = u16();
  if (invitationCount > 32) throw new Error("Direct view capacity exceeded");
  const invitations: NativeDirectView["invitations"] = [];
  for (let i = 0; i < invitationCount; i++)
    invitations.push({
      inviterId: hex(16),
      actionId: hex(16),
      publicCard: hex(184),
      note: text(33),
      status: "pending",
    });
  const contactCount = u16();
  if (contactCount > 64) throw new Error("Direct view capacity exceeded");
  const contacts: NativeDirectView["contacts"] = [];
  for (let i = 0; i < contactCount; i++) {
    const peerId = hex(16),
      publicCard = hex(184),
      status = u8();
    if (status > 3) throw new Error("Invalid direct contact");
    contacts.push({
      peerId,
      publicCard,
      status: status === 2 ? "accepted" : status === 3 ? "rejected" : "request",
    });
  }
  const messageCount = u16();
  if (messageCount > 2048) throw new Error("Direct view capacity exceeded");
  const messages: NativeDirectView["messages"] = [];
  for (let i = 0; i < messageCount; i++)
    messages.push({
      counterpartId: hex(16),
      senderId: hex(16),
      actionId: hex(16),
      text: text(216),
    });
  if (offset !== raw.length)
    throw new Error("Invalid direct view trailing bytes");
  return {
    sessionId,
    birthHash,
    birthDaa,
    tipHash,
    tipDaa,
    sourceGeneration,
    invitations,
    contacts,
    messages,
  };
}
