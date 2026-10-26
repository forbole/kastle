import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { kcc20 } from "@kronsdk/kron-sdk";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils";
import init, {
  addressFromScriptPublicKey,
  payToScriptHashScript,
  PrivateKey,
  RpcClient,
} from "@/wasm/core/kaspa";
import { classifiedPieces, verifiedPieces } from "@/lib/kcc20";
import { classifyRedeem } from "@/lib/kcc20/classify";
import { parseArtifact } from "@/lib/kcc20/standard/artifact";
import { encodeState, KCC20State } from "@/lib/kcc20/standard/state";

registerHooks({
  load: (url, ctx, next) =>
    /\.(png|svg)$/.test(url)
      ? { format: "module", source: "export default ''", shortCircuit: true }
      : next(url, ctx),
});
const { buildKcc20Transfer, Kcc20TransferError } = await import(
  "@/lib/kcc20/transfer"
);

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(TESTS_DIR, "fixtures/kcc20");
const COVID = "ab".repeat(32);

const fixture = (name: string): any =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name)).toString("utf8"));
const V = fixture("conformance.json");
const TEMPLATE = parseArtifact(fixture("program-artifact.json"));
const standardRedeem = (state: KCC20State) =>
  concatBytes(TEMPLATE.prefix, encodeState(state), TEMPLATE.suffix);

let address: string;
let xonly: Uint8Array;
let vectorState: KCC20State;
let legacyTemplate: kcc20.Kcc20Template;

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
  // A key whose x-only pubkey ends in 0x20, so a crafted standard state can
  // embed a legacy pattern the bare scanner reads as owned by this wallet.
  for (let i = 1; ; i++) {
    const key = new PrivateKey(i.toString(16).padStart(64, "0"));
    const pub = hexToBytes(key.toPublicKey().toXOnlyPublicKey().toString());
    if (pub[31] !== 0x20) continue;
    address = key.toAddress("mainnet").toString();
    xonly = pub;
    break;
  }
  const s = V.state_encoding.state;
  vectorState = {
    amount: BigInt(s.amount),
    owner: xonly,
    // P2PK_SCHNORR: owned by this wallet's key.
    ownerScheme: 0x00,
    borrowScheme: hexToBytes(s.borrow_scheme_hex)[0],
    borrowGuard: hexToBytes(s.borrow_guard_hex),
    extensionCommitment: hexToBytes(s.extension_commitment_hex),
  };
  // Same genesis-state shape as the transfer spec's template.
  const region = [
    0x20,
    ...new Array(32).fill(0),
    0x01,
    kcc20.IDENTIFIER.ADDRESS,
    0x08,
    ...new Array(8).fill(0),
    0x01,
    0x00,
  ];
  legacyTemplate = {
    script: new Uint8Array([0x51, 0x52, 0x53, 0x54, ...region, 0x75, 0x51]),
    stateStart: 4,
    maxIns: 4,
    maxOuts: 4,
  };
});

/** A standard state whose borrow_guard / extension_commitment spell a legacy ADDRESS state owned by `xonly`. */
function craftedStandardRedeem() {
  const borrowGuard = new Uint8Array(32);
  borrowGuard[0] = 0x20;
  borrowGuard.set(xonly.subarray(0, 31), 1);
  const extensionCommitment = new Uint8Array(32);
  extensionCommitment.set([0x01, kcc20.IDENTIFIER.ADDRESS, 0x08], 0);
  extensionCommitment[3] = 7;
  extensionCommitment.set([0x01, 0x00], 11);
  return standardRedeem({ ...vectorState, borrowGuard, extensionCommitment });
}

const p2shOf = (redeem: Uint8Array) =>
  addressFromScriptPublicKey(
    payToScriptHashScript(redeem),
    "mainnet",
  )!.toString();

/** An indexer claiming `redeems` at outpoints 1..n, and a node holding every one of them under COVID. */
function world(redeems: Uint8Array[]) {
  const utxos = redeems.map((redeem, i) => ({
    outpoint: {
      transactionId: (i + 1).toString(16).padStart(64, "0"),
      index: 0,
    },
    redeemScriptHex: bytesToHex(redeem),
  }));
  const entries = utxos.map((u, i) => ({
    outpoint: u.outpoint,
    address: p2shOf(redeems[i]),
    entry: { covenantId: COVID, amount: 50_000_000n },
  }));
  const indexer = {
    tokenUtxos: async () => utxos,
  } as unknown as Parameters<typeof verifiedPieces>[0];
  const rpc = {
    getUtxosByAddresses: async () => ({ entries }),
  } as unknown as RpcClient;
  return { indexer, rpc, utxos };
}

test("a standard redeem is never a legacy piece", async () => {
  const crafted = craftedStandardRedeem();
  // The bare scanner would count the crafted script as this wallet's ADDRESS balance.
  const misread = kcc20.decodeKcc20Redeem(crafted).state;
  expect(misread.identifierType).toBe(kcc20.IDENTIFIER.ADDRESS);
  expect(bytesToHex(misread.ownerIdentifier)).toBe(bytesToHex(xonly));
  expect(classifyRedeem(crafted).family).toBe("kcc20-standard");

  const legacyState = kcc20.addressPresenceOwned(xonly, 5n);
  const legacy = kcc20.materializeKcc20Script(legacyTemplate, legacyState);
  const { indexer, rpc, utxos } = world([
    standardRedeem(vectorState),
    crafted,
    legacy,
  ]);

  const pieces = await verifiedPieces(indexer, rpc, "T", address, COVID);
  expect(pieces.map((p) => p.outpoint)).toEqual([utxos[2].outpoint]);
  expect(String(pieces[0].state.amount)).toBe("5");

  const split = await classifiedPieces(indexer, rpc, "T", address, COVID);
  expect(split.legacy.map((p) => p.outpoint)).toEqual([utxos[2].outpoint]);
  expect(split.standard.map((p) => p.outpoint)).toEqual([
    utxos[0].outpoint,
    utxos[1].outpoint,
  ]);
});

test("a standard piece the node does not hold is dropped like a legacy one", async () => {
  const { indexer, rpc } = world([standardRedeem(vectorState)]);
  const empty = {
    getUtxosByAddresses: async () => ({ entries: [] }),
  } as unknown as RpcClient;
  expect(
    (await classifiedPieces(indexer, rpc, "T", address, COVID)).standard,
  ).toHaveLength(1);
  expect(
    (await classifiedPieces(indexer, empty, "T", address, COVID)).standard,
  ).toHaveLength(0);
});

async function transferCode(
  redeems: Uint8Array[],
  family: "kron-legacy" | "kcc20-standard",
) {
  const { utxos, rpc } = world(redeems);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ result: utxos }))) as typeof fetch;
  try {
    await buildKcc20Transfer({
      token: { tick: "T", covenantId: COVID, meta: undefined, family },
      address,
      recipient: address,
      amount: 1n,
      rpc,
    });
    return "built";
  } catch (e) {
    return e instanceof Kcc20TransferError ? e.code : String(e);
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("only standard pieces owned: unsupported-schema, not insufficient-balance", async () => {
  expect(
    await transferCode(
      [standardRedeem(vectorState), craftedStandardRedeem()],
      "kron-legacy",
    ),
  ).toBe("unsupported-schema");
  // A standard row goes to the standard builder (kcc20-standard-build.spec.ts), never this refusal.
  expect(await transferCode([], "kcc20-standard")).not.toBe(
    "unsupported-schema",
  );
  // No pieces at all is still a balance problem.
  expect(await transferCode([], "kron-legacy")).toBe("insufficient-balance");
});
