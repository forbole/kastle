import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import type { BraidL1, L1Quote, PreparedDeposit } from "@braid_swap/sdk";

type HookModule = typeof import("../hooks/swap/useBraidSwap");
type PendingModule = typeof import("../lib/braid/pending");
type HistoryModule = typeof import("../lib/activity/kcc20-swap-history");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(__dirname, "..");
const nodeRequire = createRequire(import.meta.url);
const sdk = nodeRequire("@braid_swap/sdk");
const viem = nodeRequire("viem");

const read = (file: string) => fs.readFileSync(path.join(repo, file), "utf8");

/** Transpiles a real source file and evaluates it with `stubs` as its imports. */
function loadModule<T>(file: string, stubs: Record<string, unknown>): T {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as T };
  new Function("require", "module", "exports", outputText)(
    (id: string) => {
      if (!(id in stubs)) throw new Error(`unexpected runtime import ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}

// The real copy, read from its source: sign-script itself loads the WASM.
const LEDGER_MESSAGE = /KCC20_LEDGER_UNSUPPORTED_MESSAGE =\s*"([^"]+)"/.exec(
  read("lib/wallet/sign-script.ts"),
)![1];

// The signer's refusal, as the bridge rethrows it. One class for the hook and
// for braidErrorCopy, as the one real module would give both.
class BraidSignRefusal extends Error {
  readonly reason: string;
  constructor(message: string) {
    super(`Braid deposit not signed: ${message}`);
    this.name = "BraidSignRefusal";
    this.reason = message;
  }
}

/** browser.storage.local in memory, through JSON like the real store. */
function stubStorage() {
  const data: Record<string, unknown> = {};
  (globalThis as any).browser = {
    storage: {
      local: {
        async get(key: string) {
          return key in data ? { [key]: structuredClone(data[key]) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items))
            data[k] = JSON.parse(JSON.stringify(v));
        },
        async remove(key: string) {
          delete data[key];
        },
      },
    },
  };
  return data;
}

/** A fresh pending store and a hook module bound to it, as one popup. */
function loadAll() {
  const storage = stubStorage();
  const pending = loadModule<PendingModule>("lib/braid/pending.ts", {});
  const constants = loadModule<object>("lib/braid/constants.ts", {});
  const client = loadModule<object>("lib/braid/client.ts", {
    "@braid_swap/sdk": sdk,
    "@/lib/braid/signer": { BraidSignRefusal },
    "@/lib/braid/constants": constants,
  });
  const hook = loadModule<HookModule>("hooks/swap/useBraidSwap.ts", {
    react: {},
    swr: () => ({}),
    viem,
    "@braid_swap/sdk": sdk,
    "@/components/Toast": {},
    "@/lib/braid/client": client,
    "@/lib/braid/constants": constants,
    "@/lib/braid/pending": pending,
    "@/lib/braid/signer": { BraidSignRefusal },
    "@/lib/wallet/sign-script": {
      KCC20_LEDGER_UNSUPPORTED_MESSAGE: LEDGER_MESSAGE,
    },
    "./braidListing": { LINEAGE_FAMILY: {}, useBraidTokens: () => ({}) },
  });
  return { storage, pending, hook };
}

const PK = "ab".repeat(32);
const COVENANT = "c".repeat(64);
const PAIR = `${PK}:${COVENANT}`;
const KEY = "quote-key";

const quote = (over: Partial<L1Quote> = {}) =>
  ({
    amountOut: 1_000n,
    minOut: 990n,
    braidFee: 0n,
    walletFee: { amount: 0n, pk: null, raw: null },
    payTotal: "100000000",
    warnings: [],
    raw: {},
    ...over,
  }) as unknown as L1Quote;

// 600 DAA to the deadline: well inside the claim and settle windows.
const deposit = (over: Partial<PreparedDeposit> = {}) =>
  ({
    ref: "ref-1",
    userPublicKey: PK,
    minOut: 990n,
    braidFeeCap: 0n,
    walletFee: 0n,
    depositFee: 5_000n,
    debit: 100_000_000n,
    deadlineDaa: 1_600n,
    chainDaa: 1_000,
    depositTxid: "d".repeat(64),
    payTotal: "100000000",
    amountIn: "100000000",
    _ver: { tx: {}, t: {} },
    ...over,
  }) as unknown as PreparedDeposit;

/** A Braid client whose calls are counted; no deposit ever settles. */
function stubBraid(o: {
  prepare?: () => Promise<PreparedDeposit>;
  submit?: () => Promise<unknown>;
}) {
  const calls = { prepare: 0, submit: 0 };
  const braid = {
    async prepare() {
      calls.prepare++;
      return (o.prepare ?? (async () => deposit()))();
    },
    async submit() {
      calls.submit++;
      return (o.submit ?? (async () => ({ ref: "ref-1" })))();
    },
    // The settle poll: still in flight for the life of the test.
    waitForResult: () => new Promise(() => {}),
  } as unknown as BraidL1;
  return { braid, calls };
}

function confirmInput(
  hook: HookModule,
  over: Partial<Parameters<HookModule["confirmBraidSwap"]>[0]> = {},
) {
  const toasts: { kind: string; message: string }[] = [];
  const signed: unknown[] = [];
  const notify = {
    success: (message: string) => toasts.push({ kind: "success", message }),
    error: (message: string) => toasts.push({ kind: "error", message }),
    info: (message: string) => toasts.push({ kind: "info", message }),
  };
  const input: Parameters<HookModule["confirmBraidSwap"]>[0] = {
    braid: stubBraid({}).braid,
    quote: { key: KEY, quote: quote() },
    liveKey: () => KEY,
    livePair: () => PAIR,
    pairKey: PAIR,
    userPublicKey: PK,
    isLedger: false,
    sign: async (d) => {
      signed.push(d);
      return { 0: "ee".repeat(64) };
    },
    onSettle: () => {},
    notify,
    onRefusal: () => {},
    onPriceMoved: () => {},
    ...over,
  };
  return { input, toasts, signed };
}

type Stored = {
  swaps: Record<string, { pairKey: string }>;
  claims: Record<string, unknown>;
};
const stored = (data: Record<string, unknown>) =>
  (data.braid_pending_swaps ?? { swaps: {}, claims: {} }) as Stored;

test.describe("braidAmountError", () => {
  test("refuses an amount above the holding, passes one within it", () => {
    const { hook } = loadAll();
    // Holding 5.0 of an 8-decimal token; the amount is 5.00000001.
    const holding = 500_000_000n;
    expect(hook.braidAmountError(500_000_001n, holding)).toBe(
      "Oh, you don't have enough funds",
    );
    expect(hook.braidAmountError(500_000_001n, holding)).toBe(
      hook.NOT_ENOUGH_FUNDS_COPY,
    );
    expect(hook.braidAmountError(holding, holding)).toBeUndefined();
    expect(hook.braidAmountError(499_999_999n, holding)).toBeUndefined();
  });
});

test.describe("confirmBraidSwap", () => {
  test("a Ledger account is refused before any claim, build or signature", async () => {
    const { hook, storage } = loadAll();
    const { braid, calls } = stubBraid({});
    const { input, toasts, signed } = confirmInput(hook, {
      braid,
      isLedger: true,
    });
    expect(await hook.confirmBraidSwap(input)).toBe("refused");
    expect(toasts).toEqual([{ kind: "error", message: LEDGER_MESSAGE }]);
    expect(LEDGER_MESSAGE).toContain("cannot be signed on Ledger");
    expect(calls).toEqual({ prepare: 0, submit: 0 });
    expect(signed).toHaveLength(0);
    expect(stored(storage).claims).toEqual({});
  });

  test("a submitted swap blocks the pair; a second confirm cannot submit", async () => {
    const { hook, pending, storage } = loadAll();
    const { braid, calls } = stubBraid({});
    const first = confirmInput(hook, { braid });
    expect(await hook.confirmBraidSwap(first.input)).toBe("submitted");
    expect(first.toasts).toEqual([
      { kind: "info", message: hook.BRAID_SUBMITTED_COPY },
    ]);
    // Never "Swapped successfully" before the settle poll.
    expect(first.toasts.some((t) => /successfully/i.test(t.message))).toBe(
      false,
    );
    expect(stored(storage).swaps["ref-1"].pairKey).toBe(PAIR);
    expect(await pending.isBraidPending(PAIR)).toBe(true);

    const second = confirmInput(hook, { braid });
    expect(await hook.confirmBraidSwap(second.input)).toBe("pending");
    expect(second.toasts).toEqual([
      { kind: "error", message: hook.BRAID_PENDING_COPY },
    ]);
    expect(hook.BRAID_PENDING_COPY).toBe(
      "A Braid swap for this pair is still settling.",
    );
    expect(calls).toEqual({ prepare: 1, submit: 1 });
    expect(second.signed).toHaveLength(0);
  });

  test("a confirm while another holds the claim cannot build", async () => {
    const { hook, pending } = loadAll();
    expect(await pending.claimBraidPair(PAIR)).toBe(true);
    const { braid, calls } = stubBraid({});
    const { input, toasts } = confirmInput(hook, { braid });
    expect(await hook.confirmBraidSwap(input)).toBe("pending");
    expect(toasts).toEqual([
      { kind: "error", message: hook.BRAID_PENDING_COPY },
    ]);
    expect(calls.prepare).toBe(0);
  });

  test("an unknown error after the signatures were sent keeps the pair blocked", async () => {
    const { hook, pending, storage } = loadAll();
    const { braid, calls } = stubBraid({
      submit: async () => {
        throw new sdk.BraidError("socket hang up");
      },
    });
    const { input, toasts, signed } = confirmInput(hook, { braid });
    expect(await hook.confirmBraidSwap(input)).toBe("unknown");
    expect(calls.submit).toBe(1);
    expect(signed).toHaveLength(1);
    expect(toasts).toEqual([
      { kind: "error", message: hook.BRAID_UNKNOWN_COPY },
    ]);
    expect(hook.BRAID_UNKNOWN_COPY).toBe(
      "Swap may be settling. Check Activity.",
    );
    // Registered in place of the claim: the pair stays blocked until settle.
    expect(stored(storage).swaps["ref-1"].pairKey).toBe(PAIR);
    expect(stored(storage).claims).toEqual({});
    expect(await pending.isBraidPending(PAIR)).toBe(true);
    expect(await pending.claimBraidPair(PAIR)).toBe(false);
  });

  test("a pre-sign refusal releases the pair and signs nothing", async () => {
    const { hook, pending, storage } = loadAll();
    const { braid, calls } = stubBraid({});
    const refusals: string[] = [];
    const { input, toasts } = confirmInput(hook, {
      braid,
      sign: async () => {
        throw new BraidSignRefusal("input 0 is not blank");
      },
      onRefusal: (_q, message) => refusals.push(message),
    });
    expect(await hook.confirmBraidSwap(input)).toBe("refused");
    const copy = "This swap failed a safety check and was not signed.";
    expect(toasts).toEqual([{ kind: "error", message: copy }]);
    expect(refusals).toEqual([copy]);
    expect(calls.submit).toBe(0);
    expect(stored(storage).swaps).toEqual({});
    expect(stored(storage).claims).toEqual({});
    expect(await pending.claimBraidPair(PAIR)).toBe(true);
  });

  test("a build worse than the quote is refused as price moved, unsigned", async () => {
    const { hook, storage } = loadAll();
    const { braid, calls } = stubBraid({
      prepare: async () => deposit({ minOut: 900n }),
    });
    let refreshed = 0;
    const { input, toasts, signed } = confirmInput(hook, {
      braid,
      onPriceMoved: () => refreshed++,
    });
    expect(await hook.confirmBraidSwap(input)).toBe("refused");
    expect(toasts).toEqual([{ kind: "error", message: hook.PRICE_MOVED_COPY }]);
    expect(refreshed).toBe(1);
    expect(signed).toHaveLength(0);
    expect(calls.submit).toBe(0);
    expect(stored(storage).claims).toEqual({});
  });

  test("a late answer for another account sends nothing and frees only its own claim", async () => {
    const { hook, pending, storage } = loadAll();
    const OTHER = `${"cd".repeat(32)}:${COVENANT}`;
    let screen = PAIR;
    const { braid, calls } = stubBraid({
      prepare: async () => {
        // The user switched account while Braid built the deposit, and the
        // other account claimed its own pair.
        screen = OTHER;
        expect(await pending.claimBraidPair(OTHER)).toBe(true);
        return deposit();
      },
    });
    const { input, signed, toasts } = confirmInput(hook, {
      braid,
      livePair: () => screen,
    });
    expect(await hook.confirmBraidSwap(input)).toBe("aborted");
    expect(signed).toHaveLength(0);
    expect(calls.submit).toBe(0);
    expect(toasts).toEqual([]);
    expect(Object.keys(stored(storage).claims)).toEqual([OTHER]);
  });

  test("a quote for an older amount is never built", async () => {
    const { hook, storage } = loadAll();
    const { braid, calls } = stubBraid({});
    const { input, toasts } = confirmInput(hook, {
      braid,
      liveKey: () => "another-amount",
    });
    expect(await hook.confirmBraidSwap(input)).toBe("aborted");
    expect(toasts[0].message).toBe(
      "The amount changed. Review the new quote and confirm again.",
    );
    expect(calls.prepare).toBe(0);
    expect(stored(storage).claims).toEqual({});
  });
});

test.describe("Braid trade in the swap history", () => {
  let history: HistoryModule;
  test.beforeAll(async () => {
    const outfile = path.join(tmpdir(), `braid-swap-unit-${process.pid}.mjs`);
    await build({
      stdin: {
        contents: 'export * from "@/lib/activity/kcc20-swap-history";',
        resolveDir: repo,
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "esm",
      outfile,
      tsconfig: path.join(repo, "tsconfig.json"),
      loader: {
        ".png": "empty",
        ".svg": "empty",
        ".jpg": "empty",
        ".webp": "empty",
        ".css": "empty",
      },
      logLevel: "silent",
    });
    history = (await import(pathToFileURL(outfile).href)) as HistoryModule;
  });

  const WALLET_SPK = `20${PK}ac`;
  const VENUE_SPK = `20${"ef".repeat(32)}ac`;
  // Braid's router script: P2SH, not a plain address.
  const ROUTER_SPK = `aa20${"12".repeat(32)}87`;
  const spk = (script: string) => `0000${script}`;

  // 3 KAS in from the wallet: 1 KAS deposit, 0.25 KAS to a plain third
  // party, 1.74 KAS change, so 0.01 KAS network fee.
  const walletJson = JSON.stringify({
    version: 1,
    inputs: [
      {
        transactionId: "aa".repeat(32),
        index: 0,
        sequence: "0",
        sigOpCount: 1,
        signatureScript: "",
        utxo: {
          address: null,
          amount: "300000000",
          scriptPublicKey: spk(WALLET_SPK),
          blockDaaScore: "1",
          isCoinbase: false,
        },
      },
    ],
    outputs: [
      { value: "100000000", scriptPublicKey: spk(ROUTER_SPK) },
      { value: "25000000", scriptPublicKey: spk(VENUE_SPK) },
      { value: "174000000", scriptPublicKey: spk(WALLET_SPK) },
    ],
    subnetworkId: "00".repeat(20),
    lockTime: "0",
    gas: "0",
    payload: "",
  });

  test("the venue fee and the network fee keep their own fields", () => {
    const [row] = history.braidPendingRecords(
      [
        {
          ref: "ref-1",
          pairKey: PAIR,
          startedAt: 1_700_000_000_000,
          prepared: deposit({
            walletJson,
            to: { id: COVENANT, symbol: "TKN" },
            from: { id: "", symbol: "KAS" },
          } as Partial<PreparedDeposit>),
        },
      ],
      PK,
      new Map([[COVENANT, { symbol: "TKN", decimals: 2 }]]),
    );
    expect(row).toEqual({
      id: "braid:ref-1",
      timestampMs: 1_700_000_000_000,
      fromSymbol: "KAS",
      toSymbol: "TKN",
      fromAmount: "1",
      // Unobserved until the chain shows the delivery.
      toAmount: "0",
      status: "pending",
      txHash: "d".repeat(64),
      chainId: expect.any(Number),
      feeAmount: "0.01",
      feeSymbol: "KAS",
      kastleFeeAmount: "0.25",
      kastleFeeSymbol: "KAS",
    });
    expect(row.providerId).toBeUndefined();
  });

  test("a delivered sell shows the chain amount; a router output is no fee", () => {
    const money = history.deriveBraidDepositMoney(
      {
        version: 1,
        inputs: [
          {
            utxo: { amount: 110_000n, scriptPublicKey: WALLET_SPK },
          },
        ],
        outputs: [{ value: 100_000n, scriptPublicKey: ROUTER_SPK }],
      } as never,
      WALLET_SPK,
    );
    expect(money).toEqual({ networkFeeSompi: 10_000n, venueFeeSompi: 0n });
    const row = history.braidSwapRecord({
      ref: "r",
      depositTxid: "t",
      startedAt: 1,
      side: "sell",
      tokenSymbol: "TKN",
      tokenDecimals: 2,
      amountIn: 1_234n,
      amountOut: 250_000_000n,
      state: "done",
      money,
    });
    expect(row).toMatchObject({
      fromSymbol: "TKN",
      fromAmount: "12.34",
      toSymbol: "KAS",
      toAmount: "2.5",
      status: "completed",
      feeAmount: "0.0001",
    });
    expect(row.kastleFeeAmount).toBeUndefined();
  });

  test("a plain input from another party makes the fees unreadable", () => {
    expect(
      history.deriveBraidDepositMoney(
        {
          version: 1,
          inputs: [
            { utxo: { amount: 1_000n, scriptPublicKey: WALLET_SPK } },
            { utxo: { amount: 1_000n, scriptPublicKey: VENUE_SPK } },
          ],
          outputs: [{ value: 1_500n, scriptPublicKey: VENUE_SPK }],
        } as never,
        WALLET_SPK,
      ),
    ).toBeNull();
  });
});
