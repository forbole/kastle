/** Wallet-private, bounded decoders for native MatJam action7 output only. */

const REVIEW_MAGIC = new TextEncoder().encode("MJ3-DIRECT-REVIEW-V1\0");
const SEALED_MAGIC = new TextEncoder().encode("MJ3-DIRECT-SEALED-V1\0");
const STATUS_MAGIC = new TextEncoder().encode("MJ3-DIRECT-SEALED-STATUS-V1\0");
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const I64_MAX = (1n << 63n) - 1n;
const EXPLICIT_TOTAL = 10_000_003n;
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const same = (left: Uint8Array, right: Uint8Array) =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index]);
const nonzero = (bytes: Uint8Array) => bytes.some((byte) => byte !== 0);

function u5(bytes: Uint8Array): number[] {
  const result: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result.push((buffer >> bits) & 31);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits) result.push((buffer << (5 - bits)) & 31);
  return result;
}

/** The canonical mainnet ShieldedOrchard version-9 encoding in ZKas bech32.rs. */
export function raw43ToZkasAddress(raw: Uint8Array): string {
  if (!(raw instanceof Uint8Array) || raw.length !== 43)
    throw new Error("Invalid raw ZKas address length");
  const prefix = "zkas";
  const payload = u5(Uint8Array.from([9, ...raw]));
  let checksum = 1n;
  for (const value of [
    ...Array.from(prefix, (char) => char.charCodeAt(0) & 31),
    0,
    ...payload,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ]) {
    const top = checksum >> 35n;
    checksum = ((checksum & 0x07ffffffffn) << 5n) ^ BigInt(value);
    if (top & 1n) checksum ^= 0x98f2bc8e61n;
    if (top & 2n) checksum ^= 0x79b76d99e2n;
    if (top & 4n) checksum ^= 0xf33e5fb3c4n;
    if (top & 8n) checksum ^= 0xae2eabe2a8n;
    if (top & 16n) checksum ^= 0x1e4f43e470n;
  }
  checksum ^= 1n;
  const checkBytes = new Uint8Array(5);
  for (let i = 4; i >= 0; i--) {
    checkBytes[i] = Number(checksum & 255n);
    checksum >>= 8n;
  }
  return `${prefix}:${[...payload, ...u5(checkBytes)].map((value) => CHARSET[value]).join("")}`;
}

class Cursor {
  private offset = 0;
  constructor(
    private readonly bytes: Uint8Array,
    max: number,
  ) {
    if (!(bytes instanceof Uint8Array) || bytes.length > max)
      throw new Error("Invalid direct action binary length");
  }
  take(length: number): Uint8Array {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.offset + length > this.bytes.length
    )
      throw new Error("Truncated direct action binary");
    const copy = Uint8Array.from(
      this.bytes.subarray(this.offset, this.offset + length),
    );
    this.offset += length;
    return copy;
  }
  magic(expected: Uint8Array): void {
    if (!same(this.take(expected.length), expected))
      throw new Error("Invalid direct action binary version");
  }
  u8(): number {
    return this.take(1)[0];
  }
  u16(): number {
    const b = this.take(2);
    return b[0] * 256 + b[1];
  }
  u64(): bigint {
    let value = 0n;
    for (const byte of this.take(8)) value = (value << 8n) | BigInt(byte);
    return value;
  }
  done(): void {
    if (this.offset !== this.bytes.length)
      throw new Error("Trailing direct action binary bytes");
  }
}

export type NativeDirectReview = {
  token: Uint8Array;
  actionId: string;
  kind: "invite" | "decision" | "text";
  ownerPeerId: string;
  recipientPeerId: string;
  recipientCard: Uint8Array;
  addresses: {
    sender: string;
    peer: string;
    cache: string;
    archive: string;
    collector: string;
  };
  rawAddresses: {
    sender: Uint8Array;
    peer: Uint8Array;
    cache: Uint8Array;
    archive: Uint8Array;
    collector: Uint8Array;
  };
  explicitTotalSompi: string;
  maxNetworkFeeSompi: string;
  maximumTotalSompi: string;
  selectedReviewTipHash: string;
  selectedReviewTipDaa: bigint;
  sourceGeneration: bigint;
  birthHash: string;
  sessionId: string;
  referenceActionId: string | null;
  decision: "accept" | "reject" | null;
  text: string;
};

export function decodeNativeDirectReview(
  raw: Uint8Array,
  expectedCollector: Uint8Array,
): NativeDirectReview {
  if (
    !(expectedCollector instanceof Uint8Array) ||
    expectedCollector.length !== 43
  )
    throw new Error("Direct collector is not configured");
  const cursor = new Cursor(raw, 1024);
  cursor.magic(REVIEW_MAGIC);
  const token = cursor.take(16);
  const action = cursor.take(16);
  const kindByte = cursor.u8();
  const owner = cursor.take(16);
  const peer = cursor.take(16);
  const card = cursor.take(184);
  const sender = cursor.take(43),
    recipient = cursor.take(43);
  const cache = cursor.take(43),
    archive = cursor.take(43),
    collector = cursor.take(43);
  const explicit = cursor.u64(),
    fee = cursor.u64(),
    maximum = cursor.u64();
  const tip = cursor.take(32),
    tipDaa = cursor.u64(),
    generation = cursor.u64();
  const birth = cursor.take(32),
    session = cursor.take(16),
    reference = cursor.take(16);
  const decisionByte = cursor.u8();
  const textLength = cursor.u16();
  if (textLength > (kindByte === 3 ? 216 : 33))
    throw new Error("Invalid direct review text length");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    cursor.take(textLength),
  );
  cursor.done();
  if (
    ![1, 2, 3].includes(kindByte) ||
    !nonzero(token) ||
    !nonzero(action) ||
    !nonzero(owner) ||
    !nonzero(peer) ||
    same(owner, peer) ||
    !nonzero(tip) ||
    !nonzero(birth) ||
    !nonzero(session) ||
    generation === 0n ||
    card[0] !== 3 ||
    !card.subarray(108, 116).every((byte) => byte === 0) ||
    !same(card.subarray(116, 120), Uint8Array.of(255, 255, 255, 255)) ||
    !same(card.subarray(1, 44), recipient) ||
    new Set([
      hex(sender),
      hex(recipient),
      hex(cache),
      hex(archive),
      hex(collector),
    ]).size !== 5 ||
    !same(collector, expectedCollector) ||
    explicit !== EXPLICIT_TOTAL ||
    fee === 0n ||
    maximum > I64_MAX ||
    maximum !== explicit + fee ||
    (kindByte === 1 && (nonzero(reference) || decisionByte !== 255)) ||
    (kindByte === 2 &&
      (!nonzero(reference) || ![0, 1].includes(decisionByte))) ||
    (kindByte === 3 && (!nonzero(reference) || decisionByte !== 255))
  )
    throw new Error("Invalid direct review facts");
  const rawAddresses = { sender, peer: recipient, cache, archive, collector };
  const addresses = {
    sender: raw43ToZkasAddress(sender),
    peer: raw43ToZkasAddress(recipient),
    cache: raw43ToZkasAddress(cache),
    archive: raw43ToZkasAddress(archive),
    collector: raw43ToZkasAddress(collector),
  };
  return {
    token,
    actionId: hex(action),
    kind: kindByte === 1 ? "invite" : kindByte === 2 ? "decision" : "text",
    ownerPeerId: hex(owner),
    recipientPeerId: hex(peer),
    recipientCard: card,
    addresses,
    rawAddresses,
    explicitTotalSompi: explicit.toString(),
    maxNetworkFeeSompi: fee.toString(),
    maximumTotalSompi: maximum.toString(),
    selectedReviewTipHash: hex(tip),
    selectedReviewTipDaa: tipDaa,
    sourceGeneration: generation,
    birthHash: hex(birth),
    sessionId: hex(session),
    referenceActionId: nonzero(reference) ? hex(reference) : null,
    decision:
      decisionByte === 255 ? null : decisionByte === 1 ? "accept" : "reject",
    text,
  };
}

export type NativeDirectSealed = {
  actionId: string;
  approvedCard: Uint8Array;
  idempotencyKey: string;
  commitment: string;
  fanoutDigest: string;
  exactDigest: string;
  explicitTotalSompi: string;
  maxNetworkFeeSompi: string;
  maximumTotalSompi: string;
  outputs: Array<{
    role: "peer" | "cache" | "archive" | "collector";
    recipient: string;
    rawAddress: Uint8Array;
    amountSompi: string;
    memo: Uint8Array;
  }>;
};

export function decodeNativeDirectSealed(
  raw: Uint8Array,
  review: NativeDirectReview,
): NativeDirectSealed {
  const cursor = new Cursor(raw, 3000);
  cursor.magic(SEALED_MAGIC);
  const action = cursor.take(16),
    card = cursor.take(184);
  const idempotency = cursor.take(32),
    commitment = cursor.take(32);
  const fanout = cursor.take(32),
    exact = cursor.take(32);
  const explicit = cursor.u64(),
    fee = cursor.u64(),
    maximum = cursor.u64();
  const count = cursor.u8();
  if (count !== 4) throw new Error("Invalid direct output count");
  const outputs: NativeDirectSealed["outputs"] = [];
  const expected = [
    review.rawAddresses.peer,
    review.rawAddresses.cache,
    review.rawAddresses.archive,
    review.rawAddresses.collector,
  ];
  const roles = ["peer", "cache", "archive", "collector"] as const;
  for (let i = 0; i < 4; i++) {
    const role = cursor.u8(),
      address = cursor.take(43),
      amount = cursor.u64();
    const memo = cursor.take(512);
    if (
      role !== i + 1 ||
      !same(address, expected[i]) ||
      amount !== (i === 3 ? 10_000_000n : 1n) ||
      (i === 3
        ? memo.some((byte) => byte !== 0)
        : !same(memo.subarray(0, 4), Uint8Array.of(77, 74, 51, 58)))
    )
      throw new Error("Invalid direct official output");
    outputs.push({
      role: roles[i],
      recipient: raw43ToZkasAddress(address),
      rawAddress: address,
      amountSompi: amount.toString(),
      memo,
    });
  }
  cursor.done();
  if (
    hex(action) !== review.actionId ||
    !same(card, review.recipientCard) ||
    ![idempotency, commitment, fanout, exact].every(nonzero) ||
    explicit !== EXPLICIT_TOTAL ||
    explicit.toString() !== review.explicitTotalSompi ||
    fee.toString() !== review.maxNetworkFeeSompi ||
    maximum.toString() !== review.maximumTotalSompi ||
    maximum !== explicit + fee ||
    maximum > I64_MAX
  )
    throw new Error("Sealed direct action differs from approved review");
  return {
    actionId: hex(action),
    approvedCard: card,
    idempotencyKey: hex(idempotency),
    commitment: hex(commitment),
    fanoutDigest: hex(fanout),
    exactDigest: hex(exact),
    explicitTotalSompi: explicit.toString(),
    maxNetworkFeeSompi: fee.toString(),
    maximumTotalSompi: maximum.toString(),
    outputs,
  };
}

export function decodeNativeDirectSealedStatus(raw: Uint8Array): {
  actionId: string;
  idempotencyKey: string;
  exactDigest: string;
} {
  const cursor = new Cursor(raw, 128);
  cursor.magic(STATUS_MAGIC);
  const action = cursor.take(16),
    idempotency = cursor.take(32),
    exact = cursor.take(32);
  cursor.done();
  if (![action, idempotency, exact].every(nonzero))
    throw new Error("Invalid direct sealed status");
  return {
    actionId: hex(action),
    idempotencyKey: hex(idempotency),
    exactDigest: hex(exact),
  };
}
