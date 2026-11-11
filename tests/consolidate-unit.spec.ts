import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, { PrivateKey, payToAddressScript } from "@/wasm/core/kaspa";
import type { IUtxoEntry } from "@/wasm/core/kaspa";
import {
  ConsolidationError,
  ConsolidationPlan,
  isConsolidatableEntry,
  planConsolidation,
  planConsolidationRound,
  runConsolidation,
} from "@/lib/consolidate";
import { UnsignedInputsError } from "@/lib/wallet/transaction-batch";
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

// A sweep signs only inputs locked to the wallet's own key; any other input
// went out with an empty signature script and the node rejected the round
// ("opcode requires at least 2 but stack has only 1", 2.62.2).
test.describe("planConsolidation spends only entries the wallet can sign", () => {
  test.beforeAll(async () => {
    await init({
      module_or_path: fs.readFileSync(
        path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
      ),
    });
  });

  const COVENANT_ID = "11".repeat(32);
  const p2shEntry = () =>
    ({
      outpoint: { transactionId: "f1".repeat(32), index: 0 },
      amount: 206_040_000n,
      scriptPublicKey: { version: 0, script: `aa20${"22".repeat(32)}87` },
      blockDaaScore: 1_000n,
      isCoinbase: false,
      covenantId: COVENANT_ID,
    }) as unknown as IUtxoEntry;
  const otherKeyEntry = () => {
    const other = new PrivateKey(KEY_B).toPublicKey().toAddress("mainnet");
    return {
      address: other,
      outpoint: { transactionId: "f2".repeat(32), index: 0 },
      amount: 206_040_000n,
      scriptPublicKey: payToAddressScript(other),
      blockDaaScore: 1_000n,
      isCoinbase: false,
    } as unknown as IUtxoEntry;
  };
  const withOutpoint = (entry: IUtxoEntry, id: string, extra: object) =>
    ({
      ...entry,
      outpoint: { transactionId: id, index: 0 },
      ...extra,
    }) as unknown as IUtxoEntry;
  const dagInfo = (virtualDaaScore: bigint) => ({
    getBlockDagInfo: async () => ({ virtualDaaScore }) as never,
  });

  test("81 own + a P2SH covenant + another key's P2PK: foreign entries are never planned", async () => {
    const foreign = [p2shEntry(), otherKeyEntry()];
    const result = (await planConsolidation({
      entries: [...syntheticEntries(Array(81).fill(206_040_000n)), ...foreign],
      changeAddress: senderAddress().toString(),
      networkId: "mainnet",
    })) as ConsolidationPlan;
    expect(result.skipped).toBe(2);
    // 81 spendable → one 80-input chunk, the lone remainder stays out
    expect(result.transactions.length).toBe(1);
    expect(result.inputCount).toBe(80);
    const planned = new Set(
      result.transactions.flatMap((tx) =>
        tx.transaction.inputs.map((input) =>
          outpointKey(input.previousOutpoint),
        ),
      ),
    );
    for (const entry of foreign) {
      expect(planned.has(outpointKey(entry.outpoint))).toBe(false);
    }
  });

  test("the single-transaction short-circuit runs on the spendable set", async () => {
    // 82 entries, but only 80 the key can sign: already one transaction
    const result = await planConsolidation({
      entries: [
        ...syntheticEntries(Array(80).fill(206_040_000n)),
        p2shEntry(),
        otherKeyEntry(),
      ],
      changeAddress: senderAddress().toString(),
      networkId: "mainnet",
    });
    expect(result).toBeUndefined();
  });

  test("an own entry bound to a covenant is not spendable", () => {
    const [own] = syntheticEntries([206_040_000n]);
    const address = senderAddress().toString();
    expect(isConsolidatableEntry(own, address)).toBe(true);
    expect(
      isConsolidatableEntry(
        withOutpoint(own, own.outpoint.transactionId, {
          covenantId: COVENANT_ID,
        }),
        address,
      ),
    ).toBe(false);
  });

  test("an immature coinbase is skipped, a mature one is planned", async () => {
    const base = syntheticEntries(Array(81).fill(206_040_000n));
    const immature = withOutpoint(base[0], "c1".repeat(32), {
      isCoinbase: true,
      blockDaaScore: 10_000n - 99n,
    });
    const mature = withOutpoint(base[0], "c2".repeat(32), {
      isCoinbase: true,
      blockDaaScore: 10_000n - 100n,
    });
    const result = (await planConsolidation({
      entries: [...base, immature, mature],
      changeAddress: senderAddress().toString(),
      networkId: "mainnet",
      rpcClient: dagInfo(10_000n),
    })) as ConsolidationPlan;
    expect(result.skipped).toBe(1);
    expect(result.maturityUnknown).toBe(false);
    // 82 spendable → 80 + 2
    expect(result.transactions.length).toBe(2);
    const planned = result.transactions.flatMap((tx) =>
      tx.transaction.inputs.map((input) => outpointKey(input.previousOutpoint)),
    );
    expect(planned).toContain(outpointKey(mature.outpoint));
    expect(planned).not.toContain(outpointKey(immature.outpoint));
  });

  test("a failing getBlockDagInfo still plans, flagged maturityUnknown", async () => {
    const base = syntheticEntries(Array(81).fill(206_040_000n));
    const coinbase = withOutpoint(base[0], "c3".repeat(32), {
      isCoinbase: true,
      blockDaaScore: 1_000n,
    });
    const result = (await planConsolidation({
      entries: [...base, coinbase],
      changeAddress: senderAddress().toString(),
      networkId: "mainnet",
      rpcClient: { getBlockDagInfo: () => Promise.reject(new Error("down")) },
    })) as ConsolidationPlan;
    expect(result.maturityUnknown).toBe(true);
    expect(result.skipped).toBe(0);
    expect(result.inputCount).toBe(82);
  });

  test("token state / other key and immature coinbase are counted apart", async () => {
    const base = syntheticEntries(Array(81).fill(206_040_000n));
    const immature = withOutpoint(base[0], "c4".repeat(32), {
      isCoinbase: true,
      blockDaaScore: 1_000n,
    });
    const result = (await planConsolidation({
      entries: [...base, p2shEntry(), otherKeyEntry(), immature],
      changeAddress: senderAddress().toString(),
      networkId: "mainnet",
      rpcClient: dagInfo(1_050n),
    })) as ConsolidationPlan;
    expect(result.skippedCovenant).toBe(2);
    expect(result.skippedImmature).toBe(1);
    expect(result.skipped).toBe(3);
  });

  test("all entries dropped: no plan, the split is still reported", async () => {
    const { plan, screen } = await planConsolidationRound({
      entries: [p2shEntry(), otherKeyEntry()],
      changeAddress: senderAddress().toString(),
      networkId: "mainnet",
      rpcClient: dagInfo(1_050n),
    });
    expect(plan).toBeUndefined();
    expect(screen).toEqual({
      spendable: 0,
      skippedCovenant: 2,
      skippedImmature: 0,
      maturityUnknown: false,
    });
  });

  test("the script match ignores hex case", () => {
    const address = senderAddress().toString();
    const own = syntheticEntries([206_040_000n])[0];
    const script = payToAddressScript(address).script;
    for (const variant of [script.toUpperCase(), script.toLowerCase()]) {
      const entry = {
        ...own,
        scriptPublicKey: { version: 0, script: variant },
      } as unknown as IUtxoEntry;
      expect(isConsolidatableEntry(entry, address)).toBe(true);
    }
  });

  test("an unsigned input stops the round as a signing failure, not a rejection", async () => {
    let submits = 0;
    const pending = {
      transaction: { inputs: [] },
      feeAmount: 1n,
    } as never;
    const signer = {
      signTx: async () =>
        ({
          inputs: [{ signatureScript: "aa" }, { signatureScript: "" }],
        }) as never,
    };
    const rpc = {
      submitTransaction: async () => {
        submits++;
        return { transactionId: "00".repeat(32) } as never;
      },
    };
    const run = runConsolidation([pending, pending], signer, rpc);
    await expect(run).rejects.toBeInstanceOf(UnsignedInputsError);
    await expect(run).rejects.toThrow(
      "1 of 2 inputs are unsigned; this transaction was not submitted.",
    );
    expect(submits).toBe(0);
  });
});
