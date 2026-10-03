import { expect, test } from "@playwright/test";
import { transform } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function receive() {
  const source = readFileSync(resolve("lib/zkas/direct-receive.ts"), "utf8");
  const body = source.slice(source.indexOf("type Lease ="));
  const prelude = `
    const COLLECTOR_RAW = "b676d61cabef82d1837ffe0f0c69a2002bedb7bd371c1c0b6654dffd2618070be9dfe22640c6c399b2ac22";
    const ID = /^[0-9a-f]{64}$/;
    const bytes = hex => Uint8Array.from(hex.match(/../g), pair => Number.parseInt(pair, 16));
    const hex = data => Array.from(data, byte => byte.toString(16).padStart(2, "0")).join("");
    const ZKAS_MAINNET_GENESIS = "b63f7fe8e50402af34790265e299bb1ba63e943b91a59a670e5971b7a9e84e6f";
    const historyIndexHostPattern = url => url;
    const browser = { permissions: { contains: async () => true } };
    const keyring = {
      getSessionVersion: () => 1, isUnlocked: () => true,
      isPrivateWalletWorkPending: () => false,
      getMutationGeneration: () => globalThis.__pinsGeneration,
      subscribeKeyMutation: (key, callback) => { globalThis.__pinListeners.set(key, callback); return () => globalThis.__pinListeners.delete(key); },
    };
    const ExtensionService = { getInstance: () => ({ getKeyring: () => keyring }) };
    const zkasConnectionStore = { getGeneration: () => 1n, list: async () => ["https://messages.example"] };
    const hasZKasConnection = () => true;
    const zkasKeyService = { openPrivateMessagingSession: async () => globalThis.__pinActor };
    class HistoryGrantStore {
      async listForAccount() { return [{ audience:{kind:"website",origin:"https://messages.example"},
        daemonUrl:"https://daemon.example", indexUrl:"https://index.example",
        address0:"zkas:" + "a".repeat(79), genesis:ZKAS_MAINNET_GENESIS, revision:"r1" }]; }
      async active() { return true; }
    }
    const HISTORY_GRANTS_KEY = "zkasHistoryGrants";
    const DIRECT_PINS_KEY = "zkasDirectPins";
    class DirectBirthStore { async read() { return {walletId:"wallet-1",accountIndex:0,address0:"zkas:"+"a".repeat(79),
      genesis:ZKAS_MAINNET_GENESIS,daemonUrl:"https://daemon.example",indexUrl:"https://index.example",
      birthHash:"22".repeat(32),birthDaa:"1",birthBlue:"1",originalSourceGeneration:"1",sessionId:"33".repeat(16)}; } }
    class DirectPinStore { async read() { return [globalThis.__pinCard]; } }
    class FixedHistoryClient { async getRawPage(_cursor, limit) {
      if (limit === 32 && globalThis.__pinWaitPage) {
        globalThis.__pinPageEntered?.();
        await globalThis.__pinWaitPage;
      }
      return {};
    } }
    class FixedHistoryIndexClient { close() {} }
    class DaemonBearerStore {}
    const witnessDirectBirth = () => ({daa:1n,blue:1n,sourceGeneration:1n});
    const decodeNativeDirectView = () => { throw Error("unused"); };
    const witnessReviewedCursor = () => {};
  `;
  const output = await transform(prelude + body, {
    loader: "ts",
    format: "iife",
    globalName: "PinnedReceive",
    target: "es2022",
  });
  return new Function(output.code + "\nreturn PinnedReceive;")() as {
    DirectReceiveRegistry: new () => {
      read(
        origin: string,
        profile: unknown,
      ): Promise<{ assertImmediate(): void }>;
    };
  };
}

test("receive reopens with exact persisted cards and invalidates a changed pin set", async () => {
  const card = new Uint8Array(184).fill(7);
  const listeners = new Map<string, () => void>();
  const configured: Uint8Array[] = [];
  let closed = false;
  Object.assign(globalThis, {
    __pinsGeneration: 0,
    __pinListeners: listeners,
    __pinCard: card,
    __pinActor: {
      address: "zkas:" + "a".repeat(79),
      selection: { walletId: "wallet-1", accountIndex: 0 },
      daemonUrl: "https://daemon.example",
      indexUrl: "https://index.example",
      publicCard: () => new Uint8Array(184).fill(9),
      assertCurrent: async () => {
        if (closed) throw Error("closed");
      },
      close: () => {
        closed = true;
      },
      directSessionStart: () => {},
      directConfigure: (_collector: Uint8Array, pins: Uint8Array) =>
        configured.push(pins),
      directReceiveStatus: () => 2,
    },
  });
  const { DirectReceiveRegistry } = await receive();
  const registry = new DirectReceiveRegistry();
  const result = await registry.read("https://messages.example", {
    accountAddress: "zkas:" + "a".repeat(79),
    publicCard: Buffer.alloc(184, 9).toString("hex"),
    peerId: "b".repeat(32),
  });
  expect(configured).toEqual([card]);
  (globalThis as unknown as { __pinsGeneration: number }).__pinsGeneration++;
  listeners.get("zkasDirectPins")?.();
  expect(() => result.assertImmediate()).toThrow();
});

test("pin mutation during replay rejects the old plaintext result", async () => {
  const listeners = new Map<string, () => void>();
  let releasePage!: () => void;
  let enteredPage!: () => void;
  const waitPage = new Promise<void>((resolve) => {
    releasePage = resolve;
  });
  const pageEntered = new Promise<void>((resolve) => {
    enteredPage = resolve;
  });
  let closed = false;
  Object.assign(globalThis, {
    __pinsGeneration: 0,
    __pinListeners: listeners,
    __pinCard: new Uint8Array(184).fill(7),
    __pinWaitPage: waitPage,
    __pinPageEntered: enteredPage,
    __pinActor: {
      address: "zkas:" + "a".repeat(79),
      selection: { walletId: "wallet-1", accountIndex: 0 },
      daemonUrl: "https://daemon.example",
      indexUrl: "https://index.example",
      publicCard: () => new Uint8Array(184).fill(9),
      assertCurrent: async () => {
        if (closed) throw Error("closed");
      },
      close: () => {
        closed = true;
      },
      directSessionStart: () => {},
      directConfigure: () => {},
      directReceiveStatus: () => 0,
      directNextRequest: () => "44".repeat(32),
    },
  });
  const { DirectReceiveRegistry } = await receive();
  const pending = new DirectReceiveRegistry().read("https://messages.example", {
    accountAddress: "zkas:" + "a".repeat(79),
    publicCard: Buffer.alloc(184, 9).toString("hex"),
    peerId: "b".repeat(32),
  });
  await pageEntered;
  (globalThis as unknown as { __pinsGeneration: number }).__pinsGeneration++;
  listeners.get("zkasDirectPins")?.();
  releasePage();
  await expect(pending).rejects.toThrow();
  expect(closed).toBe(true);
});
