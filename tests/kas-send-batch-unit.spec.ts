import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  PrivateKey,
  RpcClient,
  Transaction,
  createTransactions,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { IWalletWithGetAddress } from "@/lib/wallet/wallet-interface";
import { signAndSubmitBatch } from "@/lib/wallet/transaction-batch";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

// B2: sending an amount close to the whole balance from a fragmented wallet
// broadcast a *compound* transaction to the sender's own change address instead
// of the payment, because ConfirmStep signed transactions[0] and stopped. The
// Generator returns a daisy-chained batch here — the payment is the LAST entry.
test.describe("KAS send over a fragmented UTXO set (B2)", () => {
  const KEY_A =
    "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
  const KEY_B =
    "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";
  const TOTAL = 300_500_000_000n; // 3005 KAS, Leo's reported balance
  const REQUEST = 300_000_000_000n; // 3000 KAS, the reported send

  const buildBatch = async (utxoCount: number, request: bigint = REQUEST) => {
    const senderKey = new PrivateKey(KEY_A);
    const sender = senderKey.toPublicKey().toAddress("mainnet");
    const dest = new PrivateKey(KEY_B).toPublicKey().toAddress("mainnet");
    const each = TOTAL / BigInt(utxoCount);

    const { transactions } = await createTransactions({
      entries: Array.from({ length: utxoCount }, (_unused, i) => ({
        address: sender,
        outpoint: { transactionId: i.toString(16).padStart(64, "0"), index: 0 },
        amount: each,
        scriptPublicKey: payToAddressScript(sender),
        blockDaaScore: 1_000n,
        isCoinbase: false,
      })),
      outputs: [{ address: dest.toString(), amount: request }],
      priorityFee: 0n,
      changeAddress: sender.toString(),
      networkId: "mainnet",
    });

    return {
      transactions,
      destScript: payToAddressScript(dest).toString(),
      changeScript: payToAddressScript(sender).toString(),
    };
  };

  // Signing is not what this test is about: hand the transaction back unchanged
  // and record every transaction that actually reached submitTransaction.
  const mkBroadcaster = () => {
    const broadcast: Transaction[] = [];
    const signer: Pick<IWalletWithGetAddress, "signTx"> = {
      signTx: async (tx) => tx,
    };
    const rpcClient: Pick<RpcClient, "submitTransaction"> = {
      submitTransaction: async (request) => {
        const transaction = request.transaction as Transaction;
        broadcast.push(transaction);
        return { transactionId: transaction.id };
      },
    };
    return { broadcast, signer, rpcClient };
  };

  const paidTo = (broadcast: Transaction[], script: string) =>
    broadcast
      .flatMap((tx) => tx.outputs)
      .filter((o) => o.scriptPublicKey.toString() === script)
      .reduce((sum, o) => sum + o.value, 0n);

  test("a fragmented UTXO set really does produce a multi-transaction batch", async () => {
    const { transactions, destScript } = await buildBatch(100);

    // If this ever drops to 1 the scenario below stops testing anything.
    expect(transactions.length).toBeGreaterThan(1);

    // The old code signed this one, and it pays the recipient nothing.
    expect(
      transactions[0].transaction.outputs.some(
        (o) => o.scriptPublicKey.toString() === destScript,
      ),
    ).toBe(false);
  });

  test("the FULL requested amount reaches the destination", async () => {
    const { transactions, destScript } = await buildBatch(100);
    const { broadcast, signer, rpcClient } = mkBroadcaster();

    const ids = await signAndSubmitBatch(transactions, signer, rpcClient);

    expect(broadcast.length).toBe(transactions.length);
    expect(ids.length).toBe(transactions.length);
    // The point of the fix: the recipient is paid the whole 3000 KAS.
    expect(paidTo(broadcast, destScript)).toBe(REQUEST);
  });

  test("the batch is broadcast in generator order, payment last", async () => {
    const { transactions, destScript } = await buildBatch(100);
    const { broadcast, signer, rpcClient } = mkBroadcaster();

    const ids = await signAndSubmitBatch(transactions, signer, rpcClient);

    expect(broadcast.map((tx) => tx.id)).toEqual(
      transactions.map((pending) => pending.transaction.id),
    );
    // Each transaction spends the previous one's output, so order is not optional.
    expect(ids[ids.length - 1]).toBe(
      transactions[transactions.length - 1].transaction.id,
    );
    expect(
      broadcast[broadcast.length - 1].outputs.some(
        (o) => o.scriptPublicKey.toString() === destScript,
      ),
    ).toBe(true);
  });

  // The Max button offers `balance - max(feeEstimate, 0.3 KAS)`
  // (hooks/useFindMax.ts:20-22, DetailsStep.tsx:67-72) — the largest amount the
  // UI will ever submit, and the case closest to leaving no change output.
  test("a near-max amount still delivers in full from a fragmented wallet", async () => {
    const MIN_SUBTRAHEND = 30_000_000n; // 0.3 KAS, useFindMax's floor
    const { transactions, destScript } = await buildBatch(
      100,
      TOTAL - MIN_SUBTRAHEND,
    );
    const { broadcast, signer, rpcClient } = mkBroadcaster();

    await signAndSubmitBatch(transactions, signer, rpcClient);

    expect(transactions.length).toBeGreaterThan(1);
    expect(paidTo(broadcast, destScript)).toBe(TOTAL - MIN_SUBTRAHEND);
  });

  test("an unfragmented wallet still sends exactly one transaction", async () => {
    const { transactions, destScript } = await buildBatch(1);
    const { broadcast, signer, rpcClient } = mkBroadcaster();

    const ids = await signAndSubmitBatch(transactions, signer, rpcClient);

    expect(transactions.length).toBe(1);
    expect(ids.length).toBe(1);
    expect(paidTo(broadcast, destScript)).toBe(REQUEST);
  });

  test("progress and incremental ids are reported for every transaction", async () => {
    const { transactions } = await buildBatch(100);
    const { signer, rpcClient } = mkBroadcaster();
    const signing: string[] = [];
    const published: string[][] = [];

    await signAndSubmitBatch(transactions, signer, rpcClient, {
      onSigning: (current, total) => signing.push(`${current}/${total}`),
      onSubmitted: (transactionIds) => published.push(transactionIds),
    });

    const total = transactions.length;
    expect(signing).toEqual(
      Array.from({ length: total }, (_unused, i) => `${i + 1}/${total}`),
    );
    // ids accumulate, so a mid-batch failure leaves the user the broadcast ones
    expect(published.map((ids) => ids.length)).toEqual(
      Array.from({ length: total }, (_unused, i) => i + 1),
    );
  });

  test("an empty batch is refused rather than reported as sent", async () => {
    const { signer, rpcClient } = mkBroadcaster();
    await expect(signAndSubmitBatch([], signer, rpcClient)).rejects.toThrow(
      /No transaction was generated/,
    );
  });
});
