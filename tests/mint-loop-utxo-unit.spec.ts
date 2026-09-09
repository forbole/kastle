import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  Address,
  IUtxoEntry,
  PrivateKey,
  RpcClient,
  Transaction,
  addressFromScriptPublicKey,
  kaspaToSompi,
  payToAddressScript,
} from "@/wasm/core/kaspa";
import { HotWalletPrivateKey } from "@/lib/wallet/account/hot-wallet-private-key";
import { Krc20Fee, buildCommitRevealScript } from "@/lib/krc20";
import { CommitRevealHelper } from "@/lib/commit-reveal";
import { PaymentOutput } from "@/lib/wallet/wallet-interface";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

// The mint loop (MintingToken) runs commit+reveal thousands of times over one
// wallet. Reproduced on testnet-10 (2026-09-07, 11 of 20 MMMM mints): the
// commit of iteration N+1 spent the outpoint the reveal of iteration N had
// spent while that reveal was still in the mempool, and the node rejected it
// with "already spent by transaction … in the mempool". The wallet reads the
// node's UTXO index, which lags the mempool, so every iteration must start
// from a set that reflects what the wallet itself has already broadcast.
test.describe("mint loop UTXO bookkeeping across iterations", () => {
  const NETWORK = "testnet-10";
  const KEY_A =
    "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
  const KEY_B =
    "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";
  const MINT = { p: "krc-20", op: "mint", tick: "MMMM" };

  const outpointKey = (o: { transactionId: string; index: number }) =>
    `${o.transactionId}:${o.index}`;

  // A node with a mempool. submit checks inputs against the confirmed set and
  // against what the mempool already spends (rusty-kaspa's exact error);
  // mining applies a transaction to the confirmed set and publishes one
  // `utxos-changed` event. `revert`/`reapply` model a virtual reorg that
  // temporarily un-applies a confirmed transaction (measured on testnet-10:
  // 5,163 outpoints removed then re-added in 150 s).
  class MempoolNode {
    utxos = new Map<string, IUtxoEntry>();
    private spentEntries = new Map<string, IUtxoEntry>();
    private spentInMempool = new Map<string, string>();
    mempool = new Set<string>();
    submitted: Transaction[] = [];
    listeners = new Set<(event: unknown) => void>();
    reads = 0;
    mineDelayMs: (tx: Transaction) => number = () => 20;
    silence: (tx: Transaction) => boolean = () => false;
    onSubmit: (tx: Transaction) => void = () => undefined;

    fund(address: Address, amount: bigint) {
      const entry: IUtxoEntry = {
        address,
        outpoint: { transactionId: "f".repeat(64), index: 0 },
        amount,
        scriptPublicKey: payToAddressScript(address),
        blockDaaScore: 1_000n,
        isCoinbase: false,
      };
      this.utxos.set(outpointKey(entry.outpoint), entry);
    }

    async getUtxosByAddresses(arg: string[] | { addresses: string[] }) {
      const addresses = Array.isArray(arg) ? arg : arg.addresses;
      this.reads++;
      return {
        entries: [...this.utxos.values()].filter((entry) =>
          addresses.includes(entry.address!.toString()),
        ),
      };
    }

    async submitTransaction({ transaction: tx }: { transaction: Transaction }) {
      for (const input of tx.inputs) {
        const { transactionId, index } = input.previousOutpoint;
        const spender = this.spentInMempool.get(
          outpointKey({ transactionId, index }),
        );
        if (spender) {
          throw `RPC Server (remote error) -> Rejected transaction ${tx.id}: output (${transactionId}, ${index}) already spent by transaction ${spender} in the mempool`;
        }
      }
      for (const input of tx.inputs) {
        this.spentInMempool.set(outpointKey(input.previousOutpoint), tx.id);
      }
      this.mempool.add(tx.id);
      this.submitted.push(tx);
      this.onSubmit(tx);
      setTimeout(() => this.mine(tx), this.mineDelayMs(tx));
      return { transactionId: tx.id };
    }

    private outputsOf(tx: Transaction): IUtxoEntry[] {
      return tx.outputs.map((output, index) => ({
        address: addressFromScriptPublicKey(output.scriptPublicKey, NETWORK)!,
        outpoint: { transactionId: tx.id, index },
        amount: output.value,
        scriptPublicKey: output.scriptPublicKey,
        blockDaaScore: 1_000n,
        isCoinbase: false,
      }));
    }

    mine(tx: Transaction) {
      if (!this.mempool.has(tx.id)) return;
      const inputs = tx.inputs.map((i) => outpointKey(i.previousOutpoint));
      if (!inputs.every((key) => this.utxos.has(key))) {
        // parent not applied (reverted): try the next block
        setTimeout(() => this.mine(tx), 10);
        return;
      }
      this.mempool.delete(tx.id);
      for (const key of inputs) this.spentInMempool.delete(key);
      this.apply(tx);
      if (!this.silence(tx)) this.emitLast();
    }

    private last: { added: IUtxoEntry[]; removed: IUtxoEntry[] } = {
      added: [],
      removed: [],
    };

    private apply(tx: Transaction) {
      const removed: IUtxoEntry[] = [];
      for (const input of tx.inputs) {
        const key = outpointKey(input.previousOutpoint);
        const entry = this.utxos.get(key)!;
        this.utxos.delete(key);
        this.spentEntries.set(key, entry);
        removed.push(entry);
      }
      const added = this.outputsOf(tx);
      for (const entry of added)
        this.utxos.set(outpointKey(entry.outpoint), entry);
      this.last = { added, removed };
    }

    private emitLast() {
      const event = { type: "utxos-changed", data: this.last };
      for (const listener of this.listeners) listener(event);
    }

    // A virtual reorg un-applies `tx`: its outputs vanish, its inputs return.
    revert(tx: Transaction) {
      const removed = this.outputsOf(tx);
      for (const entry of removed)
        this.utxos.delete(outpointKey(entry.outpoint));
      const added = tx.inputs.map(
        (input) => this.spentEntries.get(outpointKey(input.previousOutpoint))!,
      );
      for (const entry of added)
        this.utxos.set(outpointKey(entry.outpoint), entry);
      this.last = { added, removed };
      this.emitLast();
    }

    reapply(tx: Transaction) {
      this.apply(tx);
      this.emitLast();
    }

    // The mempool dropped `tx` unmined (node restart, eviction, the 24 h
    // expiry): nothing spends its inputs any more and the UTXO index, which
    // never reflected the mempool, keeps listing them.
    evict(tx: Transaction) {
      this.mempool.delete(tx.id);
      for (const input of tx.inputs)
        this.spentInMempool.delete(outpointKey(input.previousOutpoint));
    }

    async getMempoolEntry({ transactionId }: { transactionId: string }) {
      if (!this.mempool.has(transactionId)) {
        throw `RPC Server (remote error) -> Transaction ${transactionId} not found in mempool`;
      }
      return { mempoolEntry: { transactionId } };
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

  const setup = (confirmationTimeoutMs = 200) => {
    const signer = new HotWalletPrivateKey(new PrivateKey(KEY_A));
    const user = signer.getPublicKey().toAddress(NETWORK);
    const payee = new PrivateKey(KEY_B).toPublicKey().toAddress(NETWORK);
    const node = new MempoolNode();
    // Leo's wallet: one UTXO of ~840 KAS, so consecutive transactions must
    // chain through each other's change.
    node.fund(user, kaspaToSompi("840")!);
    // MintingToken: a fresh helper (lib/krc20.ts mint()) per iteration, the
    // Forbole fee output every 10th iteration.
    const iterate = async (i: number) => {
      const helper = new CommitRevealHelper(
        signer,
        node.asRpcClient(),
        NETWORK,
        buildCommitRevealScript(signer.getPublicKey(), "kasplex", MINT),
        { confirmationTimeoutMs },
      );
      const outputs: PaymentOutput[] =
        i % 10 === 0 ? [{ address: payee.toString(), amount: "0.2" }] : [];
      for await (const result of helper.perform(
        Krc20Fee.Mint.toString(),
        outputs,
      )) {
        void result;
      }
    };
    const run = async (from: number, to: number) => {
      for (let i = from; i < to; i++) await iterate(i);
    };
    return { node, run, user };
  };

  const isReveal = (node: MempoolNode) => node.submitted.length % 2 === 0;

  const expectDisjointInputs = (node: MempoolNode, transactions: number) => {
    expect(node.submitted.length).toBe(transactions);
    const inputs = node.submitted.flatMap((tx) =>
      tx.inputs.map((i) => outpointKey(i.previousOutpoint)),
    );
    expect(new Set(inputs).size).toBe(inputs.length);
  };

  test("iterations chain cleanly when every confirmation is observed", async () => {
    const { node, run } = setup();
    await run(0, 3);
    expectDisjointInputs(node, 6);
  });

  test("a transient reorg of the commit does not make the next iteration double-spend", async () => {
    const { node, run } = setup();
    // Iteration 1: right after its reveal is broadcast the virtual un-applies
    // the commit and re-applies it (one flip, as measured on testnet-10). The
    // flip reports the commit's outputs — the reveal's inputs — as removed
    // while the reveal is still in the mempool.
    node.mineDelayMs = () =>
      isReveal(node) && node.submitted.length === 4 ? 80 : 20;
    node.onSubmit = () => {
      if (isReveal(node) && node.submitted.length === 4) {
        const commit = node.submitted[2];
        setTimeout(() => {
          node.revert(commit);
          node.reapply(commit);
        }, 5);
      }
    };

    await run(0, 3);
    expectDisjointInputs(node, 6);
  });

  test("a reveal whose confirmation is missed is still accounted for by the next iteration", async () => {
    const { node, run } = setup(200);
    // Iteration 1's reveal is accepted but its event never arrives, and it is
    // only mined after the watcher gave up.
    node.silence = () => node.submitted.length === 4;
    node.mineDelayMs = () => (node.submitted.length === 4 ? 400 : 20);

    await run(0, 3);
    expectDisjointInputs(node, 6);
  });

  test("a failed run can be retried once the node has caught up", async () => {
    const { node, run } = setup(200);
    // Iteration 0's reveal is neither reported nor mined until much later.
    node.silence = () => node.submitted.length === 2;
    node.mineDelayMs = () => (node.submitted.length === 2 ? 1_500 : 20);

    const error = await run(0, 2).then(
      () => undefined,
      (e: unknown) => e,
    );
    // Not a double spend: the wallet refused to build over a stale set.
    expect(String(error)).not.toContain("in the mempool");
    expect(error).toBeDefined();
    expectDisjointInputs(node, 2);

    // Try again after the reveal landed.
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    await run(0, 2);
    expectDisjointInputs(node, 6);
  });

  test("a broadcast the mempool dropped does not wedge every retry", async () => {
    const { node, run } = setup(200);
    // Iteration 0's reveal is accepted, never reported, and evicted unmined.
    // The node lists its inputs as unspent from then on, so a spent record
    // that is never re-checked refuses every later iteration until the tab
    // is reloaded.
    node.silence = () => node.submitted.length === 2;
    node.onSubmit = (tx) => {
      if (node.submitted.length === 2) node.evict(tx);
    };
    await run(0, 1);
    const dropped = node.submitted[1];
    expect(node.mempool.has(dropped.id)).toBe(false);

    // The next iteration still waits the timeout out (the spend could be a
    // lagging index), then builds on what the dropped reveal had spent.
    const started = Date.now();
    await run(1, 3);
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(node.submitted.length).toBe(6);

    const droppedInputs = dropped.inputs.map((i) =>
      outpointKey(i.previousOutpoint),
    );
    const later = node.submitted
      .slice(2)
      .flatMap((tx) => tx.inputs.map((i) => outpointKey(i.previousOutpoint)));
    expect(later.some((key) => droppedInputs.includes(key))).toBe(true);
    // Everything the mempool still knows is spent exactly once.
    expect(new Set(later).size).toBe(later.length);
  });
});
