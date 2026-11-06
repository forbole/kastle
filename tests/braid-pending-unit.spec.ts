import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import type { BraidL1, PreparedDeposit, SwapStatus } from "@braid_swap/sdk";

type PendingModule = typeof import("../lib/braid/pending");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(
  path.join(__dirname, "../lib/braid/pending.ts"),
  "utf8",
);
const KEY = "braid_pending_swaps";
const PAIR = "pk:covid";
const REF = "ref-1";

/**
 * A fresh evaluation of the real source each call: new module-scope Maps,
 * as when the popup closes and opens again. Its only imports are types.
 */
function loadPending(): PendingModule {
  const { outputText } = ts.transpileModule(SOURCE, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} as PendingModule };
  new Function("require", "module", "exports", outputText)(
    (id: string) => {
      throw new Error(`unexpected runtime import ${id}`);
    },
    module,
    module.exports,
  );
  return module.exports;
}

/**
 * browser.storage.local in memory. Values go through JSON like the real
 * store, so a bigint that reaches it throws instead of passing silently.
 * `afterSet` runs once after the next set lands.
 */
function stubStorage() {
  const data: Record<string, unknown> = {};
  const hooks = { afterSet: undefined as (() => void) | undefined };
  const local = {
    async get(key: string) {
      return key in data ? { [key]: structuredClone(data[key]) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [k, v] of Object.entries(items)) {
        data[k] = JSON.parse(JSON.stringify(v));
      }
      const after = hooks.afterSet;
      hooks.afterSet = undefined;
      after?.();
    },
    async remove(key: string) {
      delete data[key];
    },
  };
  (globalThis as any).browser = { storage: { local } };
  return { data, hooks };
}

const stored = (data: Record<string, unknown>) =>
  data[KEY] as {
    swaps: Record<
      string,
      { pairKey: string; startedAt: number; prepared: string }
    >;
    claims: Record<string, { id: string; at: number }>;
  };

// 600 DAA to the deadline: a 60 s + 60 s grace settle window.
const deposit = (ref = REF) =>
  ({
    ref,
    network: "mainnet",
    userPublicKey: "ab".repeat(32),
    depositTxid: "cd".repeat(32),
    amountIn: "1000",
    minOut: 5_000_000_000_000_000_000n,
    midMin: 0n,
    debit: 123_456_789n,
    depositFee: 2_000n,
    braidFeeCap: 10n,
    walletFee: 0n,
    deadlineDaa: 1_000_600n,
    chainDaa: 1_000_000,
    raw: { coinIdx: 0 },
    _ver: { t: { deadline: 1_000_600n, midMin: 0n, inKind: 0n } },
  }) as unknown as PreparedDeposit;

const WINDOW_MS = 120_000;

const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

/** A Braid client whose poll answers only when the test says so. */
function stubBraid() {
  const result = deferred<SwapStatus>();
  const calls: { ref: string; timeoutMs: number }[] = [];
  const braid = {
    waitForResult: (ref: string, o: { timeoutMs: number }) => {
      calls.push({ ref, timeoutMs: o.timeoutMs });
      return result.promise;
    },
    waitOutcome: async () => ({ verified: true, outcome: "delivered" }),
  } as unknown as BraidL1;
  return {
    braid,
    calls,
    deliver: () => result.resolve({ ref: REF, state: "done" }),
  };
}

const settled = () => {
  const seen: string[] = [];
  const done = deferred<void>();
  return {
    seen,
    done: done.promise,
    onSettle: (state: string) => {
      seen.push(state);
      done.resolve();
    },
  };
};

test.afterEach(() => {
  delete (globalThis as any).browser;
});

test.describe("pending Braid swaps across a popup close", () => {
  test("a registered swap survives a fresh module and is resumed", async () => {
    const { data } = stubStorage();
    const before = loadPending();
    expect(await before.claimBraidPair(PAIR)).toBe(true);
    await before.registerBraidSwap({
      ref: REF,
      prepared: deposit(),
      pairKey: PAIR,
      onSettle: () => {},
      braid: stubBraid().braid,
    });
    const startedAt = stored(data).swaps[REF].startedAt;
    // The deposit replaced the swipe's claim in the same write.
    expect(stored(data).claims).toEqual({});

    // Popup closed: new module scope, same storage.
    const after = loadPending();
    expect(after).not.toBe(before);
    expect(await after.isBraidPending(PAIR)).toBe(true);
    expect(await after.claimBraidPair(PAIR)).toBe(false);
    const [swap, ...rest] = await after.getPendingBraidSwaps();
    expect(rest).toEqual([]);
    expect(swap.ref).toBe(REF);
    expect(swap.startedAt).toBe(startedAt);
    // Bigints come back as bigints, the nested terms included.
    expect(swap.prepared.deadlineDaa).toBe(1_000_600n);
    expect(swap.prepared.minOut).toBe(5_000_000_000_000_000_000n);
    expect((swap.prepared as any)._ver.t.deadline).toBe(1_000_600n);

    // Resume through the one register path: it polls and settles.
    const { braid, calls, deliver } = stubBraid();
    const s = settled();
    await after.registerBraidSwap({ ...swap, onSettle: s.onSettle, braid });
    expect(stored(data).swaps[REF].startedAt).toBe(startedAt);
    expect(calls).toHaveLength(1);
    expect(calls[0].ref).toBe(REF);
    // The window keeps running from the first start, not from the resume.
    expect(calls[0].timeoutMs).toBeLessThanOrEqual(
      startedAt + WINDOW_MS - Date.now() + 5,
    );
    deliver();
    await s.done;
    expect(s.seen).toEqual(["done"]);
    expect(await after.isBraidPending(PAIR)).toBe(false);
  });

  test("a settle clears storage before subscribers run", async () => {
    const { data } = stubStorage();
    const m = loadPending();
    const { braid, deliver } = stubBraid();
    const s = settled();
    expect(await m.claimBraidPair(PAIR)).toBe(true);
    await m.registerBraidSwap({
      ref: REF,
      prepared: deposit(),
      pairKey: PAIR,
      onSettle: s.onSettle,
      braid,
    });
    expect(await m.isBraidPending(PAIR)).toBe(true);
    expect(await m.claimBraidPair(PAIR)).toBe(false);

    // What a subscriber sees in storage when it is called.
    const seenBySubscriber: boolean[] = [];
    m.subscribeBraidSwaps(() =>
      seenBySubscriber.push(REF in stored(data).swaps),
    );
    deliver();
    await s.done;

    expect(s.seen).toEqual(["done"]);
    expect(seenBySubscriber).toEqual([false]);
    expect(stored(data).swaps).toEqual({});
    expect(await m.getPendingBraidSwaps()).toEqual([]);
    expect(await m.isBraidPending(PAIR)).toBe(false);
    expect(await m.claimBraidPair(PAIR)).toBe(true);
  });

  test("a cleared swap leaves storage and its poll calls nobody", async () => {
    const { data } = stubStorage();
    const m = loadPending();
    const { braid, deliver } = stubBraid();
    const seen: string[] = [];
    await m.registerBraidSwap({
      ref: REF,
      prepared: deposit(),
      pairKey: PAIR,
      onSettle: (state) => seen.push(state),
      braid,
    });
    await m.clearBraidSwap(REF);
    expect(stored(data).swaps).toEqual({});
    expect(await m.isBraidPending(PAIR)).toBe(false);
    deliver();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([]);
  });

  test("an entry past its deadline plus grace is dropped on read", async () => {
    const { data } = stubStorage();
    await loadPending().registerBraidSwap({
      ref: REF,
      prepared: deposit(),
      pairKey: PAIR,
      onSettle: () => {},
      braid: stubBraid().braid,
    });
    stored(data).swaps[REF].startedAt = Date.now() - WINDOW_MS - 1;

    const m = loadPending();
    expect(await m.getPendingBraidSwaps()).toEqual([]);
    expect(await m.isBraidPending(PAIR)).toBe(false);
    expect(await m.claimBraidPair(PAIR)).toBe(true);
    // The next write drops it from storage too.
    expect(stored(data).swaps).toEqual({});
  });

  test("an entry just inside its window still blocks the pair", async () => {
    const { data } = stubStorage();
    await loadPending().registerBraidSwap({
      ref: REF,
      prepared: deposit(),
      pairKey: PAIR,
      onSettle: () => {},
      braid: stubBraid().braid,
    });
    stored(data).swaps[REF].startedAt = Date.now() - WINDOW_MS + 5_000;

    const m = loadPending();
    expect(await m.isBraidPending(PAIR)).toBe(true);
    expect(await m.claimBraidPair(PAIR)).toBe(false);
  });
});

test.describe("claimBraidPair", () => {
  test("two swaps on one pair cannot both submit", async () => {
    stubStorage();
    const popup = loadPending();
    const otherContext = loadPending();
    expect(await popup.claimBraidPair(PAIR)).toBe(true);
    expect(await popup.claimBraidPair(PAIR)).toBe(false);
    // The claim is in storage, so another context is refused too.
    expect(await otherContext.claimBraidPair(PAIR)).toBe(false);
    // Another pair is free.
    expect(await otherContext.claimBraidPair("pk:other")).toBe(true);
    // Only the owner's release frees it.
    await otherContext.releaseBraidPair(PAIR);
    expect(await otherContext.claimBraidPair(PAIR)).toBe(false);
    await popup.releaseBraidPair(PAIR);
    expect(await otherContext.claimBraidPair(PAIR)).toBe(true);
  });

  test("of two claims racing, exactly one wins", async () => {
    stubStorage();
    const results = await Promise.all([
      loadPending().claimBraidPair(PAIR),
      loadPending().claimBraidPair(PAIR),
      loadPending().claimBraidPair(PAIR),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("a claim overwritten before its read-back is not ours", async () => {
    const { data, hooks } = stubStorage();
    // Another context writes its own claim right after ours lands.
    hooks.afterSet = () => {
      stored(data).claims[PAIR] = { id: "someone-else", at: Date.now() };
    };
    expect(await loadPending().claimBraidPair(PAIR)).toBe(false);
    expect(stored(data).claims[PAIR].id).toBe("someone-else");
  });

  test("a claim older than its TTL no longer blocks the pair", async () => {
    const { data } = stubStorage();
    const closed = loadPending();
    expect(await closed.claimBraidPair(PAIR)).toBe(true);
    // The popup closed between claim and submit.
    const m = loadPending();
    expect(await m.claimBraidPair(PAIR)).toBe(false);
    stored(data).claims[PAIR].at = Date.now() - closed.BRAID_CLAIM_TTL_MS;
    expect(await m.claimBraidPair(PAIR)).toBe(true);
  });
});

test.describe("corrupt storage", () => {
  test("an unparseable record is dropped, the rest kept", async () => {
    const { data } = stubStorage();
    const m = loadPending();
    await m.registerBraidSwap({
      ref: REF,
      prepared: deposit(),
      pairKey: PAIR,
      onSettle: () => {},
      braid: stubBraid().braid,
    });
    const now = Date.now();
    const good = stored(data).swaps[REF];
    Object.assign(stored(data).swaps, {
      "ref-bad-json": { pairKey: "pk:a", startedAt: now, prepared: "{nope" },
      "ref-not-object": 42,
      "ref-no-bigint": {
        pairKey: "pk:b",
        startedAt: now,
        prepared: JSON.stringify({
          ref: "ref-no-bigint",
          userPublicKey: "x",
          deadlineDaa: "1000600",
          chainDaa: 1_000_000,
        }),
      },
      // Stored under one ref, carries another.
      "ref-mismatch": { ...good, pairKey: "pk:c" },
      // A window no verified deposit can have would lock the pair for good.
      "ref-forever": {
        pairKey: "pk:d",
        startedAt: now,
        prepared: good.prepared
          .replaceAll(REF, "ref-forever")
          .replace(
            '"deadlineDaa":{"$bigint":"1000600"}',
            '"deadlineDaa":{"$bigint":"9999999999"}',
          ),
      },
    });
    stored(data).claims["pk:e"] = "junk" as any;

    const fresh = loadPending();
    const swaps = await fresh.getPendingBraidSwaps();
    expect(swaps.map((s) => s.ref)).toEqual([REF]);
    for (const pair of ["pk:a", "pk:b", "pk:c", "pk:d", "pk:e"]) {
      expect(await fresh.isBraidPending(pair)).toBe(false);
      expect(await fresh.claimBraidPair(pair)).toBe(true);
    }
    expect(await fresh.isBraidPending(PAIR)).toBe(true);
  });

  test("a value that is not the state at all reads as empty", async () => {
    const { data } = stubStorage();
    data[KEY] = "garbage";
    const m = loadPending();
    expect(await m.getPendingBraidSwaps()).toEqual([]);
    expect(await m.isBraidPending(PAIR)).toBe(false);
    expect(await m.claimBraidPair(PAIR)).toBe(true);
  });
});
