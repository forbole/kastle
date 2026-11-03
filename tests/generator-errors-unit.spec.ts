import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  PrivateKey,
  createTransactions,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import {
  isFragmentationError,
  MAX_SEND_RESERVE_KAS,
  priorityFeeFromEstimate,
} from "@/lib/kaspa";
import { isShortfall, planTransfer } from "@/lib/sendFee";
import type { IGetFeeEstimateResponse, IUtxoEntry } from "@/wasm/core/kaspa";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

const KEY_A =
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
const KEY_B =
  "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";

const senderAddress = () =>
  new PrivateKey(KEY_A).toPublicKey().toAddress("mainnet");
const destAddress = () =>
  new PrivateKey(KEY_B).toPublicKey().toAddress("mainnet");

// `count` synthetic UTXOs of `each` sompi on the sender's address.
const syntheticEntries = (count: number, each: bigint) => {
  const sender = senderAddress();
  return Array.from({ length: count }, (_unused, i) => ({
    address: sender,
    outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
    amount: each,
    scriptPublicKey: payToAddressScript(sender),
    blockDaaScore: 1_000n,
    isCoinbase: false,
  }));
};

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

// B3: sending Max from a wallet holding ≥175 UTXOs makes the Generator throw
// one of three messages instead of retrying with fewer inputs
// (rusty-kaspa#701). ConfirmStep maps all three to one fail-screen reason. If
// a WASM upgrade changes the strings or the thresholds, this is what notices.
test.describe("Generator fragmentation errors (B3)", () => {
  const TOTAL = 300_500_000_000n; // 3005 KAS
  const RESERVE = BigInt(Math.round(MAX_SEND_RESERVE_KAS * 1e8));
  // DetailsStep: priorityFee = feerate × baseFee / 100, baseFee measured at
  // 315,400 sompi for the estimate's 1 KAS self-send (two inputs at this
  // wallet shape); feerate 1 … 1000.
  const LOW_PRIORITY_FEE = 3_154n;
  const HIGH_PRIORITY_FEE = 3_154_000n;

  // What DetailsStep's Max produces: amount = balance − (reserve + priorityFee).
  const sendMax = async (
    utxoCount: number,
    priorityFee = 0n,
    subtrahend = RESERVE + priorityFee,
  ) => {
    const sender = senderAddress();
    const dest = destAddress();
    const each = TOTAL / BigInt(utxoCount);
    const entries = syntheticEntries(utxoCount, each);
    // The wallet must hold exactly TOTAL: integer division drops up to n−1
    // sompi (44 at n=174), which would under-fund every amount derived from it.
    entries[0].amount += TOTAL - each * BigInt(utxoCount);

    return createTransactions({
      entries,
      outputs: [{ address: dest.toString(), amount: TOTAL - subtrahend }],
      priorityFee,
      changeAddress: sender.toString(),
      networkId: "mainnet",
    });
  };

  test("174 UTXOs still builds", async () => {
    const { transactions } = await sendMax(174);
    expect(transactions.length).toBeGreaterThan(0);
  });

  // The reserve alone covers the Generator's fee for 174 inputs (19,931,000
  // sompi) plus the ~0.1 KAS change the storage mass limit needs, with
  // 69,000 sompi to spare. A priority fee inside the reserve eats that.
  test("Max at 174 UTXOs builds with the priority fee on top of the reserve", async () => {
    for (const priorityFee of [LOW_PRIORITY_FEE, HIGH_PRIORITY_FEE]) {
      const { transactions, summary } = await sendMax(174, priorityFee);
      expect(transactions.length).toBeGreaterThan(0);
      // The priority fee is paid, once, by the final (payment) transaction.
      expect(transactions[transactions.length - 1].feeAmount).toBeGreaterThan(
        priorityFee,
      );
      expect(summary.fees).toBeGreaterThanOrEqual(19_931_000n + priorityFee);
    }
  });

  test("Max at 174 UTXOs fails with the priority fee inside the reserve (the cliff)", async () => {
    const error = await sendMax(174, HIGH_PRIORITY_FEE, RESERVE).then(
      () => undefined,
      (e: unknown) => e,
    );
    // Measured: 69,999 sompi is the last priority fee that builds at 0.3 flat.
    // Two different errors past that point: at 70,000 the Generator throws
    // "Mass calculation error"; at the high bucket's 3,154,000
    // (HIGH_PRIORITY_FEE) it throws "Storage mass exceeds maximum", which is
    // what is asserted here.
    expect(String(error)).toContain("Storage mass exceeds maximum");
    expect(isFragmentationError(error)).toBe(true);
  });

  for (const [utxoCount, expected] of [
    [175, "Mass calculation error"],
    [177, "Storage mass exceeds maximum"],
    [270, "Insufficient funds"],
  ] as const) {
    test(`${utxoCount} UTXOs throws "${expected}" and is classified`, async () => {
      const error = await sendMax(utxoCount).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(String(error)).toContain(expected);
      expect(isFragmentationError(error)).toBe(true);
    });
  }

  test("unrelated errors are not classified", () => {
    expect(isFragmentationError(new Error("User rejected the request"))).toBe(
      false,
    );
  });
});

// Round 2: on equal-sized UTXOs the Generator spends only the first prefix
// covering the amount, whatever it is handed, and the dust change left breaks
// the storage mass limit. planTransfer grows the selection and splits the
// surplus into a self output; every one of these threw before.
test.describe("planTransfer on equal-sized UTXOs", () => {
  test.setTimeout(300_000);

  const SHAPES = [
    {
      count: 11_449,
      each: 206_040_000n, // 2.0604 KAS
      amounts: [
        "0.5",
        "1",
        "2",
        "2.5",
        "3",
        "4",
        "4.119",
        "4.2",
        "5",
        "6.179",
        "10",
        "10.299",
        "20",
        "50",
        "100",
      ],
    },
    {
      count: 500,
      each: 200_000_000n, // 2 KAS
      amounts: ["0.5", "1", "1.95", "2", "3.95", "4"],
    },
  ];

  for (const { count, each, amounts } of SHAPES) {
    for (const priorityFee of [0n, 2_838_600n]) {
      test(`${count} × ${each} sompi builds every amount at priorityFee ${priorityFee}`, async () => {
        const entries = syntheticEntries(
          count,
          each,
        ) as unknown as IUtxoEntry[];
        const sender = senderAddress().toString();
        const failed: string[] = [];
        for (const kas of amounts) {
          const amountSompi = BigInt(Math.round(Number(kas) * 1e8));
          const plan = await planTransfer({
            entries,
            amountSompi,
            outputAddress: destAddress().toString(),
            changeAddress: sender,
            priorityFee,
            networkId: "mainnet",
          }).catch((e: unknown) => {
            failed.push(`${kas}: ${String(e)}`);
            return undefined;
          });
          if (!plan) continue;
          if (isShortfall(plan)) {
            failed.push(`${kas}: shortfall ${plan.reason}`);
            continue;
          }
          const payment = plan.transactions[plan.transactions.length - 1];
          const paid = payment.transaction.outputs.filter(
            (o) => o.value === amountSompi,
          ).length;
          expect(paid, `${kas} KAS payment output`).toBeGreaterThan(0);
          // summary.fees already holds the priority fee, once.
          expect(String(plan.paymentFee - plan.paymentFeeBase)).toBe(
            String(priorityFee),
          );
        }
        expect(failed).toEqual([]);
      });
    }
  }
});

// Finding 1: DetailsStep's effect writes priorityFeeFromEstimate(paymentFeeBase)
// back into the form, and the form's priorityFee keys the next plan. Priced on
// paymentFee (priority fee included) it grew ×9 a cycle at feerate 1000.
test("priority fee converges across plan cycles at feerate 1000", async () => {
  const entries = syntheticEntries(
    3,
    10_000_000_000n,
  ) as unknown as IUtxoEntry[];
  const sender = senderAddress().toString();
  const estimate = {
    estimate: {
      priorityBucket: { feerate: 1000, estimatedSeconds: 1 },
      normalBuckets: [{ feerate: 1000, estimatedSeconds: 1 }],
      lowBuckets: [{ feerate: 1000, estimatedSeconds: 1 }],
    },
  } as unknown as IGetFeeEstimateResponse;

  let priorityFee = 0n;
  const history: bigint[] = [priorityFee];
  for (let cycle = 0; cycle < 3; cycle++) {
    const plan = await planTransfer({
      entries,
      amountSompi: 100_000_000n,
      outputAddress: destAddress().toString(),
      changeAddress: sender,
      priorityFee,
      networkId: "mainnet",
    });
    if (isShortfall(plan)) throw new Error("unexpected shortfall");
    priorityFee = priorityFeeFromEstimate(
      estimate,
      "high",
      Number(plan.paymentFeeBase),
    )!;
    history.push(priorityFee);
  }
  console.log(`priority fee per cycle: ${history.join(" → ")}`);
  expect(String(history[1])).not.toBe("0");
  expect(String(history[2])).toBe(String(history[1]));
  expect(String(history[3])).toBe(String(history[1]));
});
