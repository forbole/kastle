import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { curve, kcc20, spend } from "@kronsdk/kron-sdk";
import { bytesToHex, hexToBytes } from "viem";
import * as kaspa from "@/wasm/core/kaspa";
import init, {
  PrivateKey,
  Transaction,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { signTxWithScriptOptions } from "@/lib/wallet/sign-script";
import { KASTLE_FEE_ADDRESS } from "@/lib/bridge/bridge";
import {
  assembleKcc20Transfer,
  fundCovenantSpend,
  recipientPubkey,
  selectPieces,
  signKcc20Transfer,
} from "@/lib/kcc20/transfer";
import type { Kcc20Piece } from "@/lib/kcc20";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const COVID = "ab".repeat(32);

let key: PrivateKey;
let address: string;
let xonly: Uint8Array;
let template: kcc20.Kcc20Template;

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
  key = new PrivateKey("1".repeat(64));
  address = key.toAddress("mainnet").toString();
  xonly = hexToBytes(`0x${key.toPublicKey().toXOnlyPublicKey().toString()}`);
  // Genesis-state script: push32 owner / push1 type / push8 amount / push1 isMinter.
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
  template = {
    script: new Uint8Array([0x51, 0x52, 0x53, 0x54, ...region, 0x75, 0x51]),
    stateStart: 4,
    maxIns: 4,
    maxOuts: 4,
  };
});

function piece(
  n: number,
  amount: bigint,
  type: kcc20.IdentifierType = kcc20.IDENTIFIER.ADDRESS,
) {
  const state = {
    ...kcc20.addressPresenceOwned(xonly, amount),
    identifierType: type,
  };
  return {
    outpoint: { transactionId: n.toString(16).padStart(64, "0"), index: 0 },
    state,
    redeem: kcc20.materializeKcc20Script(template, state),
    value: 50_000_000n,
  } as Kcc20Piece;
}

test("recipient must be a mainnet schnorr address", () => {
  expect(bytesToHex(recipientPubkey(address))).toBe(bytesToHex(xonly));
  expect(() => recipientPubkey("not an address")).toThrow();
  expect(() => recipientPubkey(`kaspatest:${address.slice(6)}`)).toThrow();
});

test("pieces: presence-owned only, largest first, at most 3 inputs", () => {
  const picked = selectPieces([piece(1, 5n), piece(2, 9n), piece(3, 7n)], 10n);
  expect(picked.map((p) => String(p.state.amount))).toEqual(["9", "7"]);

  // A pubkey-owned piece needs a covenant signature the builder cannot make.
  expect(() =>
    selectPieces([piece(1, 9n, kcc20.IDENTIFIER.PUBKEY)], 1n),
  ).toThrow(/spendable/);
  expect(() =>
    selectPieces(
      [1, 2, 3, 4].map((n) => piece(n, 1n)),
      4n,
    ),
  ).toThrow(/pieces/);
  // The error names the max: the three largest pieces, in display units.
  expect(() =>
    selectPieces(
      [100n, 200n, 300n, 400n].map((a, n) => piece(n, a)),
      1000n,
      2,
    ),
  ).toThrow(/send at most 9 at once/);
  expect(() =>
    selectPieces(
      [100n, 200n, 300n, 400n].map((a, n) => piece(n, a)),
      1000n,
      2,
      "sell",
    ),
  ).toThrow(/sell at most 9 at once/);

  // A minter piece's amount is mint authority, not spendable balance.
  const minter = piece(1, 9n);
  minter.state = { ...minter.state, isMinter: true };
  expect(() => selectPieces([minter], 1n)).toThrow(/spendable/);
});

function fundingUtxo(amount: bigint, n = 1) {
  return {
    entry: {},
    address,
    outpoint: { transactionId: "ee".repeat(32), index: n },
    amount,
    scriptPublicKey: payToAddressScript(address),
    blockDaaScore: 0n,
    isCoinbase: false,
  };
}

const wallet = () => ({
  getPublicKey: () => key.toPublicKey(),
  getPublicKeys: () => [],
  signMessage: () => "",
  signTx: (
    tx: Transaction,
    scripts: Parameters<typeof signTxWithScriptOptions>[1],
  ) => signTxWithScriptOptions(tx, scripts, key.toString()),
});

const shape = (tx: Transaction) => ({
  version: tx.version,
  budgets: tx.inputs.map((i) => i.computeBudget),
  covenants: tx.outputs.map((o) =>
    o.covenant
      ? `${o.covenant.authorizingInput}:${o.covenant.covenantId.toString()}`
      : null,
  ),
  values: tx.outputs.map((o) => String(o.value)),
  payload: tx.payload,
  id: tx.id,
});

test("transfer signs only the funding input; outputs and covenant bindings are exact", async () => {
  const built = assembleKcc20Transfer({
    covenantId: COVID,
    pieces: [piece(1, 100n)],
    funding: [fundingUtxo(1_000_000_000n)],
    address,
    recipient: address,
    amount: 40n,
  });
  expect(built.fundingInputIndexes).toEqual([1]);
  expect(String(built.amount)).toBe("40");
  // The fee plus the 50M dust the second covenant output adds.
  expect(String(built.kasDebit)).toBe(String(built.fee + 50_000_000n));

  const covScript = built.transaction.inputs[0].signatureScript;
  const signed = await signKcc20Transfer(wallet(), built);
  expect(signed.inputs[0].signatureScript).toBe(covScript);
  expect(signed.inputs[1].signatureScript?.length).toBeGreaterThan(0);

  // recipient + token change are covenant-bound to input 0; the last output is KAS change.
  const { values, covenants } = shape(signed);
  expect(covenants).toEqual([`0:${COVID}`, `0:${COVID}`, null]);
  expect(values.slice(0, 2)).toEqual(["50000000", "50000000"]);
  // inputs 50_000_000 + 1_000_000_000 = outputs + fee
  const outTotal = values.reduce((s, v) => s + BigInt(v), 0n);
  expect(String(1_050_000_000n - outTotal)).toBe(String(built.fee));
});

test("no zero or dust KAS change: the remainder folds into the fee", () => {
  const args = {
    covenantId: COVID,
    pieces: [piece(1, 100n)],
    address,
    recipient: address,
    amount: 40n,
  };
  // A tiny change output inflates storage mass, so scan up from just below
  // the build threshold (~72.4M sompi) until the change drops out.
  for (let funds = 72_000_000n; funds < 74_000_000n; funds += 100n) {
    let built;
    try {
      built = assembleKcc20Transfer({ ...args, funding: [fundingUtxo(funds)] });
    } catch {
      continue;
    }
    if (built.transaction.outputs.length === 2) {
      const out = built.transaction.outputs.reduce(
        (s: bigint, o: { value: bigint }) => s + BigInt(o.value),
        0n,
      );
      // Nothing is left behind: inputs = outputs + fee.
      expect(String(50_000_000n + funds - out)).toBe(String(built.fee));
      return;
    }
  }
  throw new Error("no dust-change case found");
});

test("insufficient KAS for the fee is reported", () => {
  expect(() =>
    assembleKcc20Transfer({
      covenantId: COVID,
      pieces: [piece(1, 100n)],
      funding: [fundingUtxo(1_000n)],
      address,
      recipient: address,
      amount: 40n,
    }),
  ).toThrow(/network fee/);
});

test("safe-JSON bridge keeps v1 fields and the signature survives it", async () => {
  const args = {
    covenantId: COVID,
    pieces: [piece(1, 100n)],
    funding: [fundingUtxo(1_000_000_000n)],
    address,
    recipient: address,
    amount: 40n,
  };
  const built = assembleKcc20Transfer(args);
  const before = shape(built.transaction);
  const rt = Transaction.deserializeFromSafeJSON(
    built.transaction.serializeToSafeJSON(),
  );
  expect(shape(rt)).toEqual(before);

  // Sign the round-tripped tx as the background does, then bridge it back.
  const signed = await signTxWithScriptOptions(
    rt,
    built.fundingInputIndexes.map((inputIndex) => ({
      inputIndex,
      signType: "All" as const,
    })),
    key.toString(),
  );
  const back = Transaction.deserializeFromSafeJSON(
    signed.serializeToSafeJSON(),
  );
  const direct = await signKcc20Transfer(wallet(), assembleKcc20Transfer(args));
  expect(back.id).toBe(direct.id);
});

test("Kastle fee is the last output, after change, and comes out of change", async () => {
  const send = kcc20.buildKcc20Send(
    (await import("@/wasm/core/kaspa")) as any,
    template,
    [
      {
        ...piece(1, 100n).outpoint,
        value: 50_000_000n,
        state: piece(1, 100n).state,
      },
    ],
    xonly,
    40n,
    1,
    COVID,
  );
  const args = {
    spend: send,
    funding: [fundingUtxo(1_000_000_000n)],
    address,
  };
  const plain = fundCovenantSpend(args);
  const built = fundCovenantSpend({ ...args, kastleFee: 30_000_000n });
  const signed = await signKcc20Transfer(wallet(), built);

  const { values, covenants } = shape(signed);
  // recipient, token change, KAS change, then the fee: SDK indexes untouched.
  expect(covenants).toEqual([`0:${COVID}`, `0:${COVID}`, null, null]);
  expect(values[3]).toBe("30000000");
  expect(signed.outputs[3].scriptPublicKey.toString()).toBe(
    payToAddressScript(KASTLE_FEE_ADDRESS.mainnet).toString(),
  );
  // The fee output costs the user exactly its value plus its own mass.
  const changeDelta =
    BigInt(shape(plain.transaction).values[2]) - BigInt(values[2]);
  expect(String(changeDelta - 30_000_000n)).toBe(String(built.fee - plain.fee));
  const outTotal = values.reduce((s, v) => s + BigInt(v), 0n);
  expect(String(1_050_000_000n - outTotal)).toBe(String(built.fee));
});

test("final fee covers the final tx; change under the fee-output minimum takes another input", () => {
  const k = kaspa as unknown as Parameters<typeof spend.estimateNativeFee>[0];
  const args = {
    covenantId: COVID,
    pieces: [piece(1, 100n)],
    address,
    recipient: address,
    amount: 40n,
  };
  // From 73M (past the ~72.4M build threshold) one input alone covers the
  // send, so a second input is only taken for change under FEE_OUT_MIN.
  assembleKcc20Transfer({ ...args, funding: [fundingUtxo(73_000_000n)] });
  let usedSecondInput = false;
  for (let big = 73_000_000n; big <= 140_000_000n; big += 500_000n) {
    const built = assembleKcc20Transfer({
      ...args,
      // Smaller than big, so it sorts second and only joins when needed.
      funding: [fundingUtxo(big, 1), fundingUtxo(30_000_000n, 2)],
    });
    const asm = { ...built, totalIn: 0n, covenantOut: 0n, change: 0n };
    expect(built.fee >= spend.estimateNativeFee(k, "mainnet", asm, 1)).toBe(
      true,
    );
    const change = built.transaction.outputs[2];
    if (change) expect(BigInt(change.value) >= curve.FEE_OUT_MIN).toBe(true);
    if (built.fundingInputIndexes.length === 2) usedSecondInput = true;
  }
  expect(usedSecondInput).toBe(true);
});
