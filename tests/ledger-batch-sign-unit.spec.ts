import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  IUtxoEntry,
  PrivateKey,
  Transaction,
  createTransactions,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { signAndSubmitBatch } from "@/lib/wallet/transaction-batch";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

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

// A real batch from a fragmented wallet: 300 × 1 KAS, sending 290 KAS.
// signAndSubmitBatch is driven over its first three transactions.
const threeTransactionBatch = async () => {
  const sender = new PrivateKey(KEY_A).toPublicKey().toAddress("mainnet");
  const entries = Array.from({ length: 300 }, (_unused, i) => ({
    address: sender,
    outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
    amount: 100_000_000n,
    scriptPublicKey: payToAddressScript(sender),
    blockDaaScore: 1_000n,
    isCoinbase: false,
  })) as unknown as IUtxoEntry[];
  const { transactions } = await createTransactions({
    entries,
    outputs: [
      {
        address: new PrivateKey(KEY_B)
          .toPublicKey()
          .toAddress("mainnet")
          .toString(),
        amount: 29_000_000_000n,
      },
    ],
    priorityFee: 0n,
    changeAddress: sender.toString(),
    networkId: "mainnet",
  });
  expect(transactions.length).toBeGreaterThanOrEqual(3);
  return transactions.slice(0, 3);
};

// Ledger signs from each input's UTXO entry (amount + script); an input
// without one cannot be signed on the device.
const stubLedger = (rejectOnCall?: number) => {
  const signed: string[] = [];
  return {
    signed,
    signTx: async (transaction: Transaction) => {
      if (signed.length + 1 === rejectOnCall) {
        throw new Error(
          "Ledger device: Condition of use not satisfied (0x6985)",
        );
      }
      for (const input of transaction.inputs) {
        if (!input.utxo) throw new Error("input has no UTXO entry");
      }
      signed.push(transaction.id);
      return transaction;
    },
  };
};

const stubRpc = () => {
  const submitted: string[] = [];
  return {
    submitted,
    submitTransaction: async ({
      transaction,
    }: {
      transaction: Transaction;
    }) => {
      submitted.push(transaction.id);
      return { transactionId: transaction.id };
    },
  } as unknown as {
    submitted: string[];
    submitTransaction: (args: {
      transaction: Transaction;
    }) => Promise<{ transactionId: string }>;
  };
};

test.describe("signAndSubmitBatch on Ledger", () => {
  test("signs and submits every transaction in order, each input with its entry", async () => {
    const batch = await threeTransactionBatch();
    const ledger = stubLedger();
    const rpc = stubRpc();
    const ids = await signAndSubmitBatch(batch, ledger, rpc as never);
    const expected = batch.map((pending) => pending.transaction.id);
    expect(ledger.signed).toEqual(expected);
    expect(rpc.submitted).toEqual(expected);
    expect(ids).toEqual(expected);
  });

  test("a reject on transaction 2 stops the batch and reports what went out", async () => {
    const batch = await threeTransactionBatch();
    const ledger = stubLedger(2);
    const rpc = stubRpc();
    let reported: string[] | undefined;
    const error = await signAndSubmitBatch(batch, ledger, rpc as never, {
      onSubmitted: (ids) => (reported = ids),
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(String(error)).toContain("0x6985");
    expect(rpc.submitted).toEqual([batch[0].transaction.id]);
    expect(reported).toEqual([batch[0].transaction.id]);
  });
});
