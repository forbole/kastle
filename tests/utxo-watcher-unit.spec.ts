import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import init, {
  Address,
  IUtxoEntry,
  PrivateKey,
  RpcClient,
} from "@/wasm/core/kaspa";
import { waitForUtxosChanged } from "@/lib/commit-reveal";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

test.beforeAll(async () => {
  await init({
    module_or_path: fs.readFileSync(
      path.join(TESTS_DIR, "../assets/kaspa_bg.wasm"),
    ),
  });
});

// Kaspa's utxos-changed subscription is a set of addresses on the connection,
// with no per-caller count. The reveal watcher orphaned by a broadcast failure
// keeps running until its timeout and then unsubscribes; a retry started in
// that window shares the address and used to lose its subscription.
test.describe("utxos-changed watchers sharing a connection", () => {
  // Built inside each test: the WASM module is only initialised in beforeAll.
  const addressOf = (key: string) =>
    new PrivateKey(key).toPublicKey().toAddress("mainnet").toString();
  const KEY_A =
    "b7e151628aed2a6abf7158809cf4f3c762e7160f38b4da56a784d9045190cfef";
  const KEY_B =
    "c90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74020bbea63b14e5c9";

  class FakeSubscriptions {
    subscribed: string[][] = [];
    unsubscribed: string[][] = [];
    listeners = new Set<(event: unknown) => void>();

    async subscribeUtxosChanged(addresses: string[]) {
      this.subscribed.push(addresses);
    }
    async unsubscribeUtxosChanged(addresses: string[]) {
      this.unsubscribed.push(addresses);
    }
    addEventListener(_: string, listener: (event: unknown) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_: string, listener: (event: unknown) => void) {
      this.listeners.delete(listener);
    }
    emit(address: string) {
      const added = [{ address: new Address(address) } as IUtxoEntry];
      for (const listener of this.listeners) {
        listener({ type: "utxos-changed", data: { added, removed: [] } });
      }
    }
    asRpcClient() {
      return this as unknown as RpcClient;
    }
  }

  test("an orphaned watcher's timeout does not unsubscribe a live one", async () => {
    const ADDRESS = addressOf(KEY_A);
    const node = new FakeSubscriptions();
    const orphan = waitForUtxosChanged(
      node.asRpcClient(),
      [ADDRESS],
      () => false,
      50,
    );
    const live = waitForUtxosChanged(
      node.asRpcClient(),
      [ADDRESS],
      (added) => added.length > 0,
      1_000,
    );

    await expect(orphan).rejects.toThrow("Timeout");
    expect(node.subscribed).toEqual([[ADDRESS], [ADDRESS]]);
    expect(node.unsubscribed).toEqual([]);

    node.emit(ADDRESS);
    await live;
    expect(node.unsubscribed).toEqual([[ADDRESS]]);
  });

  test("the last watcher standing unsubscribes only what it alone held", async () => {
    const ADDRESS = addressOf(KEY_A);
    const OTHER = addressOf(KEY_B);
    const node = new FakeSubscriptions();
    const shared = waitForUtxosChanged(
      node.asRpcClient(),
      [ADDRESS],
      (added) => added.length > 0,
      1_000,
    );
    const pair = waitForUtxosChanged(
      node.asRpcClient(),
      [ADDRESS, OTHER],
      () => false,
      50,
    );

    await expect(pair).rejects.toThrow("Timeout");
    expect(node.unsubscribed).toEqual([[OTHER]]);

    node.emit(ADDRESS);
    await shared;
    expect(node.unsubscribed).toEqual([[OTHER], [ADDRESS]]);
  });
});
