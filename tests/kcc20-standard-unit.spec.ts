import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { kcc20 } from "@kronsdk/kron-sdk";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";
import { classifyRedeem, isStandardOwnedBy } from "@/lib/kcc20/classify";
import { parseArtifact } from "@/lib/kcc20/standard/artifact";
import {
  STANDARD_TEMPLATES,
  supportsStandardTransfer,
} from "@/lib/kcc20/standard/templates";
import {
  decodeIntState,
  dispatchTag,
  encodeIntState,
  encodeScriptNumArg,
  hash,
  INT_MAX,
  pushExplicit,
  pushMinimal,
} from "@/lib/kcc20/standard/primitives";
import {
  decodeState,
  encodeState,
  encodeTransferArgs,
  KCC20State,
  STATE_LEN,
  TRANSFER_DELEGATOR_TAG,
  TRANSFER_TAG,
} from "@/lib/kcc20/standard/state";
import {
  borrowWitnessLength,
  ownerAuthLength,
  validateBorrowedReceive,
  validateStandardTransfer,
} from "@/lib/kcc20/standard/validate";

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/kcc20",
);

// Pinned so a silent fixture edit cannot make a vector pass.
const FIXTURE_SHA256: Record<string, string> = {
  "conformance.json":
    "9b424c96ea0e0093cacfd98e3013fd5cbf93dd149cb27696acf288510133010b",
  "program-artifact.json":
    "b5f93220b005f39ece92347f5226b2dd4b2f8f8c65b38b359c95133fdcf1c41e",
  "standard-program.hex":
    "b846535a94a260846529d90838475d716560d8b0074767d4a66487d324755025",
};

function fixture(name: string) {
  return fs.readFileSync(path.join(FIXTURES, name));
}

const V: any = JSON.parse(fixture("conformance.json").toString("utf8"));
const ARTIFACT: any = JSON.parse(
  fixture("program-artifact.json").toString("utf8"),
);
const LEGACY: any = JSON.parse(fixture("legacy-redeem.json").toString("utf8"));

const hex = (h: string) => hexToBytes(h);
const byteOf = (h: string) => {
  const b = hex(h);
  expect(b.length).toBe(1);
  return b[0];
};

function stateFromJson(s: any): KCC20State {
  return {
    amount: BigInt(s.amount),
    owner: hex(s.owner_hex),
    ownerScheme: byteOf(s.owner_scheme_hex),
    borrowScheme: byteOf(s.borrow_scheme_hex),
    borrowGuard: hex(s.borrow_guard_hex),
    extensionCommitment: hex(s.extension_commitment_hex),
  };
}

function expectStatesEqual(a: KCC20State, b: KCC20State) {
  expect(String(a.amount)).toBe(String(b.amount));
  expect(bytesToHex(a.owner)).toBe(bytesToHex(b.owner));
  expect(a.ownerScheme).toBe(b.ownerScheme);
  expect(a.borrowScheme).toBe(b.borrowScheme);
  expect(bytesToHex(a.borrowGuard)).toBe(bytesToHex(b.borrowGuard));
  expect(bytesToHex(a.extensionCommitment)).toBe(
    bytesToHex(b.extensionCommitment),
  );
}

const VECTOR_STATE = stateFromJson(V.state_encoding.state);
const TEMPLATE = parseArtifact(ARTIFACT);
const standardRedeem = (state: KCC20State) =>
  concatBytes(TEMPLATE.prefix, encodeState(state), TEMPLATE.suffix);

test("fixtures are the pinned copies", () => {
  for (const [name, sha] of Object.entries(FIXTURE_SHA256)) {
    expect(createHash("sha256").update(fixture(name)).digest("hex")).toBe(sha);
  }
});

test("1. dispatch tags match the conformance vectors", () => {
  const [transfer, delegator] = V.dispatch;
  expect(bytesToHex(dispatchTag(transfer.function_signature))).toBe(
    transfer.dispatch_tag_hex,
  );
  expect(bytesToHex(dispatchTag(delegator.function_signature))).toBe(
    delegator.dispatch_tag_hex,
  );
  expect(bytesToHex(TRANSFER_TAG)).toBe(transfer.dispatch_tag_hex);
  expect(bytesToHex(TRANSFER_DELEGATOR_TAG)).toBe(delegator.dispatch_tag_hex);
});

test("KCC-1 pushes and int encodings", () => {
  expect(bytesToHex(pushMinimal(new Uint8Array()))).toBe("00");
  expect(bytesToHex(pushMinimal(Uint8Array.of(0x01)))).toBe("51");
  expect(bytesToHex(pushMinimal(Uint8Array.of(0x10)))).toBe("60");
  expect(bytesToHex(pushMinimal(Uint8Array.of(0x81)))).toBe("4f");
  expect(bytesToHex(pushMinimal(Uint8Array.of(0x00)))).toBe("0100");
  expect(bytesToHex(pushMinimal(Uint8Array.of(0x11)))).toBe("0111");
  expect(bytesToHex(pushMinimal(new Uint8Array(75)).subarray(0, 1))).toBe("4b");
  expect(bytesToHex(pushMinimal(new Uint8Array(76)).subarray(0, 2))).toBe(
    "4c4c",
  );
  expect(bytesToHex(pushMinimal(new Uint8Array(256)).subarray(0, 3))).toBe(
    "4d0001",
  );
  expect(bytesToHex(pushMinimal(new Uint8Array(65536)).subarray(0, 5))).toBe(
    "4e00000100",
  );
  expect(bytesToHex(pushExplicit(new Uint8Array()))).toBe("00");
  expect(bytesToHex(pushExplicit(Uint8Array.of(0x01)))).toBe("0101");
  expect(bytesToHex(pushExplicit(Uint8Array.of(0x81)))).toBe("0181");

  expect(bytesToHex(encodeIntState(1000n))).toBe("e803000000000000");
  expect(bytesToHex(encodeIntState(-500n))).toBe("f401000000000080");
  expect(bytesToHex(encodeIntState(INT_MAX))).toBe("ffffffffffffff7f");
  expect(String(decodeIntState(hex("f401000000000080")))).toBe("-500");
  expect(String(decodeIntState(hex("0000000000000080")))).toBe("0");
  expect(() => encodeIntState(INT_MAX + 1n)).toThrow();
  expect(() => encodeIntState(-INT_MAX - 1n)).toThrow();

  expect(bytesToHex(encodeScriptNumArg(0n))).toBe("00");
  expect(bytesToHex(encodeScriptNumArg(1n))).toBe("51");
  expect(bytesToHex(encodeScriptNumArg(16n))).toBe("60");
  expect(bytesToHex(encodeScriptNumArg(-1n))).toBe("4f");
  expect(bytesToHex(encodeScriptNumArg(17n))).toBe("0111");
  expect(bytesToHex(encodeScriptNumArg(127n))).toBe("017f");
  expect(bytesToHex(encodeScriptNumArg(128n))).toBe("028000");
  expect(bytesToHex(encodeScriptNumArg(-128n))).toBe("028080");
  expect(bytesToHex(encodeScriptNumArg(255n))).toBe("02ff00");
  expect(bytesToHex(encodeScriptNumArg(256n))).toBe("020001");
});

test("2. encodeState matches the 112-byte vector and round-trips", () => {
  const encoded = encodeState(VECTOR_STATE);
  expect(encoded.length).toBe(V.state_record.encoded_state_length);
  expect(encoded.length).toBe(112);
  expect(STATE_LEN).toBe(112);
  expect(bytesToHex(encoded)).toBe(V.state_encoding.encoded_hex);
  expect(bytesToHex(encoded)).toBe(
    V.state_encoding.encoded_fields_hex.join(""),
  );
  expectStatesEqual(decodeState(encoded), VECTOR_STATE);

  for (const amount of [0n, INT_MAX]) {
    const s = { ...VECTOR_STATE, amount };
    expectStatesEqual(decodeState(encodeState(s)), s);
  }

  // A negative-zero threshold guard is legal in borrow_guard and survives byte-for-byte.
  const negativeZeroGuard = hex(
    "0000000000000080000000000000000000000000000000000000000000000000",
  );
  const guarded = { ...VECTOR_STATE, borrowGuard: negativeZeroGuard };
  expect(bytesToHex(decodeState(encodeState(guarded)).borrowGuard)).toBe(
    bytesToHex(negativeZeroGuard),
  );
});

test("2b. the artifact state span is 145 bytes: push32 template hash, then the 112-byte state", () => {
  expect(TEMPLATE.stateSpan).toEqual({ offset: 1, len: 145 });
  expect(TEMPLATE.stateOffset).toBe(34);
  const R = standardRedeem(VECTOR_STATE);
  const { offset, len } = TEMPLATE.stateSpan;
  const span = R.subarray(offset, offset + len);
  expect(span.length).toBe(145);
  expect(bytesToHex(span)).toBe(
    `20${TEMPLATE.templateHash}${V.state_encoding.encoded_hex}`,
  );
});

test("decodeState is strict", () => {
  const good = encodeState(VECTOR_STATE);
  const mutate = (at: number, value: number) => {
    const b = good.slice();
    b[at] = value;
    return b;
  };
  expect(() => decodeState(concatBytes(good, Uint8Array.of(0)))).toThrow();
  expect(() => decodeState(good.subarray(0, 111))).toThrow();
  for (const at of [0, 9, 42, 44, 46, 79]) {
    expect(() => decodeState(mutate(at, good[at] ^ 0xff))).toThrow();
  }
  // Negative amount, and negative zero (sign bit alone).
  expect(() => decodeState(mutate(8, 0x80))).toThrow();
  const negativeZero = good.slice();
  negativeZero.set(hex("0000000000000080"), 1);
  expect(() => decodeState(negativeZero)).toThrow();
  expect(decodeState(mutate(43, 0x04)).ownerScheme).toBe(0x04);
  expect(() => decodeState(mutate(43, 0x05))).toThrow();
  expect(decodeState(mutate(45, 0x03)).borrowScheme).toBe(0x03);
  expect(() => decodeState(mutate(45, 0x04))).toThrow();
});

test("3. encodeTransferArgs matches the grouped-push vector", () => {
  const args = V.transfer_arguments;
  const states = args.next_states.map(stateFromJson);
  const encoded = encodeTransferArgs(states, hex(args.witness_hex));
  expect(bytesToHex(encoded)).toBe(
    args.grouped_field_pushes_hex.join("") +
      args.witness_push_hex +
      args.dispatch_tag_push_hex,
  );
  expect(bytesToHex(pushMinimal(hex(args.witness_hex)))).toBe(
    args.witness_push_hex,
  );
});

function standardTransferCase(overrides: any) {
  const c = { ...V.standard_transfer.common, ...overrides };
  const leader = stateFromJson(c.leader_state);
  const delegates = c.delegate_amounts.map((amount: number) => ({
    ...leader,
    amount: BigInt(amount),
  }));
  const nextStates = V.transfer_arguments.next_states.map(
    (s: any, i: number): KCC20State => ({
      ...stateFromJson(s),
      amount: BigInt(c.next_state_amounts[i]),
      ownerScheme: byteOf(c.next_state_owner_schemes_hex[i]),
      extensionCommitment: hex(c.next_state_extension_commitments_hex[i]),
    }),
  );
  return validateStandardTransfer({
    inputs: [leader, ...delegates],
    nextStates,
    witness: hex(c.witness_hex),
    maxTokenInputs: c.max_token_inputs,
  });
}

test("4. every standard_transfer reject case is rejected for its own reason", () => {
  expect(standardTransferCase({})).toEqual({ ok: true });
  const cases = V.standard_transfer.cases;
  expect(cases.map((c: { id: string }) => c.id).sort()).toEqual(
    [
      "amount-not-preserved",
      "extension-commitment-not-preserved",
      "invalid-witness-path-byte",
      "negative-amount",
      "over-max-token-inputs",
      "unsupported-owner-scheme",
    ].sort(),
  );
  for (const c of cases) {
    expect(c.result).toBe("reject");
    expect(c.signature_dependent).toBe(false);
    const verdict = standardTransferCase(c);
    expect(verdict.ok, c.id).toBe(false);
    if (!verdict.ok) expect(verdict.code, c.id).toBe(c.id);
  }
});

test("owner and borrow witness vectors have the KCC-2 lengths", () => {
  for (const w of V.owner_witness) {
    const raw = hex(w.witness_hex);
    expect(raw.length, w.scheme).toBe(w.length);
    expect(raw[0], w.scheme).toBe(0x00);
    expect(raw.length - 1, w.scheme).toBe(
      ownerAuthLength(byteOf(w.owner_scheme_hex)),
    );
    if (w.p2pkh_hash_hex) {
      const pubkeyLen = byteOf(w.owner_scheme_hex) === 0x02 ? 33 : 32;
      expect(bytesToHex(hash(raw.subarray(1, 1 + pubkeyLen))), w.scheme).toBe(
        w.p2pkh_hash_hex,
      );
    }
  }
  for (const w of V.borrow_witness) {
    const raw = hex(w.witness_hex);
    expect(raw.length, w.scheme).toBe(w.length);
    expect(raw[0], w.scheme).toBe(0x01);
    expect(raw.length - 1, w.scheme).toBe(
      borrowWitnessLength(byteOf(w.borrow_scheme_hex)),
    );
  }
});

test("hash chain links are x_i = blake3(x_{i-1} || pubkey_i)", () => {
  const chain = V.hash_chain;
  let previous = hex(chain.x_0_hex);
  chain.links.forEach(
    (link: { i: number; pubkey_hex: string; x_hex: string }, index: number) => {
      expect(link.i).toBe(index + 1);
      previous = hash(concatBytes(previous, hex(link.pubkey_hex)));
      expect(bytesToHex(previous)).toBe(link.x_hex);
    },
  );
  expect(bytesToHex(previous)).toBe(chain.initial_borrow_guard_hex);
  for (const c of V.borrowed_receive.cases) {
    if (c.revealed_link_hash_hex) {
      const witness = hex(c.witness_hex);
      expect(bytesToHex(hash(witness.subarray(1, 65)))).toBe(
        c.revealed_link_hash_hex,
      );
    }
  }
});

test("5. every borrowed_receive case accepts or rejects as tabled", () => {
  const common = V.borrowed_receive.common;
  const cases = V.borrowed_receive.cases;
  let checked = 0;
  for (const c of cases) {
    if (c.signature_dependent) continue;
    const leader: KCC20State = {
      amount: BigInt(common.leader_amount),
      owner: hex(common.owner_hex),
      ownerScheme: byteOf(common.owner_scheme_hex),
      borrowScheme: byteOf(c.borrow_scheme_hex),
      borrowGuard: hex(c.leader_borrow_guard_hex),
      extensionCommitment: hex(common.extension_commitment_hex),
    };
    const successor: KCC20State = {
      ...leader,
      amount: BigInt(c.successor_amount),
      borrowGuard: hex(c.successor_borrow_guard_hex),
      ...(c.successor_owner_hex ? { owner: hex(c.successor_owner_hex) } : {}),
    };
    const verdict = validateBorrowedReceive({
      leader,
      successor,
      witness: hex(c.witness_hex),
      leaderKasValue:
        c.leader_kas_value_sompi === undefined
          ? undefined
          : BigInt(c.leader_kas_value_sompi),
      successorKasValue:
        c.successor_kas_value_sompi === undefined
          ? undefined
          : BigInt(c.successor_kas_value_sompi),
    });
    expect(verdict.ok ? "accept" : "reject", c.id).toBe(c.result);
    checked++;
  }
  expect(checked).toBe(
    cases.filter(
      (c: { signature_dependent: boolean }) => !c.signature_dependent,
    ).length,
  );
  // 16 tabled rows; only hash-chain-valid depends on a signature.
  expect(cases.length).toBe(16);
  expect(checked).toBe(15);
});

test("parseArtifact refuses a runtime state it does not understand", () => {
  expect(TEMPLATE.templateHash).toBe(bytesToHex(TEMPLATE.prefix.subarray(2)));
  expect(TEMPLATE.dispatchTags).toEqual({
    transfer: "79c71c23",
    transferDelegator: "fd3ef14a",
  });
  expect(TEMPLATE.verified).toBe(false);

  const clone = () => JSON.parse(JSON.stringify(ARTIFACT));
  const reordered = clone();
  const fields = reordered.sil_abi.contracts.KCC20.runtime_state.fields;
  [fields[2], fields[3]] = [fields[3], fields[2]];
  expect(() => parseArtifact(reordered)).toThrow();

  const extraField = clone();
  extraField.sil_abi.contracts.KCC20.runtime_state.fields.push({
    name: "extra",
    type: { kind: "byte" },
  });
  expect(() => parseArtifact(extraField)).toThrow();

  const wrongTag = clone();
  wrongTag.sil_abi.contracts.KCC20.entries.transfer.dispatch_tag = "00000000";
  expect(() => parseArtifact(wrongTag)).toThrow();

  const wrongSpan = clone();
  wrongSpan.sil_abi.contracts.KCC20.compiled.state_span.len = 112;
  expect(() => parseArtifact(wrongSpan)).toThrow();

  // A non-KCC20 contract never parses as a KCC20 template.
  expect(() => parseArtifact(ARTIFACT, "PublicMint")).toThrow();
});

function legacyRedeem() {
  const owner = hex(LEGACY.owner_hex);
  const state = kcc20.addressPresenceOwned(owner, BigInt(LEGACY.amount));
  expect(state.identifierType).toBe(LEGACY.identifier_type);
  const placeholder = [
    0x20,
    ...new Array(32).fill(0),
    0x01,
    0x00,
    0x08,
    ...new Array(8).fill(0),
    0x01,
    0x00,
  ];
  const template: kcc20.Kcc20Template = {
    script: concatBytes(
      Uint8Array.from(placeholder),
      hex(LEGACY.template_tail_hex),
    ),
    stateStart: LEGACY.state_start,
    maxIns: 4,
    maxOuts: 4,
  };
  return { state, redeem: kcc20.materializeKcc20Script(template, state) };
}

test("6. classifier: standard, legacy, lookalike, and embedded-pattern scripts", () => {
  // Argent prefix || vector state || suffix → standard, with the vector's amount.
  const standard = classifyRedeem(standardRedeem(VECTOR_STATE));
  expect(standard.family).toBe("kcc20-standard");
  if (standard.family === "kcc20-standard") {
    expect(String(standard.state.amount)).toBe(
      String(V.state_encoding.state.amount),
    );
    expect(standard.templateHash).toBe(TEMPLATE.templateHash);
    expect(standard.stateOffset).toBe(TEMPLATE.stateOffset);
    expectStatesEqual(standard.state, VECTOR_STATE);
  }

  // Legacy 46-byte state built by the SDK → kron-legacy, and it reproduces the mainnet bytes.
  const { state: legacyState, redeem } = legacyRedeem();
  const mainnetPrefix = hex(LEGACY.mainnet_state_prefix_hex);
  expect(bytesToHex(redeem.subarray(0, mainnetPrefix.length))).toBe(
    LEGACY.mainnet_state_prefix_hex,
  );
  const legacy = classifyRedeem(redeem);
  expect(legacy.family).toBe("kron-legacy");
  if (legacy.family === "kron-legacy") {
    expect(bytesToHex(legacy.state.ownerIdentifier)).toBe(LEGACY.owner_hex);
    expect(legacy.state.identifierType).toBe(legacyState.identifierType);
    expect(String(legacy.state.amount)).toBe(LEGACY.amount);
    expect(legacy.state.isMinter).toBe(false);
  }

  // 46-byte legacy shape with type = 0x04 → unknown.
  const lookalike = Uint8Array.from([
    0x20,
    ...randomBytes(32),
    0x01,
    0x04,
    0x08,
    ...randomBytes(8),
    0x01,
    0x00,
  ]);
  expect(classifyRedeem(lookalike).family).toBe("unknown");

  // A standard state whose borrow_guard and extension_commitment embed the legacy pattern at state
  // offset 47 (absolute 81): the scanner alone would misread it; the classifier must not.
  const borrowGuard = new Uint8Array(32);
  borrowGuard[0] = 0x20;
  const extensionCommitment = new Uint8Array(32);
  extensionCommitment.set([0x01, 0x03, 0x08], 0);
  extensionCommitment.set([0x01, 0x00], 11);
  const crafted = { ...VECTOR_STATE, borrowGuard, extensionCommitment };
  const craftedR = standardRedeem(crafted);
  const misread = kcc20.decodeKcc20Redeem(craftedR);
  expect(misread.template.stateStart).toBe(TEMPLATE.stateOffset + 47);
  expect(misread.state.identifierType).toBe(kcc20.IDENTIFIER.ADDRESS);
  const classified = classifyRedeem(craftedR);
  expect(classified.family).toBe("kcc20-standard");
  expect(classified.family).not.toBe("kron-legacy");
  if (classified.family === "kcc20-standard") {
    expectStatesEqual(classified.state, crafted);
  }

  // Same script with an invalid borrow_scheme: still scanner-readable, but the veto returns unknown.
  const vetoed = craftedR.slice();
  vetoed[TEMPLATE.stateOffset + 45] = 0x07;
  expect(kcc20.decodeKcc20Redeem(vetoed).template.stateStart).toBe(
    TEMPLATE.stateOffset + 47,
  );
  expect(classifyRedeem(vetoed).family).toBe("unknown");

  // Standard framing with the transfer tag stripped from the suffix → unknown, not legacy.
  const noTag = concatBytes(
    TEMPLATE.prefix,
    encodeState(crafted),
    Uint8Array.of(0x6c, 0x76),
  );
  expect(classifyRedeem(noTag).family).toBe("unknown");
});

test("isStandardOwnedBy follows the owner scheme", () => {
  const pubkey = randomBytes(32);
  const other = randomBytes(32);
  const at = (ownerScheme: number, owner: Uint8Array) => ({
    ...VECTOR_STATE,
    ownerScheme,
    owner,
  });
  expect(isStandardOwnedBy(at(0x00, pubkey), pubkey)).toBe(true);
  expect(isStandardOwnedBy(at(0x00, pubkey), other)).toBe(false);
  expect(isStandardOwnedBy(at(0x01, hash(pubkey)), pubkey)).toBe(true);
  expect(isStandardOwnedBy(at(0x01, pubkey), pubkey)).toBe(false);
  expect(isStandardOwnedBy(at(0x01, hash(pubkey)), other)).toBe(false);
  for (const scheme of [0x02, 0x03, 0x04]) {
    expect(isStandardOwnedBy(at(scheme, pubkey), pubkey)).toBe(false);
    expect(isStandardOwnedBy(at(scheme, hash(pubkey)), pubkey)).toBe(false);
  }
});

test("7. 20,000 generated standard states never classify as kron-legacy", () => {
  const families: Record<string, number> = {};
  for (let i = 0; i < 20_000; i++) {
    const r = randomBytes(8 + 32 * 3 + 2);
    const state: KCC20State = {
      amount: BigInt.asUintN(63, r.readBigUInt64LE(0)),
      owner: r.subarray(8, 40),
      ownerScheme: r[104] % 5,
      borrowScheme: r[105] % 4,
      borrowGuard: r.subarray(40, 72),
      extensionCommitment: r.subarray(72, 104),
    };
    const family = classifyRedeem(standardRedeem(state)).family;
    families[family] = (families[family] ?? 0) + 1;
  }
  expect(families).toEqual({ "kcc20-standard": 20_000 });
});

// Two real mainnet programs, as kascov serves them: the small build and the large one.
const MAINNET_PROGRAM = hex(fixture("standard-program.hex").toString("utf8").trim());
const MAINNET_PROGRAM_FF3 = hex(
  fixture("standard-program-ff3.hex").toString("utf8").trim(),
);

test("7. template allowlist: only a proven program is spendable", () => {
  expect(MAINNET_PROGRAM.length).toBe(4031);
  expect(STANDARD_TEMPLATES).toHaveProperty(
    "9703112ee6e3555107cd168858992b77d3b74f655205b2b463b1f9ec2ec73cf7",
  );
  expect(MAINNET_PROGRAM.length - 34 - STATE_LEN).toBe(3885);
  expect(supportsStandardTransfer(MAINNET_PROGRAM)).toBe(true);

  // The second live build: same state layout, more code, proven by preflight.
  expect(MAINNET_PROGRAM_FF3.length).toBe(11458);
  expect(supportsStandardTransfer(MAINNET_PROGRAM_FF3)).toBe(true);
  const ff3Edit = MAINNET_PROGRAM_FF3.slice();
  ff3Edit[MAINNET_PROGRAM_FF3.length - 1] ^= 0x01;
  expect(supportsStandardTransfer(ff3Edit)).toBe(false);

  // One suffix byte off: same classification, different code.
  const suffixEdit = MAINNET_PROGRAM.slice();
  suffixEdit[MAINNET_PROGRAM.length - 1] ^= 0x01;
  expect(classifyRedeem(suffixEdit).family).toBe("kcc20-standard");
  expect(supportsStandardTransfer(suffixEdit)).toBe(false);

  // A different template hash with the canonical suffix.
  const hashEdit = MAINNET_PROGRAM.slice();
  hashEdit[2] ^= 0x01;
  expect(classifyRedeem(hashEdit).family).toBe("kcc20-standard");
  expect(supportsStandardTransfer(hashEdit)).toBe(false);

  const { redeem } = legacyRedeem();
  expect(classifyRedeem(redeem).family).toBe("kron-legacy");
  expect(supportsStandardTransfer(redeem)).toBe(false);
});
