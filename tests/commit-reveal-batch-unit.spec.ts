import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  Address,
  IUtxoEntry,
  Opcodes,
  PrivateKey,
  RpcClient,
  ScriptBuilder,
  Transaction,
  addressFromScriptPublicKey,
  kaspaToSompi,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { HotWalletPrivateKey } from "@/lib/wallet/account/hot-wallet-private-key";
import { buildCommitRevealScript } from "@/lib/krc20";
import {
  CommitRevealHelper,
  RevealBroadcastError,
  SCRIPT_UTXO_AMOUNT,
  broadcastBeforeFailure,
} from "@/lib/commit-reveal";
import { PaymentOutput } from "@/lib/wallet/wallet-interface";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

// B3 reveal leg: on a fragmented wallet the Generator splits the reveal into a
// daisy-chained batch (compactions first, the payment LAST). The old code
// signed and broadcast transactions[0] only — a compaction paying the user's
// own change — and the confirmation watcher, which looked for any transaction
// paying the user, reported it as success. The operation never happened.
test.describe("commit-reveal over a fragmented UTXO set (B3 reveal)", () => {
  const NETWORK = "mainnet";
  const KEY_A =
    "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
  const KEY_B =
    "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";
  const PLAIN_SIGNATURE_HEX_LENGTH = 132; // 0x41 push + 64-byte Schnorr + sighash

  const outpointKey = (o: { transactionId: string; index: number }) =>
    `${o.transactionId}:${o.index}`;

  // A UTXO set that behaves like a node: submit spends inputs, creates outputs
  // and publishes one `utxos-changed` event per transaction.
  class FakeNode {
    utxos = new Map<string, IUtxoEntry>();
    submitted: Transaction[] = [];
    listeners = new Set<(event: unknown) => void>();
    silence: (tx: Transaction) => boolean = () => false;
    rejectOnce: (tx: Transaction) => Error | undefined = () => undefined;
    private rejected = new Set<string>();

    fund(address: Address, count: number, total: bigint) {
      const each = total / BigInt(count);
      for (let i = 0; i < count; i++) {
        const entry: IUtxoEntry = {
          address,
          outpoint: {
            transactionId: i.toString(16).padStart(64, "0"),
            index: 0,
          },
          amount: each,
          scriptPublicKey: payToAddressScript(address),
          blockDaaScore: 1_000n,
          isCoinbase: false,
        };
        this.utxos.set(outpointKey(entry.outpoint), entry);
      }
    }

    reads: string[][] = [];

    async getUtxosByAddresses(arg: string[] | { addresses: string[] }) {
      const addresses = Array.isArray(arg) ? arg : arg.addresses;
      this.reads.push(addresses);
      return {
        entries: [...this.utxos.values()].filter((entry) =>
          addresses.includes(entry.address!.toString()),
        ),
      };
    }

    async submitTransaction({ transaction }: { transaction: Transaction }) {
      const tx = transaction;
      if (!this.rejected.has(tx.id)) {
        const error = this.rejectOnce(tx);
        if (error) {
          this.rejected.add(tx.id);
          throw error;
        }
      }
      const removed: IUtxoEntry[] = [];
      for (const input of tx.inputs) {
        const key = outpointKey(input.previousOutpoint);
        const entry = this.utxos.get(key);
        if (!entry) throw new Error(`transaction is an orphan: ${key}`);
        this.utxos.delete(key);
        removed.push(entry);
      }
      const added: IUtxoEntry[] = tx.outputs.map((output, index) => {
        const entry: IUtxoEntry = {
          address: addressFromScriptPublicKey(output.scriptPublicKey, NETWORK)!,
          outpoint: { transactionId: tx.id, index },
          amount: output.value,
          scriptPublicKey: output.scriptPublicKey,
          blockDaaScore: 1_000n,
          isCoinbase: false,
        };
        this.utxos.set(outpointKey(entry.outpoint), entry);
        return entry;
      });
      this.submitted.push(tx);
      if (!this.silence(tx)) {
        setTimeout(() => {
          for (const listener of this.listeners) {
            listener({ type: "utxos-changed", data: { added, removed } });
          }
        }, 0);
      }
      return { transactionId: tx.id };
    }

    async subscribeUtxosChanged() {}
    async unsubscribeUtxosChanged() {}
    addEventListener(_: string, listener: (event: unknown) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_: string, listener: (event: unknown) => void) {
      this.listeners.delete(listener);
    }

    asRpcClient() {
      return this as unknown as RpcClient;
    }
  }

  const DEPLOY = {
    p: "krc-20",
    op: "deploy",
    tick: "KASTL",
    max: "2100000000000000",
    lim: "100000000000",
    dec: "8",
    pre: "0",
  };

  const setup = (
    utxoCount: number,
    total: bigint,
    data: unknown = DEPLOY,
    confirmationTimeoutMs?: number,
    buildScript: (signer: HotWalletPrivateKey) => ScriptBuilder = (signer) =>
      buildCommitRevealScript(signer.getPublicKey(), "kasplex", data),
  ) => {
    const signer = new HotWalletPrivateKey(new PrivateKey(KEY_A));
    const user = signer.getPublicKey().toAddress(NETWORK);
    const payee = new PrivateKey(KEY_B).toPublicKey().toAddress(NETWORK);
    const script = buildScript(signer);
    const node = new FakeNode();
    node.fund(user, utxoCount, total);
    const helper = new CommitRevealHelper(
      signer,
      node.asRpcClient(),
      NETWORK,
      script,
      { confirmationTimeoutMs },
    );
    return {
      node,
      helper,
      user,
      payee,
      scriptHex: script.toString(),
      p2sh: addressFromScriptPublicKey(
        script.createPayToScriptHashScript(),
        NETWORK,
      )!.toString(),
    };
  };

  const run = async (
    helper: CommitRevealHelper,
    fee: string,
    outputs: PaymentOutput[] = [],
  ) => {
    const yielded: Yielded[] = [];
    for await (const result of helper.perform(fee, outputs)) {
      yielded.push(result);
    }
    return yielded;
  };

  type Yielded = Exclude<
    Awaited<ReturnType<ReturnType<CommitRevealHelper["perform"]>["next"]>>,
    IteratorReturnResult<unknown>
  >["value"];

  const completedOf = (yielded: Yielded[]) => {
    const completed = yielded.find((r) => r.status === "completed");
    if (completed?.status !== "completed") {
      throw new Error("perform never reported completion");
    }
    return completed;
  };

  const paidTo = (txs: Transaction[], address: Address) => {
    const script = payToAddressScript(address).toString();
    return txs
      .flatMap((tx) => tx.outputs)
      .filter((o) => o.scriptPublicKey.toString() === script)
      .reduce((sum, o) => sum + o.value, 0n);
  };

  // 300 UTXOs of ~10 KAS, 3005 KAS total, a 1000 KAS deploy: measured to batch.
  const BATCHING_COUNT = 300;
  const BATCHING_TOTAL = 300_500_000_000n; // 3005 KAS

  test("the whole reveal batch is broadcast and the payment lands", async () => {
    const { node, helper, payee } = setup(BATCHING_COUNT, BATCHING_TOTAL);

    const yielded = await run(helper, "1000", [
      { address: payee.toString(), amount: "20" },
    ]);
    const completed = completedOf(yielded);

    expect(completed).toBeDefined();
    const [commit, ...reveals] = node.submitted;
    // If this ever drops to 1 the scenario stops testing anything.
    expect(reveals.length).toBeGreaterThan(1);
    // The old code stopped after the first reveal transaction and never paid.
    expect(node.submitted.length).toBe(1 + completed.revealTxIds!.length);
    expect(paidTo(node.submitted, payee)).toBe(kaspaToSompi("20")!);
    expect(completed.commitTxId).toBe(commit.id);
    expect(completed.revealTxIds).toEqual(reveals.map((tx) => tx.id));
    // The reported reveal id is the payment, not the compaction.
    expect(completed.revealTxId).toBe(reveals[reveals.length - 1].id);
  });

  test("only input 0 of the first reveal carries the redeem script", async () => {
    const { node, helper, payee, scriptHex, p2sh } = setup(
      BATCHING_COUNT,
      BATCHING_TOTAL,
    );

    const yielded = await run(helper, "1000", [
      { address: payee.toString(), amount: "20" },
    ]);
    const completed = completedOf(yielded);
    const [, ...reveals] = node.submitted;

    const scriptInput = reveals[0].inputs[0];
    expect(scriptInput.previousOutpoint.transactionId).toBe(
      completed.commitTxId,
    );
    expect(scriptInput.signatureScript).toContain(scriptHex);
    const otherInputs = [
      ...reveals[0].inputs.slice(1),
      ...reveals.slice(1).flatMap((tx) => tx.inputs),
    ];
    expect(otherInputs.length).toBeGreaterThan(0);
    for (const input of otherInputs) {
      expect(input.signatureScript?.length).toBe(PLAIN_SIGNATURE_HEX_LENGTH);
    }
    // the script UTXO was actually spent
    const { entries } = await node.getUtxosByAddresses([p2sh]);
    expect(entries).toEqual([]);
  });

  test("every compaction is consumed by a later reveal transaction", async () => {
    const { node, helper, payee } = setup(BATCHING_COUNT, BATCHING_TOTAL);

    await run(helper, "1000", [{ address: payee.toString(), amount: "20" }]);
    const [, ...reveals] = node.submitted;
    expect(reveals.length).toBeGreaterThan(1);

    // Compactions fan in to the final payment, so array order is broadcast
    // order and nothing can be resubmitted out of sequence.
    for (let j = 0; j < reveals.length - 1; j++) {
      expect(
        reveals
          .slice(j + 1)
          .flatMap((tx) => tx.inputs)
          .some(
            (input) => input.previousOutpoint.transactionId === reveals[j].id,
          ),
      ).toBe(true);
    }
  });

  test("the commit that is broadcast is the one pre-flight modeled", async () => {
    const { node, helper, payee, user } = setup(BATCHING_COUNT, BATCHING_TOTAL);

    const yielded = await run(helper, "1000", [
      { address: payee.toString(), amount: "20" },
    ]);
    const completed = completedOf(yielded);

    // The wallet is read once before the commit (pre-flight) and once for
    // the reveal; the commit leg no longer re-fetches, so it cannot build
    // from a snapshot other than the one the reveal was pre-flighted on.
    const userReads = node.reads.filter((a) => a.includes(user.toString()));
    expect(userReads.length).toBe(2);
    expect(node.submitted[0].id).toBe(completed.commitTxId);
    expect(paidTo(node.submitted, payee)).toBe(kaspaToSompi("20")!);
  });

  test("a mid-batch broadcast failure reports what landed", async () => {
    const { node, helper, payee } = setup(BATCHING_COUNT, BATCHING_TOTAL);
    node.rejectOnce = () =>
      node.submitted.length === 2
        ? new Error("Rejected transaction: bad-txns-inputs-missingorspent")
        : undefined;

    let commitTxId: string | undefined;
    const error = await (async () => {
      for await (const result of helper.perform("1000", [
        { address: payee.toString(), amount: "20" },
      ])) {
        commitTxId = result.commitTxId ?? commitTxId;
      }
    })().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(RevealBroadcastError);
    const broadcastError = error as RevealBroadcastError;
    const [commit, firstReveal] = node.submitted;
    expect(node.submitted.length).toBe(2);
    expect(broadcastError.transactionIds).toEqual([firstReveal.id]);
    expect(broadcastError.total).toBeGreaterThan(1);
    // What the fail screens and the dApp error name: commit first, then the
    // reveals that landed.
    expect(broadcastBeforeFailure(commitTxId, error)).toEqual([
      commit.id,
      firstReveal.id,
    ]);
    expect(broadcastBeforeFailure(undefined, new Error("x"))).toEqual([]);
  });

  test("an orphan reject resumes at the same transaction, never rebuilds", async () => {
    const { node, helper, payee } = setup(BATCHING_COUNT, BATCHING_TOTAL);
    let orphaned: string | undefined;
    node.rejectOnce = (tx) => {
      // second reveal transaction, first attempt only
      if (node.submitted.length === 2) {
        orphaned = tx.id;
        return new Error("Rejected transaction: transaction is an orphan");
      }
      return undefined;
    };

    const yielded = await run(helper, "1000", [
      { address: payee.toString(), amount: "20" },
    ]);
    const completed = completedOf(yielded);

    expect(orphaned).toBeDefined();
    expect(node.submitted[2].id).toBe(orphaned);
    expect(completed.revealTxIds).toContain(orphaned);
    expect(paidTo(node.submitted, payee)).toBe(kaspaToSompi("20")!);
  });

  test("completion is not reported when only the compaction is confirmed", async () => {
    const { node, helper, payee } = setup(
      BATCHING_COUNT,
      BATCHING_TOTAL,
      DEPLOY,
      300,
    );
    // The node accepts everything but never reports the final transaction.
    const payeeScript = payToAddressScript(payee).toString();
    node.silence = (tx) =>
      tx.outputs.some((o) => o.scriptPublicKey.toString() === payeeScript);

    const yielded: { status: string }[] = [];
    const error = await (async () => {
      for await (const result of helper.perform("1000", [
        { address: payee.toString(), amount: "20" },
      ])) {
        yielded.push(result);
      }
    })().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(String(error)).toContain("Timeout");
    expect(yielded.map((r) => r.status)).not.toContain("completed");
  });

  test("a wallet that cannot fund the reveal is refused before the commit", async () => {
    const { node, helper, payee } = setup(BATCHING_COUNT, kaspaToSompi("500")!);

    await expect(
      run(helper, "1000", [{ address: payee.toString(), amount: "20" }]),
    ).rejects.toThrow(/Insufficient funds/);
    expect(node.submitted).toEqual([]);
  });

  test("a script too large for the batched reveal is refused before the commit", async () => {
    // ScriptBuilder caps one data push at 520 bytes, so a script this large
    // needs several pushes; the Generator only sees the P2SH hash anyway.
    const { node, helper, payee } = setup(
      BATCHING_COUNT,
      BATCHING_TOTAL,
      DEPLOY,
      undefined,
      (signer) => {
        const script = new ScriptBuilder()
          .addData(signer.getPublicKey().toXOnlyPublicKey().toString())
          .addOp(Opcodes.OpCheckSig)
          .addOp(Opcodes.OpFalse)
          .addOp(Opcodes.OpIf);
        for (let i = 0; i < 4; i++) script.addData(Buffer.alloc(500, "x"));
        return script.addOp(Opcodes.OpEndIf);
      },
    );

    await expect(
      run(helper, "1000", [{ address: payee.toString(), amount: "20" }]),
    ).rejects.toThrow(/standard limit/);
    expect(node.submitted).toEqual([]);
  });

  test("a transfer still reveals with the script UTXO alone", async () => {
    const { node, helper } = setup(800, BATCHING_TOTAL, {
      p: "krc-20",
      op: "transfer",
      tick: "KASTL",
      amt: "100000000000",
      to: new PrivateKey(KEY_B).toPublicKey().toAddress(NETWORK).toString(),
    });

    const yielded = await run(helper, "0");
    const completed = completedOf(yielded);

    expect(node.submitted.length).toBe(2);
    expect(node.submitted[1].inputs.length).toBe(1);
    expect(completed.revealTxIds).toEqual([node.submitted[1].id]);
    expect(completed.revealTxId).toBe(node.submitted[1].id);
    expect(SCRIPT_UTXO_AMOUNT).toBe("0.3");
  });
});
