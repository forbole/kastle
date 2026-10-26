import { blake3 } from "@noble/hashes/blake3";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils";

// KCC-1 primitives for the KCC-20 standard family. Pure; nothing here touches the KRON SDK.

export const INT_MAX = 2n ** 63n - 1n;

const SIGN_BIT = 0x80;

/** KCC-1 `Hash`: unkeyed BLAKE3, 32 bytes. (The P2SH envelope alone uses BLAKE2b.) */
export function hash(data: Uint8Array): Uint8Array {
  return blake3(data);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function lengthPrefixed(bytes: Uint8Array): Uint8Array {
  const n = bytes.length;
  if (n <= 75) return concatBytes(Uint8Array.of(n), bytes);
  if (n <= 0xff) return concatBytes(Uint8Array.of(0x4c, n), bytes);
  if (n <= 0xffff) {
    return concatBytes(Uint8Array.of(0x4d, n & 0xff, n >> 8), bytes);
  }
  if (n <= 0xffffffff) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, n, true);
    return concatBytes(Uint8Array.of(0x4e), len, bytes);
  }
  throw new Error("push payload too large");
}

/** KCC-1 §3.4.2 PushMinimal: invocation arguments. */
export function pushMinimal(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) return Uint8Array.of(0x00);
  if (bytes.length === 1 && bytes[0] >= 0x01 && bytes[0] <= 0x10) {
    return Uint8Array.of(0x50 + bytes[0]);
  }
  if (bytes.length === 1 && bytes[0] === 0x81) return Uint8Array.of(0x4f);
  return lengthPrefixed(bytes);
}

/** KCC-1 §3.4.2 PushExplicit: state fields. Length-based forms only, so `01` is `0101`, never OP_1. */
export function pushExplicit(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 0) return Uint8Array.of(0x00);
  return lengthPrefixed(bytes);
}

function assertIntRange(v: bigint) {
  if (v > INT_MAX || v < -INT_MAX) {
    throw new Error(`int ${v} is outside -(2^63-1)..2^63-1`);
  }
}

/** State-payload `int`: 8-byte little-endian signed-magnitude (bit 63 is the sign). */
export function encodeIntState(v: bigint): Uint8Array {
  assertIntRange(v);
  const out = new Uint8Array(8);
  let magnitude = v < 0n ? -v : v;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(magnitude & 0xffn);
    magnitude >>= 8n;
  }
  if (v < 0n) out[7] |= SIGN_BIT;
  return out;
}

/** Inverse of `encodeIntState`. Negative zero decodes to 0n; callers that must reject it check the sign bit. */
export function decodeIntState(bytes: Uint8Array): bigint {
  if (bytes.length !== 8) throw new Error("state int must be 8 bytes");
  let magnitude = BigInt(bytes[7] & ~SIGN_BIT);
  for (let i = 6; i >= 0; i--) magnitude = (magnitude << 8n) | BigInt(bytes[i]);
  return bytes[7] & SIGN_BIT ? -magnitude : magnitude;
}

export function isNegativeIntState(bytes: Uint8Array): boolean {
  return bytes.length === 8 && (bytes[7] & SIGN_BIT) !== 0;
}

/** Minimal ScriptNum bytes: little-endian magnitude, sign in the top bit of the last byte, 0 → empty. */
export function scriptNumMinimal(v: bigint): Uint8Array {
  assertIntRange(v);
  if (v === 0n) return new Uint8Array();
  const out: number[] = [];
  let magnitude = v < 0n ? -v : v;
  while (magnitude > 0n) {
    out.push(Number(magnitude & 0xffn));
    magnitude >>= 8n;
  }
  if (out[out.length - 1] & SIGN_BIT) out.push(v < 0n ? SIGN_BIT : 0x00);
  else if (v < 0n) out[out.length - 1] |= SIGN_BIT;
  return Uint8Array.from(out);
}

/** Invocation-argument `int`: PushMinimal over the minimal ScriptNum. */
export function encodeScriptNumArg(v: bigint): Uint8Array {
  return pushMinimal(scriptNumMinimal(v));
}

/** `Hash(UTF8(signature))[0:4]`, with record names already erased to `{f1,f2,...}` in `signature`. */
export function dispatchTag(functionSignature: string): Uint8Array {
  return hash(utf8ToBytes(functionSignature)).slice(0, 4);
}
