import { expect, test } from "@playwright/test";
import {
  decodeNativeDirectView,
  witnessDirectBirth,
  witnessReviewedCursor,
} from "../lib/zkas/direct-receive-codec";

const genesis =
  "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f";
const after = "11".repeat(32);
const tip = "22".repeat(32);
const raw = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function page() {
  return {
    version: 1,
    encoding: "hex-compact-148-v1",
    request: { after, limit: 1 },
    source: {
      generation: "9007199254740993",
      configuredNetwork: "mainnet",
      observedNetwork: "mainnet",
      configuredGenesis: genesis,
      syncBefore: true,
      syncAfter: true,
    },
    tipBefore: {
      hash: tip,
      daa: "9007199254740993",
      blueScore: "9007199254740993",
    },
    floor: {
      servedCheckpointHash: after,
      servedCheckpointDaa: "1",
      historyFromDaa: "1",
      historyComplete: false,
    },
    page: {
      reorged: false,
      sinkBlueScore: "9007199254740993",
      protocolEvidence: "id-bearing-actions-observed",
      blocks: [{}],
    },
    tipAfter: {
      hash: tip,
      daa: "9007199254740993",
      blueScore: "9007199254740993",
    },
  };
}

test("a stable trusted selected response yields exact u64 birth metadata", () => {
  const birth = witnessDirectBirth(raw(page()), after, 1, genesis);
  expect(birth).toEqual({
    hash: tip,
    daa: 9007199254740993n,
    blue: 9007199254740993n,
    sourceGeneration: 9007199254740993n,
  });
});

test("moving, unsynced, reorged, unrelated, or imprecise birth replies cannot enroll", () => {
  for (const change of [
    (p: ReturnType<typeof page>) => {
      p.tipAfter.hash = "33".repeat(32);
    },
    (p: ReturnType<typeof page>) => {
      p.source.syncAfter = false;
    },
    (p: ReturnType<typeof page>) => {
      p.page.reorged = true;
    },
    (p: ReturnType<typeof page>) => {
      p.request.after = "44".repeat(32);
    },
    (p: ReturnType<typeof page>) => {
      p.source.generation = "9007199254740993.0";
    },
    (p: ReturnType<typeof page>) => {
      p.source.observedNetwork = "testnet";
    },
    (p: ReturnType<typeof page>) => {
      p.page.blocks = [];
    },
  ]) {
    const value = page();
    change(value);
    expect(() => witnessDirectBirth(raw(value), after, 1, genesis)).toThrow();
  }
});

test("a reviewed cursor may stay selected while the current tip grows", () => {
  const response = page();
  response.tipAfter.hash = "55".repeat(32);
  response.tipAfter.daa = "9007199254740994";
  response.tipAfter.blueScore = "9007199254740994";
  expect(
    witnessReviewedCursor(raw(response), after, 4n, 9007199254740993n, genesis)
      .hash,
  ).toBe(after);
  expect(() => witnessDirectBirth(raw(response), after, 1, genesis)).toThrow();
  expect(() =>
    witnessReviewedCursor(raw(response), after, 4n, 1n, genesis),
  ).toThrow();
  expect(() =>
    witnessReviewedCursor(raw(response), after, 0n, 9007199254740993n, genesis),
  ).toThrow();
});

test("native view decoder rejects trailing, truncated, malformed and oversized data", () => {
  const prefix = new TextEncoder().encode("MJ3-DIRECT-SESSION-V2\0");
  const bytes = new Uint8Array(
    prefix.length + 16 + 32 + 8 + 32 + 8 + 8 + 16 + 2 + 2 + 2,
  );
  bytes.set(prefix);
  const decoded = decodeNativeDirectView(bytes);
  expect(decoded.sessionId).toBe("00".repeat(16));
  expect(decoded.messages).toEqual([]);
  expect(() => decodeNativeDirectView(bytes.subarray(0, -1))).toThrow();
  expect(() =>
    decodeNativeDirectView(Uint8Array.from([...bytes, 0])),
  ).toThrow();
  const invalid = Uint8Array.from(bytes);
  invalid[0] ^= 1;
  expect(() => decodeNativeDirectView(invalid)).toThrow();
});
