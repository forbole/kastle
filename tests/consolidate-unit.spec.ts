import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, { PrivateKey, payToAddressScript } from "@/wasm/core/kaspa";
import type { IUtxoEntry } from "@/wasm/core/kaspa";
import {
  ConsolidationError,
  ConsolidationPlan,
  planConsolidation,
} from "@/lib/consolidate";
import { isShortfall, planTransfer } from "@/lib/sendFee";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

const KEY_A =
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
const KEY_B =
  "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";

const senderAddress = () =>
  new PrivateKey(KEY_A).toPublicKey().toAddress("mainnet");
const destAddress = () =>
  new PrivateKey(KEY_B).toPublicKey().toAddress("mainnet").toString();

// Synthetic UTXOs of the given amounts on the sender's address.
const syntheticEntries = (amounts: readonly bigint[]) => {
  const sender = senderAddress();
  return amounts.map((amount, i) => ({
    address: sender,
    outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(sender),
    blockDaaScore: 1_000n,
    isCoinbase: false,
  })) as unknown as IUtxoEntry[];
};

const outpointKey = (o: { transactionId: string; index: number }) =>
  `${o.transactionId}:${o.index}`;

// The measured mainnet wallet: 11,446 × 2.0604 KAS, 2 × 4.12, 1 × 3.00.
const measuredWallet = () =>
  syntheticEntries([
    ...Array.from({ length: 11_446 }, () => 206_040_000n),
    412_000_000n,
    412_000_000n,
    300_000_000n,
  ]);

const plan = (entries: readonly IUtxoEntry[]) =>
  planConsolidation({
    entries,
    changeAddress: senderAddress().toString(),
    networkId: "mainnet",
  });

// Bigint assertions go through Number/String: a failing toBe on a bigint
// crash-loops the Playwright worker.
test.describe("planConsolidation", () => {
  let entries: IUtxoEntry[];
  let measured: ConsolidationPlan;

  test.beforeAll(async () => {
    await init({
      module_or_path: fs.readFileSync(
        path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
      ),
    });
    entries = measuredWallet();
    const result = await plan(entries);
    if (!result) throw new Error("measured wallet produced no plan");
    measured = result;
  });

  // Measured: 144 transactions, fee 1,287,284,600 sompi (12.873 KAS) — 143 ×
  // 80-input sweeps at 8,994,600 sompi each plus the 9-input remainder.
  test("the measured shape: 144 sweeps, fee ≈ 12.9 KAS", () => {
    expect(measured.transactions.length).toBe(144);
    expect(measured.inputCount).toBe(11_449);
    expect(measured.outputCount).toBe(144);
    const feeKas = Number(measured.fee) / 1e8;
    expect(Math.abs(feeKas - 12.9)).toBeLessThan(0.2);
  });

  test("every transaction has at most 2 outputs", () => {
    for (const tx of measured.transactions) {
      expect(tx.transaction.outputs.length).toBeLessThanOrEqual(2);
    }
  });

  test("chunks are disjoint and cover the input set", () => {
    const spent = measured.transactions.flatMap((tx) =>
      tx.transaction.inputs.map((input) => outpointKey(input.previousOutpoint)),
    );
    expect(new Set(spent).size).toBe(spent.length);
    expect(new Set(spent)).toEqual(
      new Set(entries.map((entry) => outpointKey(entry.outpoint))),
    );
  });

  test("the last chunk is the 9-input remainder", () => {
    const last = measured.transactions[measured.transactions.length - 1];
    expect(last.transaction.inputs.length).toBe(9);
    for (const tx of measured.transactions.slice(0, -1)) {
      expect(tx.transaction.inputs.length).toBe(80);
    }
  });

  test("below the threshold: 80 entries plan nothing, 81 plan one sweep", async () => {
    expect(await plan(syntheticEntries(Array(80).fill(206_040_000n)))).toBe(
      undefined,
    );
    const one = await plan(syntheticEntries(Array(81).fill(206_040_000n)));
    // The 81st entry is a lone remainder: already one UTXO, left out.
    expect(one?.transactions.length).toBe(1);
    expect(one?.inputCount).toBe(80);
  });

  test("no entries throws a typed error", async () => {
    const error = await plan([]).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConsolidationError);
    expect((error as ConsolidationError).code).toBe("no-entries");
  });

  // The payoff: after one round a 2 KAS send spends one consolidated UTXO.
  // Measured: 203,600 sompi (0.002 KAS).
  test("the payoff: a 2 KAS send after consolidation costs under 0.02 KAS", async () => {
    const consolidated = syntheticEntries(
      measured.transactions.map((tx) => tx.aggregateInputAmount - tx.feeAmount),
    );
    const result = await planTransfer({
      entries: consolidated,
      amountSompi: 200_000_000n,
      outputAddress: destAddress(),
      changeAddress: senderAddress().toString(),
      priorityFee: 0n,
      networkId: "mainnet",
    });
    if (isShortfall(result)) throw new Error(`shortfall: ${result.reason}`);
    expect(Number(result.fee)).toBeLessThan(2_000_000);
  });
});
