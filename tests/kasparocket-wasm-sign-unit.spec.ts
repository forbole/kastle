import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { schnorr } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "viem";
import init, { Transaction } from "@/wasm/core/kaspa";
import { planDigests } from "@/lib/kasparocket/adapter";
import { kaspaRocketWalletDigest } from "@/lib/kasparocket/signer";
import { signInputDigest } from "@/lib/wallet/sign-script";
import { REAL_P2PKH, realPlan } from "./fixtures/kasparocket-real-buy";

// The hand-over to the WASM signer, on the real FOUR buy: the popup's
// `kaspaRocketWalletDigest` builds the WASM Transaction the background signs,
// and the background signs it with the hot wallet's own `signInputDigest`.
// The key is a throwaway (the plan's wallet key is in no test), so each
// signature is checked against the plan's own digest under the throwaway
// key: it verifies only if WASM hashed exactly what the server prepared.
// Sign and verify locally; nothing is submitted.

const here = path.dirname(fileURLToPath(import.meta.url));
// Throwaway key, unit tests only, never funded (as in dotk-signer-unit).
const TEST_KEY =
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
const TEST_XONLY = bytesToHex(
  schnorr.getPublicKey(hexToBytes(`0x${TEST_KEY}`)),
).slice(2);

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(path.join(here, "../assets/kaspa_bg.wasm")),
  });
});

const hotWallet = {
  signInputDigest: (tx: Transaction, i: number) =>
    signInputDigest(tx, i, TEST_KEY),
};

test("the server's transaction as sent is not WASM safe-JSON (why the hand-over converts)", () => {
  const raw = JSON.stringify(realPlan().transactions[0].tx);
  expect(() => Transaction.deserializeFromSafeJSON(raw)).toThrow(
    /missing field `transactionId`/,
  );
});

test("★ the real plan through the popup's hand-over: WASM signs all six p2pkh inputs, each verifies against the plan's own digest", async () => {
  const plan = realPlan();
  const instructions = plan.transactions[0].signingInstructions.filter(
    (i) => i.kind === "p2pkh",
  );
  expect(instructions.map((i) => i.inputIndex)).toEqual([2, 3, 4, 5, 6, 7]);
  // The plan's own digests: the server's prepared sighash, equal to the one
  // recomputed locally from the plan's transaction.
  const local = planDigests(plan);
  for (const ins of instructions) {
    const d = local.find((x) => x.inputIndex === ins.inputIndex)!;
    expect(d.digest).toBe(ins.sighash);
  }

  const sign = kaspaRocketWalletDigest(hotWallet, plan);
  const verified: number[] = [];
  for (const ins of instructions) {
    const sig = await sign(0, ins.inputIndex);
    expect(sig.length).toBe(65);
    expect(sig[64]).toBe(0x01);
    const sig64 = sig.slice(0, 64);
    expect(
      schnorr.verify(sig64, hexToBytes(`0x${ins.sighash}`), TEST_XONLY),
    ).toBe(true);
    // Bound to this input's digest, not any of the plan's.
    const other = instructions.find((x) => x.inputIndex !== ins.inputIndex)!;
    expect(
      schnorr.verify(sig64, hexToBytes(`0x${other.sighash}`), TEST_XONLY),
    ).toBe(false);
    verified.push(ins.inputIndex);
  }
  expect(verified).toEqual(REAL_P2PKH.map((i) => i.inputIndex));
});

test("the hand-over reads the plan through the strict reader: a transaction it would refuse never reaches WASM", async () => {
  const plan = realPlan((raw) => (raw.transactions[0].tx.surprise = 1));
  let reached = false;
  const sign = kaspaRocketWalletDigest(
    {
      signInputDigest: async () => {
        reached = true;
        return new Uint8Array(65);
      },
    },
    plan,
  );
  await expect(sign(0, 2)).rejects.toThrow(/unknown field surprise/);
  expect(reached).toBe(false);
});
