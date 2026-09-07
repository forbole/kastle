import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  IGetFeeEstimateResponse,
  PrivateKey,
  createTransactions,
  kaspaToSompi,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { priorityFeeFromEstimate } from "@/lib/kaspa";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

const estimateAt = (
  low: number,
  normal: number,
  high: number,
): IGetFeeEstimateResponse =>
  ({
    estimate: {
      lowBuckets: [{ feerate: low, estimatedSeconds: 1 }],
      normalBuckets: [{ feerate: normal, estimatedSeconds: 1 }],
      priorityBucket: { feerate: high, estimatedSeconds: 1 },
    },
  }) as IGetFeeEstimateResponse;

// getFeeEstimate on mainnet, 2026-09-07: feerate 100 on every bucket.
const IDLE_MAINNET = estimateAt(100, 100, 100);
const BASE_FEE = 315_400; // useKasFeeEstimate, two inputs

test.describe("priority fee derivation (Defects 2 and 3)", () => {
  // Defect 3: on Back from Confirm, usePriorityFeeEstimate starts over and
  // DetailsStep's effect used to write 0n until the RPC answered, moving a Max
  // amount twice. While either input is loading the form's value must stand.
  test("is undefined until both the estimate and the base fee have loaded", () => {
    expect(priorityFeeFromEstimate(undefined, "medium", BASE_FEE)).toBe(
      undefined,
    );
    expect(priorityFeeFromEstimate(IDLE_MAINNET, "medium", undefined)).toBe(
      undefined,
    );
  });

  // Defect 2: the whole feerate was treated as priority, so at the floor the
  // priority fee equalled the Generator's own fee and the send paid 2× the
  // fee shown.
  test("is 0 at the feerate floor, on every bucket", () => {
    for (const priority of ["low", "medium", "high"] as const) {
      expect(priorityFeeFromEstimate(IDLE_MAINNET, priority, BASE_FEE)).toBe(
        0n,
      );
    }
    expect(
      priorityFeeFromEstimate(estimateAt(50, 50, 50), "low", BASE_FEE),
    ).toBe(0n);
  });

  test("is the excess over the floor, as a share of the base fee", () => {
    const congested = estimateAt(100, 200, 1000);
    expect(priorityFeeFromEstimate(congested, "low", BASE_FEE)).toBe(0n);
    expect(priorityFeeFromEstimate(congested, "medium", BASE_FEE)).toBe(
      315_400n,
    );
    expect(priorityFeeFromEstimate(congested, "high", BASE_FEE)).toBe(
      2_838_600n,
    );
  });

  // The fee DetailsStep and ConfirmStep show is baseFee + priorityFee. Assert
  // that is what the Generator takes out of the wallet, at the floor and
  // above it, on the UTXO shape baseFee was measured on.
  test("the Generator charges exactly the fee the wallet shows", async () => {
    const sender = new PrivateKey(
      "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef",
    )
      .toPublicKey()
      .toAddress("mainnet");
    const dest = new PrivateKey(
      "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9",
    )
      .toPublicKey()
      .toAddress("mainnet");
    const entries = [5_00000000n, 5_00000000n].map((amount, i) => ({
      address: sender,
      outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
      amount,
      scriptPublicKey: payToAddressScript(sender),
      blockDaaScore: 1_000n,
      isCoinbase: false,
    }));
    const build = (address: string, priorityFee: bigint) =>
      createTransactions({
        entries,
        outputs: [{ address, amount: kaspaToSompi("1")! }],
        priorityFee,
        changeAddress: sender.toString(),
        networkId: "mainnet",
      });

    // useKasFeeEstimate({ extraOutputCount: 1 }): a 1 KAS self-send at 0n.
    const estimate = await build(sender.toString(), 0n);
    const baseFee = Number(estimate.transactions[0].feeAmount);
    expect(baseFee).toBe(BASE_FEE);

    for (const [feeEstimate, priority] of [
      [IDLE_MAINNET, "medium"],
      [estimateAt(100, 200, 1000), "medium"],
      [estimateAt(100, 200, 1000), "high"],
    ] as const) {
      const priorityFee = priorityFeeFromEstimate(
        feeEstimate,
        priority,
        baseFee,
      )!;
      const { transactions } = await build(dest.toString(), priorityFee);
      const paid = transactions[transactions.length - 1];
      const inputs = paid.transaction.inputs.reduce(
        (sum, input) => sum + BigInt(input.utxo?.amount ?? 0),
        0n,
      );
      const outputs = paid.transaction.outputs.reduce(
        (sum, output) => sum + BigInt(output.value),
        0n,
      );
      const shown = BigInt(baseFee) + priorityFee;
      expect(paid.feeAmount).toBe(shown);
      expect(inputs - outputs).toBe(shown);
    }
  });
});
