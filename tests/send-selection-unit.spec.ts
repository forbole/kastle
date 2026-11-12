import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  IUtxoEntry,
  PrivateKey,
  Transaction,
  createTransactions,
  kaspaToSompi,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import {
  FRAGMENTATION_FAIL_REASON,
  isFragmentationError,
  sendFailReason,
} from "@/lib/kaspa";
import { isShortfall, orderEntries, planTransfer } from "@/lib/sendFee";
import { signAndSubmitBatch } from "@/lib/wallet/transaction-batch";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

// signAndSubmitBatch refuses inputs with an empty signature script: stub
// signers stand in a placeholder for the signature they would produce.
const withPlaceholderSignatures = (transaction: Transaction) => {
  transaction.inputs = transaction.inputs.map((input) => {
    input.signatureScript = "00";
    return input;
  });
  return transaction;
};

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

const KEY_A =
  "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
const KEY_B =
  "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";

// The measured mainnet wallet: 11,446 × 2.06 KAS, 2 × 4.12, 1 × 3.00, in the
// order the node returned them (small ones first).
const buildWallet = () => {
  const sender = new PrivateKey(KEY_A).toPublicKey().toAddress("mainnet");
  const amounts = [
    ...Array.from({ length: 11_446 }, () => 206_000_000n),
    412_000_000n,
    412_000_000n,
    300_000_000n,
  ];
  const entries = amounts.map((amount, i) => ({
    address: sender,
    outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
    amount,
    scriptPublicKey: payToAddressScript(sender),
    blockDaaScore: 1_000n,
    isCoinbase: false,
  })) as unknown as IUtxoEntry[];
  return { sender: sender.toString(), entries };
};

const DEST = () =>
  new PrivateKey(KEY_B).toPublicKey().toAddress("mainnet").toString();

const AMOUNTS = [
  "0.5",
  "1",
  "2",
  "2.5",
  "3",
  "4",
  "4.2",
  "5",
  "10",
  "20",
  "50",
  "100",
  // zero-change amounts: the whole-UTXO multiples the Generator left no change on
  "4.119",
  "6.179",
  "10.299",
];

test.describe("planTransfer at the 11,449-UTXO shape", () => {
  test.setTimeout(120_000);

  for (const priorityFee of [0n, 2_838_600n]) {
    test(`builds every listed amount at priorityFee ${priorityFee}`, async () => {
      const { sender, entries } = buildWallet();
      const failed: string[] = [];
      for (const kas of AMOUNTS) {
        const amountSompi = kaspaToSompi(kas)!;
        const plan = await planTransfer({
          entries,
          amountSompi,
          outputAddress: DEST(),
          changeAddress: sender,
          priorityFee,
          networkId: "mainnet",
        }).catch((e: unknown) => {
          failed.push(`${kas}: ${String(e)}`);
          return undefined;
        });
        if (!plan) continue;
        expect(isShortfall(plan), `${kas} KAS`).toBe(false);
        if (isShortfall(plan)) continue;
        expect(plan.transactionCount, `${kas} KAS`).toBe(1);
        expect(plan.transactions.length).toBe(plan.transactionCount);
        const change =
          plan.selected.reduce((s, e) => s + e.amount, 0n) -
          amountSompi -
          plan.fee;
        expect(String(change >= 11_000_000n), `${kas} KAS change`).toBe("true");
      }
      expect(failed).toEqual([]);
    });
  }

  // Pins the defect the sort fixes: handed the raw node order, the Generator
  // spends one 2.06 KAS UTXO for 2 KAS and the dust change breaks the mass limit.
  test("unsorted raw entries still throw for 2 KAS", async () => {
    const { sender, entries } = buildWallet();
    const error = await createTransactions({
      entries,
      outputs: [{ address: DEST(), amount: kaspaToSompi("2")! }],
      priorityFee: 0n,
      changeAddress: sender,
      networkId: "mainnet",
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(String(error)).toContain("Storage mass exceeds maximum");
  });

  test("orderEntries sorts largest first with a stable tie-break", () => {
    const { entries } = buildWallet();
    const ordered = orderEntries(entries);
    expect(String(ordered[0].amount)).toBe("412000000");
    expect(String(ordered[2].amount)).toBe("300000000");
    expect(
      ordered[3].outpoint.transactionId < ordered[4].outpoint.transactionId,
    ).toBe(true);
    expect(entries[0].amount).toBe(206_000_000n);
  });

  test("an amount beyond the balance is a typed shortfall", async () => {
    const { sender, entries } = buildWallet();
    const plan = await planTransfer({
      entries,
      amountSompi: kaspaToSompi("23590")!,
      outputAddress: DEST(),
      changeAddress: sender,
      priorityFee: 0n,
      networkId: "mainnet",
    });
    expect(isShortfall(plan) && plan.reason).toBe("amount");
  });
});

test.describe("sendFailReason", () => {
  const insufficient = new Error("Insufficient funds");

  test("legacy wallet with more displayed than spendable gets the legacy copy", () => {
    const reason = sendFailReason(insufficient, {
      isLegacyWallet: true,
      displayedBalanceSompi: 1_000_000_000n,
      spendableSompi: 250_000_000n,
    });
    expect(reason).toContain("2.5 KAS");
    expect(reason).not.toContain("smaller amount");
  });

  test("non-legacy insufficient funds gets the fragmentation copy", () => {
    expect(isFragmentationError(insufficient)).toBe(true);
    expect(
      sendFailReason(insufficient, {
        isLegacyWallet: false,
        displayedBalanceSompi: 1_000_000_000n,
        spendableSompi: 250_000_000n,
      }),
    ).toBe(FRAGMENTATION_FAIL_REASON);
  });

  test("legacy wallet whose balance is all spendable gets the fragmentation copy", () => {
    expect(
      sendFailReason(insufficient, {
        isLegacyWallet: true,
        displayedBalanceSompi: 250_000_000n,
        spendableSompi: 250_000_000n,
      }),
    ).toBe(FRAGMENTATION_FAIL_REASON);
  });

  test("a mass error gets the fragmentation copy, anything else undefined", () => {
    const opts = {
      isLegacyWallet: true,
      displayedBalanceSompi: 2n,
      spendableSompi: 1n,
    };
    expect(
      sendFailReason(new Error("Storage mass exceeds maximum"), opts),
    ).toBe(FRAGMENTATION_FAIL_REASON);
    expect(sendFailReason(new Error("RPC timeout"), opts)).toBeUndefined();
  });
});

// 300 × 2.0604 KAS sending 197.6 KAS: a three-transaction batch whose payment
// leg leaves dust change unless the surplus is split into a third output.
test.describe("planTransfer with allowSplit: false (Ledger)", () => {
  const buildEqualWallet = () => {
    const sender = new PrivateKey(KEY_A).toPublicKey().toAddress("mainnet");
    const entries = Array.from({ length: 300 }, (_unused, i) => ({
      address: sender,
      outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
      amount: 206_040_000n,
      scriptPublicKey: payToAddressScript(sender),
      blockDaaScore: 1_000n,
      isCoinbase: false,
    })) as unknown as IUtxoEntry[];
    return { sender: sender.toString(), entries };
  };
  const amountSompi = 19_760_000_000n;

  // ConfirmStep's sequence: plan, then sign and submit each leg in order. The
  // signer refuses what the device refuses: more than payment + change.
  const confirm = async (allowSplit: boolean) => {
    const { sender, entries } = buildEqualWallet();
    const signed: number[] = [];
    const submitted: string[] = [];
    const signer = {
      signTx: async (transaction: Transaction) => {
        signed.push(transaction.outputs.length);
        if (transaction.outputs.length > 2)
          throw new Error("device: 2 outputs");
        return withPlaceholderSignatures(transaction);
      },
    };
    const rpc = {
      submitTransaction: async ({
        transaction,
      }: {
        transaction: Transaction;
      }) => {
        submitted.push(transaction.id);
        return { transactionId: transaction.id };
      },
    };
    const error = await planTransfer({
      entries,
      amountSompi,
      outputAddress: DEST(),
      changeAddress: sender,
      priorityFee: 0n,
      networkId: "mainnet",
      allowSplit,
    })
      .then(async (plan) => {
        if (isShortfall(plan)) throw new Error("Insufficient funds");
        await signAndSubmitBatch(
          plan.transactions,
          signer as never,
          rpc as never,
        );
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    return { error, signed, submitted };
  };

  test("the shape needs the split: allowed, the payment leg has three outputs", async () => {
    const { sender, entries } = buildEqualWallet();
    const plan = await planTransfer({
      entries,
      amountSompi,
      outputAddress: DEST(),
      changeAddress: sender,
      priorityFee: 0n,
      networkId: "mainnet",
    });
    expect(isShortfall(plan)).toBe(false);
    if (isShortfall(plan)) return;
    expect(plan.transactionCount).toBe(3);
    expect(plan.transactions[2].transaction.outputs.length).toBe(3);
  });

  test("throws the mass error before anything is signed or submitted", async () => {
    const { error, signed, submitted } = await confirm(false);
    expect(String(error)).toContain("Storage mass exceeds maximum");
    expect(
      sendFailReason(error, {
        isLegacyWallet: false,
        displayedBalanceSompi: 0n,
        spendableSompi: 0n,
      }),
    ).toBe(FRAGMENTATION_FAIL_REASON);
    expect(signed).toEqual([]);
    expect(submitted).toEqual([]);
  });

  // The regression the option closes: the consolidations go out, then the
  // device rejects the three-output payment.
  test("with the split allowed the same send broadcasts before failing", async () => {
    const { error, signed, submitted } = await confirm(true);
    expect(String(error)).toContain("device: 2 outputs");
    expect(signed).toEqual([1, 1, 3]);
    expect(submitted.length).toBe(2);
  });
});
