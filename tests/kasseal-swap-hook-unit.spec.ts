import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";
import type { BuiltTx, FundingUtxo, SubmitState } from "@kassealhq/sdk";
import type { KassealToken, KassealTxStatus } from "@/lib/kasseal/api";
import type { KassealPreview } from "@/lib/kasseal/prepared";
import type {
  KassealQuoteRequest,
  KassealSwapInput,
} from "@/hooks/swap/useKassealSwap";
import type { L1SwapHandlers } from "@/hooks/swap/l1Types";
import type { KassealWallet } from "@/lib/kasseal/sign";
import * as diagnostics from "@/lib/diagnostics";
import * as market from "@/lib/kasseal/market";
import * as pending from "@/lib/kasseal/pending";
import * as popupWallet from "@/lib/kasseal/popupWallet";
import * as trade from "@/lib/kasseal/trade";

type HookModule = typeof import("../hooks/swap/useKassealSwap");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const React = nodeRequire("react");
const { createRoot } = nodeRequire("react-dom/client");
const swr = nodeRequire("swr");
const viem = nodeRequire("viem");
const { act } = React;
const read = (file: string) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/** Transpiles a real source file and evaluates it with `stubs` as its imports. */
function loadModule(file: string, stubs: Record<string, unknown>) {
  const { outputText } = ts.transpileModule(read(file), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as any };
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

// The URLs as contexts/SettingsContext.tsx declares them, read off the source.
const settingsSource = read("contexts/SettingsContext.tsx");
const urlOf = (member: string) =>
  settingsSource.match(
    new RegExp(
      `KASSEAL_API_URLS[\\s\\S]*?\\[NetworkType\\.${member}\\]: "([^"]+)"`,
    ),
  )![1];
const KASSEAL_API_URLS = {
  mainnet: urlOf("Mainnet"),
  "testnet-10": urlOf("TestnetT10"),
};
const NetworkType = { Mainnet: "mainnet", TestnetT10: "testnet-10" };

const api = loadModule("lib/kasseal/api.ts", {
  "@/contexts/SettingsContext.tsx": { KASSEAL_API_URLS, NetworkType },
});
const errorCopy = loadModule("lib/kasseal/errorCopy.ts", {
  "@kassealhq/sdk": { errorCode: () => undefined },
  "./trade": { KassealTradeError: class {} },
  "./init": { KassealReloadRequired: class {} },
});
const hook: HookModule = loadModule("hooks/swap/useKassealSwap.ts", {
  react: React,
  swr,
  viem,
  "@/lib/kasseal/api": api,
  "@/lib/kasseal/errorCopy": errorCopy,
  "@/lib/kasseal/prepared": loadModule("lib/kasseal/prepared.ts", {}),
  "@/lib/kasseal/market": market,
  "@/lib/kasseal/pending": pending,
  "@/lib/kasseal/popupWallet": popupWallet,
  // The real one deserializes through WASM; this one only asks the wallet.
  "@/lib/kasseal/sign": {
    signKassealTx: async (wallet: KassealWallet, built: BuiltTx) => {
      await wallet.signTx({} as never, []);
      return `${built.txJson}:signed`;
    },
  },
  "@/lib/kasseal/trade": trade,
  "@/lib/diagnostics": diagnostics,
});

/** browser.storage.local in memory, through JSON like the real store. */
let store: Record<string, unknown> = {};
test.beforeEach(() => {
  store = {};
  (globalThis as any).browser = {
    storage: {
      local: {
        async get(key: string) {
          return key in store ? { [key]: structuredClone(store[key]) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items))
            store[k] = JSON.parse(JSON.stringify(v));
        },
        async remove(key: string) {
          delete store[key];
        },
      },
    },
  };
});

const PAIR = pending.kassealTradeKey(
  "mainnet",
  "kaspa:qtrader",
  "ab".repeat(32),
);
const fakeBuilt = (txid: string) =>
  ({
    txid,
    txJson: "{}",
    consumes: [{ txid: "f1", index: 0 }],
    inputsToSign: [],
    budgets: [],
    produces: [],
    feeSompi: 2_000n,
    feerate: 1n,
  }) as unknown as BuiltTx;

/** Submission deps for one buy funded from coin f1; every POST and build is counted. */
function tradeDeps(
  post: (built: BuiltTx) => Promise<SubmitState>,
  opts: {
    build?: () => Promise<BuiltTx>;
    status?: (txid: string) => Promise<KassealTxStatus>;
  } = {},
) {
  const seen = { builds: 0, posts: [] as string[] };
  let t = 0;
  const deps: KassealSwapInput["trade"] = {
    makeBuilder: () => ({
      builder: {} as trade.KassealBuilder,
      lastFunding: () =>
        [{ outpoint: { txid: "f1", index: 0 } }] as unknown as FundingUtxo[],
    }),
    build: async () => {
      seen.builds += 1;
      return (opts.build ?? (async () => fakeBuilt("tx1")))();
    },
    post: (built) => {
      seen.posts.push(built.txid);
      return post(built);
    },
    status: opts.status ?? (async () => ({ kind: "unknown" })),
    now: () => (t += 1_000),
    sleepUntil: async (until) => {
      t = Math.max(t, until);
    },
    pollMs: 0,
  };
  return { deps, seen };
}

const okSigner = {
  signInputDigest: async () => "",
  signTx: async (tx: never) => tx,
};
const never = <T>() => new Promise<T>(() => {});

const TOKEN: KassealToken = {
  covenantId: "ab".repeat(32),
  name: "Seal",
  ticker: "SEAL",
  decimals: 8,
  totalSupply: 10n ** 17n,
  holders: 3,
  phase: "bonding",
  verification: "verified",
  curve: {
    lotsSold: 10,
    curveLots: 1000,
    lotSize: 1_000_000_000n, // 10 SEAL
    nextLotPrice: 50_000_000n, // 0.5 KAS
    raisedSompi: 0n,
    targetSompi: 0n,
  },
};

const BUY: KassealPreview = {
  side: "buy",
  amountIn: "1000000000", // 10 KAS
  walletDebitSompi: "1030000000", // 10.3 KAS
  minOut: "18000000000", // 180 SEAL
  expectedOut: "20000000000", // 200 SEAL
  feeSompi: "2000000", // 0.02 KAS
  tradingFeeSompi: "10000000", // 0.1 KAS
};

const SELL: KassealPreview = {
  side: "sell",
  amountIn: "20000000000", // 200 SEAL
  walletCreditSompi: "900000000", // 9 KAS
  tokenCellSompi: "-20000000", // -0.2 KAS
  minOut: "850000000",
  expectedOut: "900000000",
  feeSompi: "2000000",
  tradingFeeSompi: null,
};

const DOM_GLOBALS = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
const saved = new Map<string, PropertyDescriptor | undefined>();
const unmounts: (() => Promise<void>)[] = [];
// The worker is shared with other specs: leave no fake DOM behind.
test.afterEach(async () => {
  for (const u of unmounts.splice(0)) await u();
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as Record<string, unknown>)[k];
  }
  saved.clear();
});

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

/** Renders the hook with a fresh SWR cache; `calls` records every quote request. */
async function render(overrides: Partial<KassealSwapInput> = {}) {
  const win = new Window();
  for (const k of DOM_GLOBALS) {
    if (!saved.has(k))
      saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
  }
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const calls: KassealQuoteRequest[] = [];
  const input: KassealSwapInput = {
    side: "buy",
    token: TOKEN,
    amountUnits: 1_000_000_000n,
    address: "kaspa:qtrader",
    network: "mainnet",
    wallet: { kasSompi: 5_000_000_000n, tokenUnits: 30_000_000_000n },
    slippage: 0.5,
    quoteClient: async (req) => {
      calls.push(req);
      return BUY;
    },
    trade: tradeDeps(async () => {
      throw new Error("unexpected POST");
    }).deps,
    signer: okSigner as unknown as KassealSwapInput["signer"],
    ...overrides,
  };
  let latest: L1SwapHandlers | undefined;
  const Probe = (p: KassealSwapInput) => {
    latest = hook.useKassealSwap(p);
    return null;
  };
  const root = createRoot(win.document.createElement("div"));
  const cache = new Map();
  const draw = (p: KassealSwapInput) =>
    act(async () =>
      root.render(
        React.createElement(
          swr.SWRConfig,
          { value: { provider: () => cache, dedupingInterval: 0 } },
          React.createElement(Probe, p),
        ),
      ),
    );
  await draw(input);
  await settle();
  unmounts.push(() => act(async () => root.unmount()));
  return {
    h: () => latest!,
    calls,
    update: (o: Partial<KassealSwapInput>) => draw({ ...input, ...o }),
  };
}

test("a live buy quote fills quote, minOut, feeLines, totalDebit and rate", async () => {
  const { h } = await render();
  expect(String(h().quote?.amountOut)).toBe("18000000000");
  expect(String(h().minOut)).toBe("18000000000");
  expect(h().totalDebit).toEqual({ amount: 10.3, symbol: "KAS" });
  expect(h().rate).toBe(20); // 200 SEAL / 10 KAS
  expect(h().feeLines.map((l) => [l.name, l.amount, l.display])).toEqual([
    ["Network", 0.02, "0.02 KAS"],
    ["Kasseal", 0.1, "0.1 KAS"],
  ]);
  expect(h().advisory).toEqual([
    "You pay 10 KAS. 10.3 KAS leaves your wallet in total (price, token cell and network fee).",
  ]);
  expect(h().creditLines).toEqual([]);
  expect(h().isLoading).toBe(false);
  expect(h().extraErrorMessage).toBeUndefined();
});

test("a live sell quote fills creditLines, signed, and leaves totalDebit absent", async () => {
  const { h } = await render({
    side: "sell",
    amountUnits: 20_000_000_000n,
    quoteClient: async () => SELL,
  });
  expect(h().creditLines?.map((l) => [l.name, l.amount, l.display])).toEqual([
    ["You receive", 9, "+9 KAS"],
    ["Token cell", -0.2, "-0.2 KAS"],
  ]);
  expect(h().totalDebit).toBeUndefined();
  expect(h().rate).toBe(0.045); // 9 KAS / 200 SEAL
  // A credit is never a fee: only the network line, the trading fee is null.
  expect(h().feeLines.map((l) => l.name)).toEqual(["Network"]);
});

test("the network line is first and Kastle is kastleFeeBps, never a row", async () => {
  const { h } = await render();
  expect(h().feeLines[0].name).toBe("Network");
  expect(h().feeLines.some((l) => l.name === "Kastle")).toBe(false);
  expect(h().kastleFeeBps).toBe(0);
});

test("an unknown debit is absent and an unknown fee shows no number", async () => {
  const { walletDebitSompi: _d, feeSompi: _f, ...unbuilt } = BUY;
  const { h } = await render({ quoteClient: async () => unbuilt });
  expect(h().totalDebit).toBeUndefined();
  const network = h().feeLines[0];
  expect(network.name).toBe("Network");
  expect(network.amount).toBeUndefined();
  expect(network.display).not.toMatch(/\d/);
  expect(h().advisory).toEqual(["You pay 10 KAS."]);
});

test("validateAmount refuses below minimum, above balance and above the slippage ceiling", async () => {
  const buy = (await render()).h();
  expect(buy.validateAmount(0n)).toBe("Please enter a valid amount");
  expect(buy.validateAmount(49_999_999n)).toBe(
    "Amount is below one lot of this token.",
  );
  expect(buy.validateAmount(5_000_000_001n)).toBe(
    "Oh, you don't have enough funds",
  );
  expect(buy.validateAmount(5_000_000_000n)).toBeUndefined();
  // Max keeps the 1 KAS buy reserve back.
  expect(buy.findMax()).toBe("49");

  const sell = (await render({ side: "sell", amountUnits: 0n })).h();
  expect(sell.validateAmount(999_999_999n)).toBe(
    "Amount is below one lot of this token.",
  );
  expect(sell.validateAmount(30_000_000_001n)).toBe(
    "Oh, you don't have enough funds",
  );
  expect(sell.findMax()).toBe("300");

  const steep = (await render({ slippage: 10.01 })).h();
  expect(steep.validateAmount(1_000_000_000n)).toBe(
    "Slippage must be between 0% and 10%.",
  );
  const unknown = (await render({ wallet: {} })).h();
  expect(unknown.validateAmount(10n ** 18n)).toBeUndefined();
  expect(unknown.findMax()).toBeUndefined();
});

test("a refused quote sets extraErrorMessage and leaves the quote absent", async () => {
  for (const [message, copy] of [
    [
      "KASSEAL_BUILD_FAILED:ZERO_LOTS",
      "Amount is below one lot of this token.",
    ],
    ["KASSEAL_NO_POOL", "This token can't be swapped on Kasseal yet."],
    ["KASSEAL_CURVE_UNUSABLE:SOLD_OUT", "This token's curve is sold out."],
    ["KASSEAL_BAD_PARAMS", "Kasseal can't build this swap right now."],
  ]) {
    const { h } = await render({
      quoteClient: async () => {
        throw new Error(message);
      },
    });
    expect(h().extraErrorMessage).toBe(copy);
    expect(h().quote).toBeUndefined();
    expect(h().minOut).toBeUndefined();
    expect(h().feeLines).toEqual([]);
  }
});

test("testnet-10 quotes through the settings URL, as mainnet does", async () => {
  for (const network of ["testnet-10", "mainnet"] as const) {
    const { h, calls } = await render({ network });
    expect(calls).toHaveLength(1);
    expect(calls[0].apiUrl).toBe(KASSEAL_API_URLS[network]);
    expect(calls[0].network).toBe(network);
    expect(String(calls[0].amountIn)).toBe("1000000000");
    expect(calls[0].slippageBps).toBe(50);
    expect(String(h().minOut)).toBe("18000000000");
  }
  const { calls } = await render({ network: "testnet-11" });
  expect(calls).toHaveLength(0);
});

/** Starts a confirm that may never settle: an async act() that never resolves would hold every update. */
const press = (h: () => L1SwapHandlers) =>
  act(() => {
    void h().onConfirm();
  });

const stored = () => store[PAIR] as trade.StoredKassealAttempt | undefined;

test.describe("onConfirm", () => {
  test("the attempt, with the txid being posted and its pinned coin, is stored when the POST goes out", async () => {
    let atPost: trade.StoredKassealAttempt | undefined;
    const { deps, seen } = tradeDeps(
      async (built) => {
        atPost = structuredClone(stored());
        return { kind: "submitted", txid: built.txid, at: 0 } as SubmitState;
      },
      {
        status: async (txid) =>
          ({
            kind: "accepted",
            txid,
            acceptingBlueScore: 3,
          }) as KassealTxStatus,
      },
    );
    const { h } = await render({ trade: deps });
    await act(() => h().onConfirm());
    expect(seen.posts).toEqual(["tx1"]);
    expect(atPost?.posted).toEqual(["tx1"]);
    expect(atPost?.pinned).toEqual(["f1:0"]);
    expect(atPost?.intent).toMatchObject({ side: "buy", amount: "1000000000" });
    // Landed: the key goes, nothing is pending, no report.
    expect(stored()).toBeUndefined();
    expect(h().pending).toBe(false);
    expect(h().report).toBeUndefined();
  });

  test("a POST that never answers stays pending with the key kept; reopening reports pending and posts nothing", async () => {
    const first = tradeDeps(never);
    const { h } = await render({ trade: first.deps });
    press(h);
    await settle();
    expect(first.seen.posts).toEqual(["tx1"]);
    expect(h().pending).toBe(true);
    expect(h().isSigning).toBe(true);
    expect(stored()?.posted).toEqual(["tx1"]);

    // The popup reopens: /tx has not seen it yet.
    const again = tradeDeps(async () => {
      throw new Error("re-broadcast");
    });
    const reopened = await render({ trade: again.deps });
    expect(reopened.h().pending).toBe(true);
    expect(reopened.h().pendingCopy).toBe(pending.KASSEAL_PENDING_COPY);
    expect(again.seen.builds).toBe(0);
    expect(again.seen.posts).toEqual([]);
    expect(stored()?.posted).toEqual(["tx1"]);
  });

  test("a definitive refusal clears the key and leaves nothing pending", async () => {
    const { deps, seen } = tradeDeps(never, {
      build: async () => {
        throw new trade.KassealTradeError(
          "no-pool",
          "launch proof binds no pool",
        );
      },
    });
    const { h } = await render({ trade: deps });
    await act(() => h().onConfirm());
    expect(seen.posts).toEqual([]);
    expect(stored()).toBeUndefined();
    expect(h().pending).toBe(false);
    expect(h().pendingCopy).toBeUndefined();
    expect(h().report).toMatchObject({ flow: "kasseal-swap", cleared: true });
  });

  test("a signer that throws yields a report and clears nothing: the outcome is unknown", async () => {
    const { deps, seen } = tradeDeps(never);
    const signer = {
      signInputDigest: async () => "",
      signTx: async () => {
        throw new Error("background signer gone");
      },
    } as unknown as KassealSwapInput["signer"];
    const { h } = await render({ trade: deps, signer });
    await act(() => h().onConfirm());
    expect(seen.posts).toEqual([]);
    const report = h().report;
    expect(report).not.toBeNull();
    expect(report).toMatchObject({
      flow: "kasseal-swap",
      error: "Error: background signer gone",
      cleared: false,
    });
    expect(stored()).toBeDefined();
    expect(h().pending).toBe(true);
    expect(h().extraErrorMessage).toBe(pending.KASSEAL_PENDING_COPY);
  });

  test("the confirm refuses when the amount changed since the quote", async () => {
    const { deps, seen } = tradeDeps(never);
    const { h, update } = await render({ trade: deps });
    await update({ amountUnits: 2_000_000_000n });
    await act(() => h().onConfirm());
    expect(h().extraErrorMessage).toBe(hook.KASSEAL_CHANGED_COPY);
    expect(seen.builds).toBe(0);
    expect(stored()).toBeUndefined();
  });

  test("with a stored open attempt, or one already in flight, onConfirm is not entered twice", async () => {
    const { deps, seen } = tradeDeps(never);
    const { h } = await render({ trade: deps });
    // A double press: the second sees the first's guard, not a stale `pending`.
    press(h);
    press(h);
    await settle();
    expect(seen.builds).toBe(1);
    expect(seen.posts).toEqual(["tx1"]);

    // Reopened over that stored attempt: pending, and confirm builds nothing.
    const again = tradeDeps(never);
    const reopened = await render({ trade: again.deps });
    expect(reopened.h().pending).toBe(true);
    await act(() => reopened.h().onConfirm());
    await act(() => reopened.h().onConfirm());
    expect(again.seen.builds).toBe(0);
    expect(reopened.h().extraErrorMessage).toBe(pending.KASSEAL_PENDING_COPY);
  });

  test("kassealRefusalClearsLock: only trade.ts build refusals prove nothing is live", () => {
    expect(
      hook.kassealRefusalClearsLock(
        new trade.KassealTradeError("no-pool", "x"),
      ),
    ).toBe(true);
    expect(
      hook.kassealRefusalClearsLock(
        new trade.KassealTradeError("outcome-unknown", "x"),
      ),
    ).toBe(false);
    expect(hook.kassealRefusalClearsLock(new Error("no-pool"))).toBe(false);
  });
});
