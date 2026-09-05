import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  PrivateKey,
  createTransactions,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { isFragmentationError, MAX_SEND_RESERVE_KAS } from "@/lib/kaspa";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

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
  const KEY_A =
    "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
  const KEY_B =
    "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";
  const TOTAL = 300_500_000_000n; // 3005 KAS
  const RESERVE = BigInt(Math.round(MAX_SEND_RESERVE_KAS * 1e8));
  // DetailsStep: priorityFee = feerate × baseFee / 100, baseFee measured at
  // 315,400 sompi for the estimate's one-input shape; feerate 1 … 1000.
  const LOW_PRIORITY_FEE = 3_154n;
  const HIGH_PRIORITY_FEE = 3_154_000n;

  // What DetailsStep's Max produces: amount = balance − (reserve + priorityFee).
  const sendMax = async (
    utxoCount: number,
    priorityFee = 0n,
    subtrahend = RESERVE + priorityFee,
  ) => {
    const sender = new PrivateKey(KEY_A).toPublicKey().toAddress("mainnet");
    const dest = new PrivateKey(KEY_B).toPublicKey().toAddress("mainnet");
    const each = TOTAL / BigInt(utxoCount);

    return createTransactions({
      entries: Array.from({ length: utxoCount }, (_unused, i) => ({
        address: sender,
        outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
        amount: each,
        scriptPublicKey: payToAddressScript(sender),
        blockDaaScore: 1_000n,
        isCoinbase: false,
      })),
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
  // sompi) plus the ≥0.1 KAS change the storage mass limit needs, with
  // ~70,000 sompi to spare. A priority fee inside the reserve eats that.
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
    // Measured: 69,955 sompi is the last priority fee that builds at 0.3 flat;
    // 69,956 throws "Mass calculation error", the high bucket this.
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
