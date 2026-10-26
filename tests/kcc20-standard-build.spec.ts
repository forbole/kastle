import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { client, curve, spend } from "@kronsdk/kron-sdk";
import {
  patchPlaceholder,
  schnorrSighash,
  verifyFundingSignature,
} from "@dotk/sdk-tx";
import { schnorr } from "@noble/curves/secp256k1";
import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";
import init, {
  addressFromScriptPublicKey,
  createInputSignature,
  PrivateKey,
  payToAddressScript,
  payToScriptHashScript,
  Transaction,
} from "@/wasm/core/kaspa";
import { parseArtifact } from "@/lib/kcc20/standard/artifact";
import { hash } from "@/lib/kcc20/standard/primitives";
import {
  decodeState,
  encodeState,
  KCC20State,
  TRANSFER_DELEGATOR_TAG,
  TRANSFER_TAG,
} from "@/lib/kcc20/standard/state";
import type {
  BuiltStandardTransfer,
  StandardSign,
  StandardSpendPiece,
} from "@/lib/kcc20/standard/build-transfer";

// build-transfer reaches lib/bridge through transfer.ts, which imports PNG/SVG assets.
registerHooks({
  load: (url, ctx, next) =>
    /\.(png|svg)$/.test(url)
      ? { format: "module", source: "export default ''", shortCircuit: true }
      : next(url, ctx),
});

const {
  allowedScriptUnits,
  assembleStandardTransfer,
  assertFamilyRules,
  buildStandardTransfer,
  FUNDING_COMPUTE_BUDGET,
  FUNDING_SCRIPT_UNITS,
  FUNDING_SIG_CHECKS,
  Kcc20StandardBuildError,
  LEADER_INDEX,
  patchSeat,
  SEAT_COMPUTE_BUDGET,
  SEAT_SCRIPT_HEADROOM,
  SEAT_SIG_CHECKS,
  SIGOP_SCRIPT_UNITS,
  toSdkTx,
} = await import("@/lib/kcc20/standard/build-transfer");
const { signInputDigest, signTxWithScriptOptions } = await import(
  "@/lib/wallet/sign-script"
);
const { buildKcc20Transfer, Kcc20TransferError, sendKcc20Transfer } =
  await import("@/lib/kcc20/transfer");
const { kcc20BuildErrorCopy } = await import(
  "@/components/send/kcc20-send/errorCopy"
);

// Synthetic and offline: two fixed noble keypairs, token cells materialized from the fixture
// artifact, one P2PK funding UTXO. Nothing is broadcast and no script engine runs (the vendored
// WASM exposes none), so these tests pin bytes and digests, not a consensus verdict.

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT = parseArtifact(
  JSON.parse(
    fs.readFileSync(
      path.join(TESTS_DIR, "fixtures/kcc20/program-artifact.json"),
      "utf8",
    ),
  ),
);

const TOKEN_ID = "c0".repeat(32);
const EXT = new Uint8Array(32).fill(0x5a);
const ZERO32 = new Uint8Array(32);
// Key A owns the tokens and the funding, key B receives.
const PRIV_A = "0b".repeat(32);
const PRIV_B = "0c".repeat(32);
const PUB_A = schnorr.getPublicKey(hexToBytes(PRIV_A));
const PUB_B = schnorr.getPublicKey(hexToBytes(PRIV_B));
let addressA: string;
let addressB: string;

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
  addressA = new PrivateKey(PRIV_A).toAddress("mainnet").toString();
  addressB = new PrivateKey(PRIV_B).toAddress("mainnet").toString();
});

const u8 = (...bytes: number[]) => Uint8Array.from(bytes);
const le64 = (v: bigint) => {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v, true);
  return out;
};
// PushData2 framing for the ~4 KB program.
const push2 = (b: Uint8Array) =>
  concatBytes(u8(0x4d, b.length & 0xff, b.length >> 8), b);

const deploy = (state: KCC20State) =>
  concatBytes(ARTIFACT.prefix, encodeState(state), ARTIFACT.suffix);

const stateOf = (
  amount: bigint,
  owner = PUB_A,
  ownerScheme = 0x00,
  ext = EXT,
): KCC20State => ({
  amount,
  owner,
  ownerScheme,
  borrowScheme: 0x00,
  borrowGuard: ZERO32,
  extensionCommitment: ext,
});

const cell = (state: KCC20State, index: number): StandardSpendPiece => ({
  outpoint: { transactionId: "dd".repeat(32), index },
  value: spend.COVENANT_DUST,
  redeem: deploy(state),
});

const fundingUtxo = (amount = 2_000_000_000n) => ({
  entry: {},
  address: addressA,
  outpoint: { transactionId: "ee".repeat(32), index: 0 },
  amount,
  scriptPublicKey: payToAddressScript(addressA),
  blockDaaScore: 0n,
  isCoinbase: false,
});

// Zero aux randomness makes BIP-340 deterministic, so every sigScript byte is reproducible.
const AUX0 = new Uint8Array(32);
const bip340 = (privHex: string, sighash: Uint8Array) =>
  concatBytes(schnorr.sign(sighash, hexToBytes(privHex), AUX0), u8(0x01));
const nobleSigner =
  (privHex: string): StandardSign =>
  (_inputIndex, sighash) =>
    bip340(privHex, sighash);

function build(
  pieces: StandardSpendPiece[],
  amount: bigint,
  sign: StandardSign = nobleSigner(PRIV_A),
) {
  return buildStandardTransfer({
    rpc: {
      getUtxosByAddresses: async () => ({ entries: [fundingUtxo()] }),
    } as never,
    address: addressA,
    pubkey32: PUB_A,
    tokenId: TOKEN_ID,
    pieces,
    recipient: addressB,
    amount,
    sign,
  });
}

const scriptOf = (b: BuiltStandardTransfer, i: number) =>
  hexToBytes(b.transaction.inputs[i].signatureScript ?? "");
const safe = (b: BuiltStandardTransfer) =>
  JSON.parse(b.transaction.serializeToSafeJSON());
// Digest computed by sdk-tx over the transaction as funded; cross-checked against WASM below.
const digest = (b: BuiltStandardTransfer, i: number) =>
  schnorrSighash(toSdkTx(b.transaction), i);

// Minimal script push reader for the opcodes PushMinimal/PushExplicit can emit.
function pushes(script: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at < script.length; ) {
    const op = script[at];
    let len: number;
    let skip = 1;
    if (op === 0x00) len = 0;
    else if (op <= 0x4b) len = op;
    else if (op === 0x4c) [len, skip] = [script[at + 1], 2];
    else if (op === 0x4d) [len, skip] = [script[at + 1] | (script[at + 2] << 8), 3];
    else if (op === 0x4f) {
      out.push(u8(0x81));
      at += 1;
      continue;
    } else if (op >= 0x51 && op <= 0x60) {
      out.push(u8(op - 0x50));
      at += 1;
      continue;
    } else throw new Error(`opcode ${op} is not a push`);
    out.push(script.slice(at + skip, at + skip + len));
    at += skip + len;
  }
  return out;
}

// Inverse of the §3 field grouping: six columns back into records.
function decodeColumns(cols: Uint8Array[]): KCC20State[] {
  const n = cols[0].length / 8;
  return Array.from({ length: n }, (_, i) =>
    decodeState(
      concatBytes(
        u8(0x08),
        cols[0].subarray(i * 8, i * 8 + 8),
        u8(0x20),
        cols[1].subarray(i * 32, i * 32 + 32),
        u8(0x01, cols[2][i], 0x01, cols[3][i]),
        u8(0x20),
        cols[4].subarray(i * 32, i * 32 + 32),
        u8(0x20),
        cols[5].subarray(i * 32, i * 32 + 32),
      ),
    ),
  );
}

// `R' = R[0:34] || encodeState(next) || R[146:]`, written out here instead of reusing the builder.
const successorOf = (R: Uint8Array, next: KCC20State) =>
  concatBytes(R.slice(0, 34), encodeState(next), R.slice(146));
// Version-0 P2SH envelope as safe JSON writes it: `0000` || aa 20 BLAKE2b256(R) 87.
const p2shSafeHex = (R: Uint8Array) =>
  "0000" + "aa20" + bytesToHex(blake2b(R, { dkLen: 32 })) + "87";

function expectStandardOutputs(
  b: BuiltStandardTransfer,
  leaderR: Uint8Array,
  next: KCC20State[],
) {
  const outputs = safe(b).outputs;
  next.forEach((s, i) => {
    const R2 = successorOf(leaderR, s);
    expect(R2.length).toBe(leaderR.length);
    expect(bytesToHex(R2.subarray(2, 34))).toBe(bytesToHex(leaderR.subarray(2, 34)));
    expect(bytesToHex(b.family.successors[i])).toBe(bytesToHex(R2));
    expect(outputs[i].scriptPublicKey).toBe(p2shSafeHex(R2));
    expect(outputs[i].covenant).toEqual({
      authorizingInput: LEADER_INDEX,
      covenantId: TOKEN_ID,
    });
    expect(String(BigInt(outputs[i].value))).toBe(String(spend.COVENANT_DUST));
  });
  // KAS change last, unbound, paying A, above the fee-output minimum.
  const change = outputs[next.length];
  expect(outputs.length).toBe(next.length + 1);
  expect(change.covenant ?? null).toBeNull();
  expect(change.scriptPublicKey).toBe("0000" + payToAddressScript(addressA).script);
  expect(BigInt(change.value) >= curve.FEE_OUT_MIN).toBe(true);
}

test("leader: 600 of 1000 from A to B — exact sigScript bytes, decoded next states, successor P2SH, binding, signature", async () => {
  const consumed = stateOf(1000n);
  const R = deploy(consumed);
  const b = await build([cell(consumed, 0)], 600n);

  const sighash = digest(b, 0);
  const sig = bip340(PRIV_A, sighash);
  const expected = concatBytes(
    u8(0x10), le64(600n), le64(400n), // amounts
    u8(0x40), PUB_B, PUB_A, // owners
    u8(0x02, 0x00, 0x00), // owner_scheme
    u8(0x02, 0x00, 0x00), // borrow_scheme
    u8(0x40), new Uint8Array(64), // borrow_guard
    u8(0x40), EXT, EXT, // extension_commitment
    u8(0x42, 0x00), sig, // witness: path 00 || sig65
    u8(0x04), TRANSFER_TAG,
    push2(R),
  );
  expect(bytesToHex(TRANSFER_TAG)).toBe("79c71c23");
  expect(bytesToHex(scriptOf(b, 0))).toBe(bytesToHex(expected));

  // Next states decode back from the sigScript columns.
  const p = pushes(scriptOf(b, 0));
  expect(p.length).toBe(9);
  const next = decodeColumns(p.slice(0, 6));
  expect(next).toEqual([
    stateOf(600n, PUB_B),
    stateOf(400n),
  ]);
  expect(next[0].ownerScheme).toBe(0x00);
  expect(next[0].borrowScheme).toBe(0x00);
  expect(bytesToHex(next[0].borrowGuard)).toBe(bytesToHex(ZERO32));
  expect(bytesToHex(p[8])).toBe(bytesToHex(R));

  expectStandardOutputs(b, R, next);

  // Signature: SIGHASH_ALL type byte, verifies under A's key over the leader digest.
  const placed = p[6].subarray(1);
  expect(placed[64]).toBe(0x01);
  expect(schnorr.verify(placed.subarray(0, 64), sighash, PUB_A)).toBe(true);
  expect(schnorr.verify(placed.subarray(0, 64), sighash, PUB_B)).toBe(false);
  expect(b.family.leaderIndex).toBe(0);
  expect(b.fundingInputIndexes).toEqual([1]);
});

test("sighash parity: rusty-kaspa WASM signatures verify against the sdk-tx digest the seats sign", async () => {
  const consumed = stateOf(1000n);
  const b = await build([cell(consumed, 0)], 600n);
  const key = new PrivateKey(PRIV_A);
  for (const i of [0, 1]) {
    // createInputSignature returns the push-encoded `41 || sig65`.
    const wasmSig = hexToBytes(
      createInputSignature(b.transaction, i, key, undefined),
    );
    expect(wasmSig.length).toBe(66);
    expect(
      schnorr.verify(wasmSig.subarray(1, 65), digest(b, i), PUB_A),
    ).toBe(true);
  }
  // The digest is per input: the seat signature does not satisfy the funding input.
  const seatSig = pushes(scriptOf(b, 0))[6].subarray(1, 65);
  expect(schnorr.verify(seatSig, digest(b, 1), PUB_A)).toBe(false);
});

test("delegator: two cells 550 + 450 — exact leader and delegator bytes, both verify, funding signs on the wallet path", async () => {
  const leaderState = stateOf(550n);
  const delegState = stateOf(450n);
  const R0 = deploy(leaderState);
  const R1 = deploy(delegState);
  const b = await build([cell(delegState, 1), cell(leaderState, 0)], 600n);

  // Largest first: the 550 cell leads at input 0, the 450 cell delegates at input 1.
  expect(safe(b).inputs[0].index).toBe(0);
  expect(safe(b).inputs[1].index).toBe(1);

  const sig0 = bip340(PRIV_A, digest(b, 0));
  const sig1 = bip340(PRIV_A, digest(b, 1));
  expect(bytesToHex(scriptOf(b, 0))).toBe(
    bytesToHex(
      concatBytes(
        u8(0x10), le64(600n), le64(400n),
        u8(0x40), PUB_B, PUB_A,
        u8(0x02, 0x00, 0x00),
        u8(0x02, 0x00, 0x00),
        u8(0x40), new Uint8Array(64),
        u8(0x40), EXT, EXT,
        u8(0x42, 0x00), sig0,
        u8(0x04), TRANSFER_TAG,
        push2(R0),
      ),
    ),
  );
  // Delegator: owner authorization only, no path byte.
  expect(bytesToHex(TRANSFER_DELEGATOR_TAG)).toBe("fd3ef14a");
  expect(bytesToHex(scriptOf(b, 1))).toBe(
    bytesToHex(
      concatBytes(u8(0x41), sig1, u8(0x04), TRANSFER_DELEGATOR_TAG, push2(R1)),
    ),
  );
  expect(schnorr.verify(sig0.subarray(0, 64), digest(b, 0), PUB_A)).toBe(true);
  expect(schnorr.verify(sig1.subarray(0, 64), digest(b, 1), PUB_A)).toBe(true);

  // Both continuations derive from the leader's program, both bound to input 0.
  expectStandardOutputs(b, R0, [stateOf(600n, PUB_B), stateOf(400n)]);

  // Funding goes through the production signer; seats are left exactly as they were.
  const before = [0, 1].map((i) => b.transaction.inputs[i].signatureScript);
  const signed = await signTxWithScriptOptions(
    b.transaction,
    b.fundingInputIndexes.map((inputIndex) => ({
      inputIndex,
      signType: "All" as const,
    })),
    PRIV_A,
  );
  expect([0, 1].map((i) => signed.inputs[i].signatureScript)).toEqual(before);
  const fundingScript = hexToBytes(signed.inputs[2].signatureScript ?? "");
  verifyFundingSignature(toSdkTx(signed), 2, fundingScript.subarray(1));
});

test("owner_scheme 0x01: leader witness 00 || pubkey32 || sig65, delegator pubkey32 || sig65", async () => {
  const owner = hash(PUB_A);
  const leaderState = stateOf(550n, owner, 0x01);
  const delegState = stateOf(450n, owner, 0x01);
  const b = await build([cell(leaderState, 0), cell(delegState, 1)], 600n);

  const p0 = pushes(scriptOf(b, 0));
  expect(bytesToHex(p0[6])).toBe(
    bytesToHex(concatBytes(u8(0x00), PUB_A, bip340(PRIV_A, digest(b, 0)))),
  );
  // 98-byte witness crosses into OP_PUSHDATA1.
  expect(scriptOf(b, 0)[b.family.seats[0].sigOffset - 32 - 1 - 2]).toBe(0x4c);
  // 97-byte delegator witness, also OP_PUSHDATA1.
  expect(bytesToHex(scriptOf(b, 1))).toBe(
    bytesToHex(
      concatBytes(
        u8(0x4c, 0x61),
        PUB_A,
        bip340(PRIV_A, digest(b, 1)),
        u8(0x04),
        TRANSFER_DELEGATOR_TAG,
        push2(deploy(delegState)),
      ),
    ),
  );
  // Change keeps the consumed owner and scheme; the recipient is still plain p2pk.
  expect(decodeColumns(p0.slice(0, 6))).toEqual([
    stateOf(600n, PUB_B),
    stateOf(400n, owner, 0x01),
  ]);
});

test("full balance: no zero-amount change continuation", async () => {
  const consumed = stateOf(1000n);
  const b = await build([cell(consumed, 0)], 1000n);
  expect(b.family.nextStates).toEqual([stateOf(1000n, PUB_B)]);
  expectStandardOutputs(b, deploy(consumed), [stateOf(1000n, PUB_B)]);
});

test("compute budget: every input declares one, seats and funding cover their signature checks", async () => {
  const seatNeed = SEAT_SIG_CHECKS * SIGOP_SCRIPT_UNITS + SEAT_SCRIPT_HEADROOM;
  const fundingNeed = FUNDING_SIG_CHECKS * SIGOP_SCRIPT_UNITS + FUNDING_SCRIPT_UNITS;
  // Smallest covering budget: one unit less no longer covers the need.
  expect(allowedScriptUnits(SEAT_COMPUTE_BUDGET)).toBeGreaterThanOrEqual(seatNeed);
  expect(allowedScriptUnits(SEAT_COMPUTE_BUDGET - 1)).toBeLessThan(seatNeed);
  expect(allowedScriptUnits(FUNDING_COMPUTE_BUDGET)).toBeGreaterThanOrEqual(fundingNeed);
  expect(allowedScriptUnits(FUNDING_COMPUTE_BUDGET - 1)).toBeLessThan(fundingNeed);
  // A budget of 0 only buys the free allowance, which is short of a single signature check.
  expect(allowedScriptUnits(0)).toBeLessThan(SIGOP_SCRIPT_UNITS);

  for (const pieces of [
    [cell(stateOf(1000n), 0)],
    [cell(stateOf(550n), 0), cell(stateOf(450n), 1)],
    [0, 1, 2].map((i) => cell(stateOf(300n), i)),
  ]) {
    const b = await build(pieces, 600n);
    const inputs = safe(b).inputs;
    expect(inputs.length).toBe(b.family.seats.length + b.fundingInputIndexes.length);
    inputs.forEach((input: { computeBudget: number }, i: number) => {
      expect(input.computeBudget).toBeGreaterThan(0);
      const funding = b.fundingInputIndexes.includes(i);
      expect(input.computeBudget).toBe(
        funding ? FUNDING_COMPUTE_BUDGET : SEAT_COMPUTE_BUDGET,
      );
      expect(allowedScriptUnits(input.computeBudget)).toBeGreaterThanOrEqual(
        funding ? fundingNeed : seatNeed,
      );
    });
  }
});

test("seam: sdk-tx patchPlaceholder cannot sign a leader seat; the computed offset can", () => {
  const built = assembleStandardTransfer({
    covenantId: TOKEN_ID,
    pieces: [cell(stateOf(550n), 0), cell(stateOf(450n), 1)],
    pubkey32: PUB_A,
    recipient: addressB,
    amount: 600n,
    funding: [fundingUtxo()],
    address: addressA,
  });
  const [leader, delegator] = built.family.seats;
  const sig = bip340(PRIV_A, new Uint8Array(32).fill(7));
  // The leader witness is a 66-byte push, so there is no 65-byte push to find.
  expect(() => patchPlaceholder(leader.script, sig)).toThrow();
  // A scheme-00 delegator witness IS a bare 65-byte push, so the two agree there.
  expect(bytesToHex(patchPlaceholder(delegator.script, sig))).toBe(
    bytesToHex(
      concatBytes(
        delegator.script.subarray(0, delegator.sigOffset),
        sig,
        delegator.script.subarray(delegator.sigOffset + 65),
      ),
    ),
  );
  // Funded at final size: seats are placeholders, fee already priced for them.
  expect(leader.script.subarray(leader.sigOffset, leader.sigOffset + 65).every((x) => x === 0)).toBe(true);
  expect(built.fee > 0n).toBe(true);
});

const rejects = async (p: Promise<unknown> | (() => unknown), code: string, re?: RegExp) => {
  let err: unknown;
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(Kcc20StandardBuildError);
  expect((err as InstanceType<typeof Kcc20StandardBuildError>).code).toBe(code);
  if (re) expect((err as Error).message).toMatch(re);
};

const leaderWitness = () => concatBytes(u8(0x00), new Uint8Array(65));

test("negative: a piece off the canonical template", async () => {
  const off = cell(stateOf(400n), 1);
  off.redeem[off.redeem.length - 1] ^= 0x01;
  // Rejected even when the canonical piece alone would cover the amount.
  await rejects(
    build([cell(stateOf(1000n), 0), off], 600n),
    "unsupported-template",
  );
  expect(
    kcc20BuildErrorCopy(
      new Kcc20StandardBuildError("unsupported-template", "x"),
    ),
  ).toMatch(/cannot send yet/);
});

test("negative: amount not preserved", async () => {
  await rejects(
    () =>
      assertFamilyRules(
        [stateOf(1000n)],
        [stateOf(600n, PUB_B), stateOf(300n)],
        leaderWitness(),
      ),
    "rule-violation",
    /amount-not-preserved/,
  );
});

test("negative: extension commitment changed", async () => {
  // Across inputs: a second cell under another commitment.
  const other = new Uint8Array(32).fill(0x6b);
  await rejects(
    build([cell(stateOf(550n), 0), cell(stateOf(450n, PUB_A, 0, other), 1)], 600n),
    "rule-violation",
    /extension-commitment-not-preserved/,
  );
  // Across continuations: a successor rewriting the commitment.
  await rejects(
    () =>
      assertFamilyRules(
        [stateOf(1000n)],
        [stateOf(600n, PUB_B, 0, other), stateOf(400n)],
        leaderWitness(),
      ),
    "rule-violation",
    /extension-commitment-not-preserved/,
  );
});

test("negative: 4 token inputs", async () => {
  const quarter = [0, 1, 2, 3].map((i) => cell(stateOf(250n), i));
  await rejects(build(quarter, 1000n), "fragmented");
  await rejects(
    () =>
      assertFamilyRules(
        [250n, 250n, 250n, 250n].map((a) => stateOf(a)),
        [stateOf(1000n, PUB_B)],
        leaderWitness(),
      ),
    "rule-violation",
    /over-max-token-inputs/,
  );
});

test("send screen copy: a standard build error reads as an actionable sentence; legacy copy unchanged", async () => {
  const quarter = [0, 1, 2, 3].map((i) => cell(stateOf(250n), i));
  const caught = await build(quarter, 1000n).catch((e) => e);
  expect(caught).toBeInstanceOf(Kcc20StandardBuildError);
  expect(kcc20BuildErrorCopy(caught)).toMatch(/split across too many pieces/);
  expect(
    kcc20BuildErrorCopy(
      new Kcc20StandardBuildError("insufficient-balance", "Not enough"),
    ),
  ).toMatch(/enough spendable balance/);
  expect(kcc20BuildErrorCopy(new Error("boom"))).toBe(
    "Could not build the transfer",
  );
  // Legacy: the remapped code keeps its copy, every other code keeps the builder message.
  expect(
    kcc20BuildErrorCopy(new Kcc20TransferError("unsupported-schema", "x")),
  ).toBe(
    "This token uses the KCC-20 standard, which this version cannot send yet.",
  );
  expect(
    kcc20BuildErrorCopy(new Kcc20TransferError("fragmented", "legacy words")),
  ).toBe("legacy words");
});

test("negative: negative amount", async () => {
  await rejects(build([cell(stateOf(1000n), 0)], -600n), "invalid-amount");
  await rejects(build([cell(stateOf(1000n), 0)], 0n), "invalid-amount");
  await rejects(
    () =>
      assertFamilyRules(
        [stateOf(1000n)],
        [stateOf(1001n, PUB_B), stateOf(-1n)],
        leaderWitness(),
      ),
    "rule-violation",
    /negative-amount/,
  );
});

test("negative: wrong tag — program without the transfer tag, signature with a weaker sighash type", async () => {
  const R = deploy(stateOf(1000n));
  const tagPush = bytesToHex(concatBytes(u8(0x04), TRANSFER_TAG));
  const hex = bytesToHex(R);
  expect(hex.slice(292).includes(tagPush)).toBe(true);
  const forged = hexToBytes(
    hex.slice(0, 292) + hex.slice(292).replaceAll(tagPush, "04deadbeef"),
  );
  await rejects(
    build([{ ...cell(stateOf(1000n), 0), redeem: forged }], 600n),
    "not-standard",
    /dispatch tag/,
  );
  // SIGHASH_NONE type byte on a valid Schnorr signature is refused before it is written.
  await rejects(
    build([cell(stateOf(1000n), 0)], 600n, (_i, h) =>
      concatBytes(schnorr.sign(h, hexToBytes(PRIV_A), AUX0), u8(0x02)),
    ),
    "bad-signature",
  );
  // So is a signature from the wrong key.
  await rejects(
    build([cell(stateOf(1000n), 0)], 600n, nobleSigner(PRIV_B)),
    "bad-signature",
  );
});

test("negative: a cell the wallet does not own is never selected", async () => {
  await rejects(
    build([cell(stateOf(1000n, PUB_B), 0)], 600n),
    "insufficient-balance",
  );
});

// patchSeat only writes over an all-zero seat, so a seat is signed at most once.
const leaderSeat = () =>
  assembleStandardTransfer({
    covenantId: TOKEN_ID,
    pieces: [cell(stateOf(550n), 0), cell(stateOf(450n), 1)],
    pubkey32: PUB_A,
    recipient: addressB,
    amount: 600n,
    funding: [fundingUtxo()],
    address: addressA,
  }).family.seats[0];

test("patchSeat: refuses to overwrite a seat that already carries a signature", () => {
  const s = leaderSeat();
  const first = bip340(PRIV_A, new Uint8Array(32).fill(7));
  const second = bip340(PRIV_A, new Uint8Array(32).fill(8));
  expect(bytesToHex(first)).not.toBe(bytesToHex(second));
  const patched = patchSeat(s, first);
  expect(bytesToHex(patched.subarray(s.sigOffset, s.sigOffset + 65))).toBe(
    bytesToHex(first),
  );
  expect(() => patchSeat({ ...s, script: patched }, second)).toThrow(
    /no placeholder at sigOffset/,
  );
});

test("patchSeat: refuses a seat pre-filled before the first patch", () => {
  const s = leaderSeat();
  const script = s.script.slice();
  // one non-zero byte anywhere in the seat is enough
  script[s.sigOffset + 64] = 0x01;
  expect(() =>
    patchSeat({ ...s, script }, bip340(PRIV_A, new Uint8Array(32).fill(7))),
  ).toThrow(/no placeholder at sigOffset/);
});

// buildKcc20Transfer end to end, offline: kascov (or, for legacy, the indexer) lists the cells,
// a fake rpc serves them as live covenant UTXOs at their P2SH addresses and the funding UTXO
// at the wallet address.
const p2shOf = (c: StandardSpendPiece) =>
  addressFromScriptPublicKey(payToScriptHashScript(c.redeem), "mainnet")!.toString();

function fakeRpc(cells: StandardSpendPiece[], submitted: Transaction[] = []) {
  return {
    getUtxosByAddresses: async (addresses: string[]) => ({
      entries: addresses.includes(addressA)
        ? [fundingUtxo()]
        : cells
            .filter((c) => addresses.includes(p2shOf(c)))
            .map((c) => ({
              outpoint: c.outpoint,
              address: p2shOf(c),
              entry: { covenantId: TOKEN_ID, amount: c.value },
            })),
    }),
    submitTransaction: async ({ transaction }: { transaction: Transaction }) => {
      submitted.push(transaction);
      return { transactionId: transaction.id };
    },
  } as never;
}

async function withIndexer<T>(cells: StandardSpendPiece[], run: () => Promise<T>) {
  const proto = client.IndexerClient.prototype;
  const original = proto.tokenUtxos;
  proto.tokenUtxos = async () =>
    cells.map((c) => ({ outpoint: c.outpoint, redeemScriptHex: bytesToHex(c.redeem) })) as never;
  try {
    return await run();
  } finally {
    proto.tokenUtxos = original;
  }
}

const fakeKascov = (states: KCC20State[]) => ({
  holdings: async () => [],
  ownerCells: async () =>
    states.map((state, index) => ({
      outpoint: cell(state, index).outpoint,
      programHex: bytesToHex(deploy(state)),
      amount: state.amount,
      owner: bytesToHex(state.owner),
      extensionCommitment: bytesToHex(state.extensionCommitment),
    })),
});

const tokenOf = (family: "kron-legacy" | "kcc20-standard") => ({
  tick: "STD",
  covenantId: TOKEN_ID,
  family,
  meta: undefined,
  extensionCommitment: bytesToHex(EXT),
});

test("buildKcc20Transfer: a standard token returns the standard shape, seats unsigned until send", async () => {
  // The 5000 cell is another row (other extension commitment): largest-first must not reach it.
  const states = [stateOf(1000n), stateOf(5000n, PUB_A, 0x00, new Uint8Array(32).fill(0x7e))];
  const cells = states.map(cell);
  const built = await buildKcc20Transfer({
    token: tokenOf("kcc20-standard"),
    address: addressA,
    recipient: addressB,
    amount: 600n,
    rpc: fakeRpc(cells),
    fetchKascov: fakeKascov(states),
  });
  expect(built.transaction).toBeDefined();
  expect(String(built.amount)).toBe("600");
  expect(built.fee > 0n).toBe(true);
  // Recipient + change continuations carry the dust floor; the one consumed cell returns its own.
  expect(String(built.kasDebit)).toBe(
    String(built.fee + 2n * spend.COVENANT_DUST - spend.COVENANT_DUST),
  );
  const plan = built.standard!.plan;
  expect(bytesToHex(built.standard!.pubkey32)).toBe(bytesToHex(PUB_A));
  expect(plan.nextStates.map((s) => String(s.amount))).toEqual(["600", "400"]);
  expect(plan.seats.map((s) => s.inputIndex)).toEqual([0]);
  expect(plan.consumed.map((s) => String(s.amount))).toEqual(["1000"]);
  expect(built.fundingInputIndexes).toEqual([1]);
  // Nothing is signed at review time: the seat still holds its zero placeholder.
  const seat = plan.seats[0];
  const script = hexToBytes(built.transaction.inputs[0].signatureScript ?? "");
  expect(script.subarray(seat.sigOffset, seat.sigOffset + 65).every((b) => b === 0)).toBe(true);

  // sendKcc20Transfer signs the seat with signInputDigest, then the funding input, then submits.
  const submitted: Transaction[] = [];
  const wallet = {
    signInputDigest: (tx: Transaction, i: number) => signInputDigest(tx, i, PRIV_A),
    signTx: (tx: Transaction, scripts?: never) =>
      signTxWithScriptOptions(tx, scripts, PRIV_A),
  } as never;
  await sendKcc20Transfer(wallet, built, fakeRpc(cells, submitted));
  expect(submitted).toHaveLength(1);
  const tx = submitted[0];
  const signed = hexToBytes(tx.inputs[0].signatureScript ?? "");
  const sig = signed.subarray(seat.sigOffset, seat.sigOffset + 65);
  expect(sig[64]).toBe(0x01);
  expect(schnorr.verify(sig.subarray(0, 64), schnorrSighash(toSdkTx(tx), 0), PUB_A)).toBe(true);
  expect(tx.inputs[1].signatureScript).toBeTruthy();
});

test("buildKcc20Transfer: a legacy token keeps its legacy errors and never takes the standard path", async () => {
  const cells = [cell(stateOf(1000n), 0)];
  const codeOf = (cs: StandardSpendPiece[]) =>
    withIndexer(cs, () =>
      buildKcc20Transfer({
        token: tokenOf("kron-legacy"),
        address: addressA,
        recipient: addressB,
        amount: 600n,
        rpc: fakeRpc(cs),
      }),
    ).then(
      () => "built",
      (e) => (e instanceof Kcc20TransferError ? e.code : `other: ${e}`),
    );
  // Only standard pieces on a row marked legacy: the pre-existing guard, unchanged.
  expect(await codeOf(cells)).toBe("unsupported-schema");
  // No pieces at all: the legacy selector's own error.
  expect(await codeOf([])).toBe("insufficient-balance");
});
