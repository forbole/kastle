import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";
import * as viem from "viem";
import * as trade from "@/lib/kasseal/trade";
import * as market from "@/lib/kasseal/market";
import * as errorCopy from "@/lib/kasseal/errorCopy";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const React = nodeRequire("react");
const { createRoot } = nodeRequire("react-dom/client");
const { act } = React;

/**
 * Transpiles real source and evaluates it with `stubs` as its imports and
 * `globals` as its WXT auto-imports.
 */
function loadModule(
  file: string,
  stubs: Record<string, unknown>,
  globals: Record<string, unknown> = {},
) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as any };
  new Function(
    "require",
    "module",
    "exports",
    ...Object.keys(globals),
    outputText,
  )(
    (id: string) => {
      if (!(id in stubs)) throw new Error(`no stub for ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
    ...Object.values(globals),
  );
  return module.exports;
}

/** Default-export stubs need the ES-module flag the transpiled imports check. */
const esm = (stubs: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(stubs).map(([id, m]) => [
      id,
      m && typeof m === "object" && "default" in m
        ? { __esModule: true, ...m }
        : m,
    ]),
  );

const DOM_GLOBALS = [
  "window",
  "document",
  "HTMLElement",
  "IS_REACT_ACT_ENVIRONMENT",
];
const saved = new Map<string, PropertyDescriptor | undefined>();

function installDom(win: Window) {
  for (const k of DOM_GLOBALS) {
    if (!saved.has(k))
      saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
  }
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
}

// the worker is shared with other specs; don't leave a fake DOM behind
test.afterEach(() => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
  saved.clear();
});

const h = React.createElement;
const KAS = 100_000_000n;
const SEAL = {
  covenantId: "A",
  name: "Seal",
  ticker: "SEAL",
  decimals: 8,
  imageUrl: "seal.png",
  phase: "bonding",
  verification: "verified",
};
const FAKE = { ...SEAL, covenantId: "B", ticker: "FAKE" };
type Quote = trade.KassealQuote;
type Submit = (
  quote: Quote,
  attempt: trade.KassealAttempt,
  persist: (a: trade.KassealAttempt) => Promise<void>,
) => Promise<string>;

/**
 * The real Swap screen over an in-memory extension storage: a closed popup is
 * an unmount, reopening it a fresh mount over the same storage.
 */
function swapScreen(flags: {
  kasseal: boolean;
  kcc20?: boolean;
  kasBalance?: number;
  wallet?: string;
}) {
  const store = new Map<string, unknown>();
  const memStorage = {
    getItem: async (k: string) => structuredClone(store.get(k) ?? null),
    setItem: async (k: string, v: unknown) => {
      store.set(k, structuredClone(v));
    },
  };
  const attempts = loadModule("lib/kasseal/attempts.ts", {
    "wxt/storage": { storage: memStorage },
    "./trade": trade,
  });
  const statuses: Record<string, string> = {};
  const statusReads: string[] = [];
  // A held `/tx` read answers only once the test releases it.
  const statusGates: Record<string, Promise<void>> = {};
  const refreshes: string[] = [];
  // The screen's own timers run on a fake clock: `advance` fires due ones.
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  const fakeSetTimeout = (run: () => void, ms = 0) => {
    timers.push({ at: now + ms, run });
    return timers.length;
  };
  // The wallet's account, switchable while the screen is open.
  let address = "kaspa:me";
  const accountListeners = new Set<() => void>();
  const useWalletManager = () => ({
    wallet: { type: flags.wallet ?? "hot" },
    account: {
      address: React.useSyncExternalStore(
        (l: () => void) => {
          accountListeners.add(l);
          return () => accountListeners.delete(l);
        },
        () => address,
      ),
    },
  });
  const events: string[] = [];
  const toasts: string[] = [];
  const tokenCalls: boolean[] = [];
  const hookCalls: { side: string; slippage: number }[] = [];
  let venue: trade.KassealVenue = "curve";
  let quoteFor = (side: trade.KassealSide, amountIn: bigint): Quote => ({
    side,
    venue,
    lots: 1n,
    amountIn,
    amountOut: 1_000n * KAS,
    feeSompi: KAS / 100n,
    bound: (amountIn * 101n) / 100n,
  });
  let submitImpl: Submit = async () => "x";

  // Captured props of the stubbed UI parts, refreshed on every render.
  const ui: { amount?: any; confirm?: any; sheets: any[] } = { sheets: [] };
  const Stub = () => null;
  const swapUi = {
    BottomSheet: (p: any) =>
      p.open ? h("div", { "data-sheet": p.title }, p.children) : null,
    ConfirmButton: (p: any) => {
      ui.confirm = p;
      return h("button", { onClick: p.onClick, disabled: p.disabled }, "Swap");
    },
    PairArrow: Stub,
    ProviderRow: Stub,
    QuoteRow: (p: any) =>
      h(
        "div",
        { "data-row": p.label, onClick: p.onClick },
        p.label,
        ": ",
        p.children,
      ),
    Skeleton: () => "…",
    TermsGate: Stub,
    TokenPill: Stub,
    TokenSheet: (p: any) => {
      ui.sheets.push(p);
      return null;
    },
    AmountInput: (p: any) => {
      ui.amount = p;
      return null;
    },
    formatAmount: (n: number) => String(n),
    formatUsd: (n: number) => String(n),
  };

  const Swap = loadModule(
    "components/screens/Swap.tsx",
    esm({
      react: React,
      "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
      swr: { default: () => ({ data: undefined }) },
      // No RPC: the EVM client is built but never used on these pairs.
      viem: { ...viem, createPublicClient: () => ({}), http: () => ({}) },
      "viem/accounts": {},
      "@kassealhq/sdk": { errorCode: (e: any) => e?.code },
      "@/components/GeneralHeader": { default: Stub },
      "@/components/Toast": {
        default: {
          info: (m: string) => toasts.push(`info ${m}`),
          success: (m: string) => toasts.push(`success ${m}`),
          error: (m: string) => toasts.push(`error ${m}`),
        },
      },
      "@/components/swap-bridge/ui": swapUi,
      "@/components/BottomNav": { default: Stub, ActivityHeaderButton: Stub },
      "@/contexts/SettingsContext": {
        NetworkType: { Mainnet: "mainnet", TestnetT10: "testnet-10" },
      },
      "@/hooks/useSwitchNetwork": {
        default: () => ({ switchKaspaNetwork: async () => {} }),
      },
      "@/hooks/evm/useEvmAddress": { default: () => undefined },
      "@/hooks/wallet/useEvmHotWalletSigner": { default: () => undefined },
      "@/hooks/wallet/useWalletManager": { default: useWalletManager },
      "@/hooks/useKaspaPrice": { default: () => ({ kaspaPrice: 0 }) },
      "@/hooks/useAnalytics": {
        default: () => ({
          emitSwapCompleted: (e: any) => events.push(`swap_completed ${e}`),
          emitKassealTradeCompleted: (e: any) =>
            events.push(`kasseal_trade_completed ${e.status} ${e.side}`),
        }),
      },
      "@/hooks/evm/useErc20Prices": { useErc20Price: () => ({ price: 0 }) },
      "@/hooks/evm/useErc20Assets": { default: () => ({ assets: [] }) },
      "@/hooks/evm/useErc20Balance": {
        useErc20Balances: () => ({ data: undefined }),
      },
      "@/hooks/evm/useEvmKasBalance": {
        useEvmKasBalances: () => ({ data: undefined }),
      },
      "@/hooks/evm/useFeeEstimateByGas": {
        default: () => ({ data: undefined }),
        SWAP_GAS_ESTIMATES: new Proxy({}, { get: () => 1n }),
      },
      "@/hooks/evm/provider/useZealousSwap": {
        ZEALOUS_SWAP_IGRA_IMAGE_URL: "",
        ZEALOUS_SWAP_IMAGE_URL: "",
        useZealousSwapTokensMetadata: () => ({ data: undefined }),
        // One ERC-20 on Igra: a real DEX pair, so its quote card has Slippage.
        useZealousSwapIgraTokensMetadata: () => ({
          data: {
            tokens: [
              { address: "0xT", symbol: "TKN", decimals: 18, logoURI: "t" },
            ],
          },
        }),
      },
      "@/lib/layer2": {
        igraMainnet: {
          id: 38833,
          icon: "igra",
          nativeCurrency: { symbol: "iKAS" },
        },
        kasplexMainnet: {
          id: 202555,
          icon: "kasplex",
          nativeCurrency: { symbol: "KAS" },
        },
      },
      "@/lib/evm/swap/constants": {
        KASPA_COM_PARTNER_KEY: "0x",
        getSwapProvidersForChain: () => [],
        getWkasAddress: () => "0xWKAS",
        resolveSwapProviderForChain: () => undefined,
      },
      "@/lib/evm/swap/pathFinder": {},
      "@/lib/evm/swap/swapExecutor": {},
      "@/lib/swap-bridge-quote": {
        computeSwapKastleFee: () => ({ kastleFeeBps: 0, kastleFee: 0 }),
        swapMinReceived: (v: bigint) => v,
        swapPathAmountIn: (v: bigint) => v,
      },
      "@/components/swap-bridge/swap-fee-summary": {
        FeeRow: (p: any) => h("div", { "data-fee": p.label }, p.value),
        SwapFeeFootnote: () => h("div", { "data-kastle-fee": "footnote" }),
        SwapFeeSummary: () => h("div", { "data-kastle-fee": "summary" }),
      },
      "@/assets/images/network-logos/kaspa.svg": { default: "kaspa.svg" },
      "@/hooks/useFeatureFlags.ts": {
        useFeatureFlags: () => ({
          isKcc20Enabled: !!flags.kcc20,
          isKassealEnabled: flags.kasseal,
        }),
      },
      "@/hooks/wallet/useKaspaBalance": {
        default: () => flags.kasBalance ?? 1_000,
      },
      "@/hooks/wallet/useKaspaHotWalletSigner": { default: () => ({}) },
      "@/lib/kcc20/useKcc20Tokens": {
        default: () => ({
          data: [
            { covenantId: "A", family: "kcc20-standard", spendable: 50n * KAS },
          ],
        }),
      },
      "@/lib/kcc20": { decimalsError: () => undefined },
      "@/components/screens/Settings": { restApis: {} },
      "@/lib/kcc20/swap": {},
      "@/lib/kasseal/useKassealTokens": {
        default: (_search: unknown, enabled = true) => {
          tokenCalls.push(enabled);
          return {
            data: enabled
              ? [SEAL, { ...FAKE, verification: "invalid" }]
              : undefined,
          };
        },
      },
      "@/lib/kasseal/useKassealSwap": {
        default: (
          _network: unknown,
          token: typeof SEAL | undefined,
          side: trade.KassealSide,
          amountIn: bigint | undefined,
          slippage: number,
        ) => {
          if (token) hookCalls.push({ side, slippage });
          const quote =
            token && amountIn ? quoteFor(side, amountIn) : undefined;
          return {
            quote,
            isLoading: false,
            venue: token && venue,
            boundKind: quote && trade.boundKind(quote),
            refresh: async () => {
              refreshes.push(`${token?.covenantId} ${side}`);
            },
            submit: (...a: Parameters<Submit>) => submitImpl(...a),
          };
        },
      },
      "@/lib/kasseal/market": market,
      "@/lib/kasseal/api": {
        fetchTxStatus: async (_: string, txid: string) => {
          statusReads.push(txid);
          await statusGates[txid];
          return { kind: statuses[txid] ?? "unknown", txid };
        },
        kassealBaseUrl: () => "https://k",
        kassealNetworkOf: (n: string) => n,
      },
      "@/lib/kasseal/attempts": attempts,
      "@/lib/kasseal/trade": trade,
      "@/lib/kasseal/errorCopy": errorCopy,
    }),
    {
      useRpcClientStateful: () => ({ networkId: "mainnet" }),
      setTimeout: fakeSetTimeout,
    },
  ).default;

  const settle = () =>
    act(async () => {
      for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    });

  async function open() {
    const win = new Window();
    installDom(win);
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(h(Swap)));
    await settle();
    const run = async (f: () => void) => {
      await act(async () => f());
      await settle();
    };
    const sheet = (side: "in" | "out") => {
      const last = ui.sheets.slice(-2);
      return side === "in" ? last[0] : last[1];
    };
    const pick = (side: "in" | "out", key: string) => {
      const token = sheet("out").tokens.find((t: any) => t.key === key);
      expect(token, `${key} in the token list`).toBeTruthy();
      return run(() => sheet(side).onSelect(token));
    };
    const row = (label: string) =>
      container.querySelector(`[data-row="${label}"]`)?.textContent;
    return {
      ui,
      run,
      sheet,
      pick,
      row,
      // KAS -> SEAL on Kaspa L1.
      buy: async (amount: string) => {
        await pick("out", "kaspa:A");
        await run(() => ui.amount.onChange(amount));
      },
      // SEAL -> KAS on Kaspa L1.
      sell: async (amount: string) => {
        await pick("in", "kaspa:A");
        await pick("out", "kaspa:native");
        await run(() => ui.amount.onChange(amount));
      },
      confirm: () => run(() => ui.confirm.onClick()),
      el: (sel: string) => container.querySelector(sel) as any,
      typeSlippage: async (v: string) => {
        const input = container.querySelector(
          '[data-sheet="Slippage"] input',
        ) as any;
        const set = Object.getOwnPropertyDescriptor(
          win.HTMLInputElement.prototype,
          "value",
        )!.set!;
        // React DOM loaded before this DOM, so it reads text input through
        // its fallback: a focusin, then a keyup after the value changes.
        await run(() => {
          input.dispatchEvent(new win.Event("focusin", { bubbles: true }));
          set.call(input, v);
          input.dispatchEvent(new win.Event("keyup", { bubbles: true }));
        });
      },
      text: () => container.textContent ?? "",
      // Fake time passes: the screen's timers due by then fire.
      advance: async (ms: number) => {
        now += ms;
        for (;;) {
          const due = timers.filter((t) => t.at <= now);
          if (!due.length) break;
          timers = timers.filter((t) => t.at > now);
          await run(() => due.forEach((t) => t.run()));
        }
      },
      setAccount: (a: string) =>
        run(() => {
          address = a;
          accountListeners.forEach((l) => l());
        }),
      close: () => act(() => root.unmount()),
    };
  }

  return {
    open,
    store,
    statuses,
    statusReads,
    refreshes,
    // Holds `/tx` reads of `txid`; the returned call releases them.
    holdStatus: (txid: string) => {
      let release!: () => void;
      statusGates[txid] = new Promise((r) => (release = r));
      return async () => {
        delete statusGates[txid];
        release();
        await settle();
      };
    },
    // An attempt already on disk, as an earlier popup left it.
    seedAttempt: (key: string, attempt: trade.KassealAttempt) =>
      attempts.saveKassealAttempt(key, attempt),
    events,
    toasts,
    tokenCalls,
    hookCalls,
    setQuote: (f: typeof quoteFor) => {
      quoteFor = f;
    },
    setSubmit: (f: Submit) => {
      submitImpl = f;
    },
    // A curve token that graduates to its pool.
    setVenue: (v: trade.KassealVenue) => {
      venue = v;
    },
  };
}

const keys = (t: any[]) => t.map((x) => x.key);

test.describe("Kasseal in the Swap screen", () => {
  test("flag off hides Kasseal and never queries its token list", async () => {
    const s = swapScreen({ kasseal: false, kcc20: true });
    const screen = await s.open();
    expect(keys(screen.sheet("out").tokens)).not.toContain("kaspa:A");
    expect(s.tokenCalls.length).toBeGreaterThan(0);
    expect(s.tokenCalls.every((enabled) => !enabled)).toBe(true);
    await screen.close();
  });

  test("flag on lists Kasseal tokens with the Kaspa chip", async () => {
    const s = swapScreen({ kasseal: true });
    const screen = await s.open();
    const out = screen.sheet("out");
    expect(out.chains.map((c: any) => c.key)).toContain("kaspa");
    const seal = out.tokens.find((t: any) => t.key === "kaspa:A");
    expect(seal).toMatchObject({
      chain: "kaspa",
      symbol: "SEAL",
      chainImage: "kaspa.svg",
      balance: "50",
    });
    expect(keys(out.tokens)).toContain("kaspa:native");
    // An invalid launch proof is never listed.
    expect(keys(out.tokens)).not.toContain("kaspa:B");
    await screen.close();
  });

  test("a curve buy shows Max Paid; a sell shows Min Received", async () => {
    const s = swapScreen({ kasseal: true });
    const buy = await s.open();
    await buy.buy("10");
    expect(buy.row("Max Paid")).toContain("10.1 KAS");
    expect(buy.row("Min Received")).toBeUndefined();
    expect(buy.row("Provider")).toContain("Kasseal");
    expect(buy.row("Est. Fee")).toContain("at confirm");
    expect(buy.el("[data-kastle-fee]")).toBeNull();
    await buy.close();

    const sell = await s.open();
    await sell.sell("5");
    expect(sell.row("Min Received")).toContain("5.05 KAS");
    expect(sell.row("Max Paid")).toBeUndefined();
    await sell.close();
  });

  test("You pay (actual) shows only when the curve takes a different amount", async () => {
    const s = swapScreen({ kasseal: true });
    const screen = await s.open();
    await screen.buy("10");
    expect(screen.row("You pay (actual)")).toBeUndefined();

    // Whole lots cost less than the 10 KAS budget.
    s.setQuote((side, amountIn) => ({
      side,
      venue: "curve",
      lots: 3n,
      amountIn: amountIn - 25_000_000n,
      amountOut: 3_000n,
      feeSompi: 0n,
      bound: amountIn,
    }));
    // A new string re-renders the screen; the amount stays 10 KAS.
    await screen.run(() => screen.ui.amount.onChange("10.0"));
    expect(screen.row("You pay (actual)")).toContain("9.75 KAS");
    await screen.close();
  });

  test("slippage is clamped at 10% for a Kasseal trade", async () => {
    const s = swapScreen({ kasseal: true });
    const screen = await s.open();
    // 20% is a valid choice on an Igra DEX pair.
    await screen.pick("out", "igra:0xt");
    await screen.run(() => screen.ui.amount.onChange("1"));
    await screen.run(() => screen.el('[data-row="Slippage"]').click());
    await screen.typeSlippage("20");
    expect(screen.row("Slippage")).toContain("20%");

    await screen.buy("10");
    expect(screen.row("Slippage")).toContain("10%");
    expect(s.hookCalls.length).toBeGreaterThan(0);
    expect(Math.max(...s.hookCalls.map((c) => c.slippage))).toBe(10);

    // On a Kasseal pair a custom value above 10% is refused.
    await screen.run(() => screen.el('[data-row="Slippage"]').click());
    await screen.typeSlippage("15");
    expect(screen.text()).toContain("between 0.1% and 10%");
    await screen.typeSlippage("8");
    expect(screen.row("Slippage")).toContain("8%");
    await screen.close();
  });

  test("confirm runs the Kasseal submit and emits kasseal_trade_completed only", async () => {
    const s = swapScreen({ kasseal: true });
    const submitted: Quote[] = [];
    s.setSubmit(async (q) => {
      submitted.push(q);
      return "t1";
    });
    s.statuses.t1 = "accepted";
    const screen = await s.open();
    await screen.buy("10");
    expect(screen.ui.confirm.disabled).toBe(false);
    await screen.confirm();
    expect(submitted.map((q) => `${q.side} ${q.amountIn}`)).toEqual([
      `buy ${10n * KAS}`,
    ]);
    // Success is told only after `/tx` reads the returned txid as accepted.
    expect(s.statusReads).toEqual(["t1"]);
    expect(s.events).toEqual(["kasseal_trade_completed success buy"]);
    expect(s.toasts).toContain("success Swapped successfully!");
    await screen.close();
  });
});

/** A submission whose POST went out and then gave up without an answer. */
const unansweredPost =
  (txid: string): Submit =>
  async (_q, a, persist) => {
    a.pinned ??= new Set(["f1:0"]);
    await persist({ ...a, posted: [...a.posted, txid] });
    a.posted.push(txid);
    throw new trade.KassealTradeError("outcome-unknown", "gave up");
  };

const attemptKeys = (store: Map<string, unknown>) =>
  Object.keys((store.get("local:kasseal_attempts") as object) ?? {});

test.describe("Kasseal open attempt in the Swap screen", () => {
  test("a closed popup reopens on the open attempt and refuses another trade", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(unansweredPost("a1"));
    const first = await s.open();
    await first.buy("10");
    await first.confirm();
    expect(s.toasts.at(-1)).toContain("may still go through");
    expect(attemptKeys(s.store)).toEqual(["mainnet:kaspa:me:A"]);
    await first.close();

    const again = await s.open();
    expect(again.sheet("in").chain).toBe("kaspa");
    expect(again.ui.amount.value).toBe("10");
    expect(again.ui.confirm.disabled).toBe(false);
    await again.run(() => again.ui.amount.onChange("20"));
    expect(again.ui.confirm.disabled).toBe(true);
    expect(again.ui.confirm.error).toContain("may still go through");

    // The retry gets the restored attempt: same coins, earlier txid first.
    let seen: trade.KassealAttempt | undefined;
    s.setSubmit(async (_q, a) => {
      seen = a;
      return "a1";
    });
    await again.run(() => again.ui.amount.onChange("10"));
    s.statuses.a1 = "submitted";
    await again.confirm();
    expect(seen!.posted).toEqual(["a1"]);
    expect([...seen!.pinned!]).toEqual(["f1:0"]);
    // Only in a mempool: not landed, so the attempt stays.
    expect(s.toasts).not.toContain("success Swapped successfully!");
    expect(attemptKeys(s.store)).toEqual(["mainnet:kaspa:me:A"]);
    await again.close();

    // Landed: the attempt is cleared, so the next trade starts fresh.
    s.statuses.a1 = "accepted";
    const last = await s.open();
    expect(attemptKeys(s.store)).toEqual([]);
    await last.close();
  });

  test("after a failed try, a sell cannot inherit the open buy", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(unansweredPost("a1"));
    const screen = await s.open();
    await screen.buy("10");
    await screen.confirm();

    await screen.run(() => screen.ui.amount.onFlip());
    await screen.run(() => screen.ui.amount.onChange("10"));
    expect(screen.ui.confirm.disabled).toBe(true);
    expect(screen.ui.confirm.error).toContain("earlier buy of 10 KAS");
    expect(s.events).toEqual(["kasseal_trade_completed failed buy"]);
    await screen.close();
  });

  test("an attempt that landed while the popup was closed is cleared on reopen", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(unansweredPost("a1"));
    const first = await s.open();
    await first.buy("10");
    await first.confirm();
    await first.close();

    s.statuses.a1 = "accepted";
    const again = await s.open();
    expect(attemptKeys(s.store)).toEqual([]);
    await again.sell("5");
    expect(again.ui.confirm.error).toBeUndefined();
    expect(again.ui.confirm.disabled).toBe(false);
    await again.close();
  });

  test("a failure before any POST leaves nothing locked", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(async () => {
      throw new trade.KassealTradeError("no-pool", "no pool");
    });
    const screen = await s.open();
    await screen.buy("10");
    await screen.confirm();
    expect(s.toasts.at(-1)).toContain("no verified pool");
    await screen.run(() => screen.ui.amount.onFlip());
    await screen.run(() => screen.ui.amount.onChange("5"));
    expect(screen.ui.confirm.error).toBeUndefined();
    expect(screen.ui.confirm.disabled).toBe(false);
    expect(s.store.size).toBe(0);
    await screen.close();
  });
});

/** A submission whose POST went out and came back with `txid`. */
const postedOk =
  (txid: string): Submit =>
  async (_q, a, persist) => {
    a.pinned ??= new Set(["f1:0"]);
    await persist({ ...a, posted: [...a.posted, txid] });
    a.posted.push(txid);
    return txid;
  };

/** The rebuild found the pinned coins spent: the earlier POST may have landed. */
const pinnedFundingGone: Submit = async () => {
  // The SDK's PinnedFundingGone carries both fields.
  throw Object.assign(new Error("pinned funding gone"), {
    code: "PINNED_FUNDING_GONE",
    errorCode: "PINNED_FUNDING_GONE",
  });
};

test.describe("Kasseal outcome is read from /tx", () => {
  test("a mempool-only result is reported as submitted, not swapped", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(postedOk("t1"));
    s.statuses.t1 = "submitted";
    const screen = await s.open();
    await screen.buy("10");
    await screen.confirm();
    expect(s.toasts).not.toContain("success Swapped successfully!");
    expect(s.toasts.at(-1)).toContain("submitted");
    expect(s.events).toEqual([]);
    // The attempt stays on disk and confirm stays blocked.
    expect(attemptKeys(s.store)).toEqual(["mainnet:kaspa:me:A"]);
    expect(screen.ui.confirm.disabled).toBe(true);
    expect(screen.ui.confirm.error).toContain("submitted");

    // The screen keeps reading `/tx` every 2 s: acceptance completes it.
    s.statuses.t1 = "accepted";
    await screen.advance(1_999);
    expect(s.toasts).not.toContain("success Swapped successfully!");
    await screen.advance(1);
    expect(s.toasts.at(-1)).toBe("success Swapped successfully!");
    expect(s.events).toEqual(["kasseal_trade_completed success buy"]);
    expect(attemptKeys(s.store)).toEqual([]);
    expect(screen.ui.confirm.error).toBeUndefined();
    expect(screen.ui.amount.value).toBe("");
    await screen.close();
  });

  test("a mempool-only result is restored after the popup closes", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(postedOk("t1"));
    s.statuses.t1 = "already-in-mempool";
    const first = await s.open();
    await first.buy("10");
    await first.confirm();
    await first.close();

    const again = await s.open();
    expect(attemptKeys(s.store)).toEqual(["mainnet:kaspa:me:A"]);
    expect(again.ui.amount.value).toBe("10");
    await again.run(() => again.ui.amount.onChange("20"));
    expect(again.ui.confirm.disabled).toBe(true);
    expect(again.ui.confirm.error).toContain("may still go through");
    await again.close();
  });

  test("a dropped result takes the failure path", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(postedOk("t1"));
    s.statuses.t1 = "dropped";
    const screen = await s.open();
    await screen.buy("10");
    await screen.confirm();
    expect(s.toasts).not.toContain("success Swapped successfully!");
    expect(s.toasts.at(-1)).toBe(
      `error ${errorCopy.kassealErrorCopy(new Error("dropped"))}`,
    );
    expect(s.events).toEqual(["kasseal_trade_completed failed buy"]);
    // Dropped is a known outcome: nothing stays locked.
    expect(attemptKeys(s.store)).toEqual([]);
    await screen.run(() => screen.ui.amount.onChange("20"));
    expect(screen.ui.confirm.error).toBeUndefined();
    await screen.close();
  });

  test("PINNED_FUNDING_GONE keeps the attempt and the lock until /tx answers", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(unansweredPost("a1"));
    const screen = await s.open();
    await screen.buy("10");
    await screen.confirm();

    s.setSubmit(pinnedFundingGone);
    await screen.confirm();
    expect(s.toasts.at(-1)).toContain("may have gone through");
    expect(attemptKeys(s.store)).toEqual(["mainnet:kaspa:me:A"]);
    // Blocked even for the same trade, with the same copy.
    expect(screen.ui.confirm.disabled).toBe(true);
    expect(screen.ui.confirm.error).toContain("may have gone through");
    await screen.run(() => screen.ui.amount.onChange("20"));
    expect(screen.ui.confirm.disabled).toBe(true);

    // An unknown status changes nothing.
    await screen.advance(2_000);
    expect(attemptKeys(s.store)).toEqual(["mainnet:kaspa:me:A"]);
    expect(screen.ui.confirm.disabled).toBe(true);

    // `/tx` answers dropped: the outcome is known, so the lock is released.
    s.statuses.a1 = "dropped";
    await screen.advance(2_000);
    expect(attemptKeys(s.store)).toEqual([]);
    expect(screen.ui.confirm.error).toBeUndefined();
    expect(screen.ui.confirm.disabled).toBe(false);
    await screen.close();
  });

  test("PINNED_FUNDING_GONE survives a closed popup while the status lags", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(unansweredPost("a1"));
    const first = await s.open();
    await first.buy("10");
    await first.confirm();
    s.setSubmit(pinnedFundingGone);
    await first.confirm();
    await first.close();

    const again = await s.open();
    expect(attemptKeys(s.store)).toEqual(["mainnet:kaspa:me:A"]);
    await again.run(() => again.ui.amount.onChange("20"));
    expect(again.ui.confirm.disabled).toBe(true);
    await again.close();

    s.statuses.a1 = "accepted";
    const last = await s.open();
    expect(attemptKeys(s.store)).toEqual([]);
    await last.close();
  });
});

/** Another account's sell of 5 SEAL, left open by an earlier popup. */
const YOU = "mainnet:kaspa:you:A";
const youSell = (): trade.KassealAttempt => ({
  pinned: new Set(["g1:0"]),
  posted: ["u1"],
  intent: { side: "sell", venue: "curve", amount: 5n * KAS, input: "5" },
});

type Screen = Awaited<ReturnType<ReturnType<typeof swapScreen>["open"]>>;

/** The other account's restored attempt: nothing reported, still locked. */
async function expectYouUntouched(
  s: ReturnType<typeof swapScreen>,
  screen: Screen,
) {
  expect(s.toasts).not.toContain("success Swapped successfully!");
  expect(s.events).toEqual([]);
  expect(attemptKeys(s.store)).toContain(YOU);
  expect(screen.ui.amount.value).toBe("5");
  await screen.run(() => screen.ui.amount.onChange("6"));
  expect(screen.ui.confirm.disabled).toBe(true);
  expect(screen.ui.confirm.error).toContain("earlier sell");
}

/** A deferred: the test decides when the awaited step ends. */
function gate() {
  let open!: () => void;
  const until = new Promise<void>((r) => (open = r));
  return { until, open };
}

test.describe("Kasseal work that ends after the screen moved on", () => {
  test("a poll read that lands after an account switch leaves the new account alone", async () => {
    const s = swapScreen({ kasseal: true });
    await s.seedAttempt(YOU, youSell());
    s.setSubmit(postedOk("t1"));
    s.statuses.t1 = "submitted";
    const screen = await s.open();
    await screen.buy("10");
    await screen.confirm();

    // The poll passes its first check, then waits on `/tx`.
    const release = s.holdStatus("t1");
    await screen.advance(2_000);
    expect(s.statusReads.at(-1)).toBe("t1");
    await screen.setAccount("kaspa:you");
    expect(screen.ui.amount.value).toBe("5");

    s.statuses.t1 = "accepted";
    await release();
    await expectYouUntouched(s, screen);
    await screen.close();
  });

  test("a submit whose /tx read lands after an account switch leaves the new account alone", async () => {
    const s = swapScreen({ kasseal: true });
    await s.seedAttempt(YOU, youSell());
    s.setSubmit(postedOk("t1"));
    s.statuses.t1 = "accepted";
    const screen = await s.open();
    await screen.buy("10");

    const release = s.holdStatus("t1");
    await screen.run(() => void screen.ui.confirm.onClick());
    expect(s.statusReads.at(-1)).toBe("t1");
    await screen.setAccount("kaspa:you");

    await release();
    await expectYouUntouched(s, screen);
    await screen.close();
  });

  test("a submit that fails after an account switch leaves the new account alone", async () => {
    const s = swapScreen({ kasseal: true });
    await s.seedAttempt(YOU, youSell());
    const post = gate();
    s.setSubmit(async (q, a, persist) => {
      a.pinned ??= new Set(["f1:0"]);
      await persist({ ...a, posted: [...a.posted, "t1"] });
      a.posted.push("t1");
      await post.until;
      throw new trade.KassealTradeError("outcome-unknown", "gave up");
    });
    const screen = await s.open();
    await screen.buy("10");

    await screen.run(() => void screen.ui.confirm.onClick());
    await screen.setAccount("kaspa:you");

    await screen.run(() => post.open());
    await expectYouUntouched(s, screen);
    await screen.close();
  });

  test("a poll read that lands after the popup closed changes nothing", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(postedOk("t1"));
    s.statuses.t1 = "submitted";
    const screen = await s.open();
    await screen.buy("10");
    await screen.confirm();

    const release = s.holdStatus("t1");
    await screen.advance(2_000);
    await screen.close();
    s.statuses.t1 = "accepted";
    await release();
    expect(s.toasts).not.toContain("success Swapped successfully!");
    expect(s.events).toEqual([]);
    // The next open reads `/tx` again and settles it there.
    expect(attemptKeys(s.store)).toEqual(["mainnet:kaspa:me:A"]);
  });

  test("a poll that lands after a token switch keeps the new pair's amount", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(postedOk("t1"));
    s.statuses.t1 = "submitted";
    const screen = await s.open();
    await screen.buy("10");
    await screen.confirm();

    // Now SEAL -> KAS: another pair than the attempt's buy.
    await screen.run(() => screen.ui.amount.onFlip());
    await screen.run(() => screen.ui.amount.onChange("7"));
    s.statuses.t1 = "accepted";
    await screen.advance(2_000);
    expect(s.toasts.at(-1)).toBe("success Swapped successfully!");
    expect(s.events).toEqual(["kasseal_trade_completed success buy"]);
    expect(screen.ui.amount.value).toBe("7");
    // Same token, other side: the market the buy moved still refreshes.
    expect(s.refreshes).toEqual(["A sell"]);
    await screen.close();
  });
});

test.describe("Kasseal reopen on a submitted attempt", () => {
  test("a reopened submitted attempt shows submitted, blocks confirm and re-polls", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(postedOk("t1"));
    s.statuses.t1 = "submitted";
    const first = await s.open();
    await first.buy("10");
    await first.confirm();
    await first.close();

    const again = await s.open();
    expect(again.ui.amount.value).toBe("10");
    // Blocked even for the same trade, with the submitted copy.
    expect(again.ui.confirm.disabled).toBe(true);
    expect(again.ui.confirm.error).toContain("submitted");

    // No click needed: the screen reads `/tx` again on its own.
    s.statuses.t1 = "accepted";
    await again.advance(2_000);
    expect(s.toasts.at(-1)).toBe("success Swapped successfully!");
    expect(s.events).toEqual(["kasseal_trade_completed success buy"]);
    expect(attemptKeys(s.store)).toEqual([]);
    expect(again.ui.confirm.error).toBeUndefined();
    expect(again.ui.amount.value).toBe("");
    expect(s.refreshes).toEqual(["A buy"]);
    await again.close();
  });

  test("a poll tick during a retry submit cannot settle the attempt", async () => {
    const s = swapScreen({ kasseal: true });
    const KEY = "mainnet:kaspa:me:A";
    await s.seedAttempt(KEY, {
      pinned: new Set(["g1:0"]),
      posted: ["t1"],
      intent: { side: "buy", venue: "curve", amount: 10n * KAS, input: "10" },
    });
    // The retry rebuilds on the pinned coins, then posts t2.
    const build = gate();
    const calls: trade.KassealAttempt[] = [];
    const posts: string[] = [];
    s.setSubmit(async (_q, a, persist) => {
      calls.push(a);
      await build.until;
      await persist({ ...a, posted: [...a.posted, "t2"] });
      a.posted.push("t2");
      posts.push("t2");
      return "t2";
    });
    const screen = await s.open();
    expect(screen.ui.amount.value).toBe("10");
    // `/tx` reads t1 as unknown: the same trade can retry.
    expect(screen.ui.confirm.disabled).toBe(false);

    await screen.run(() => void screen.ui.confirm.onClick());
    expect(calls).toHaveLength(1);

    // The reopen poll ticks mid-build and now reads t1 as dropped.
    s.statuses.t1 = "dropped";
    await screen.advance(2_000);
    expect(posts).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(s.events).toEqual([]);
    expect(s.toasts.filter((t) => t.startsWith("error"))).toEqual([]);
    expect(attemptKeys(s.store)).toEqual([KEY]);
    await screen.run(() => screen.ui.amount.onChange("20"));
    expect(screen.ui.confirm.disabled).toBe(true);
    expect(screen.ui.confirm.error).toContain("earlier buy");
    await screen.run(() => screen.ui.amount.onChange("10"));

    // The submit ends: t1 dropped, t2 unknown, so its outcome is open.
    await screen.run(() => build.open());
    expect(posts).toEqual(["t2"]);
    expect(attemptKeys(s.store)).toEqual([KEY]);
    expect(s.events).toEqual([]);
    expect(s.toasts.filter((t) => t.includes("submitted"))).toHaveLength(1);
    expect(s.toasts.filter((t) => t.startsWith("error"))).toEqual([]);
    expect(screen.ui.amount.value).toBe("10");
    expect(screen.ui.confirm.disabled).toBe(true);
    expect(screen.ui.confirm.error).toContain("submitted");
    // No fresh attempt on new coins, even past the disabled button.
    await screen.run(() => void screen.ui.confirm.onClick());
    expect(calls).toHaveLength(1);

    // The poll goes on after the submit: t2 lands, reported once.
    await screen.advance(2_000);
    expect(attemptKeys(s.store)).toEqual([KEY]);
    s.statuses.t2 = "accepted";
    await screen.advance(2_000);
    expect(
      s.toasts.filter((t) => t === "success Swapped successfully!"),
    ).toHaveLength(1);
    expect(s.events).toEqual(["kasseal_trade_completed success buy"]);
    expect(attemptKeys(s.store)).toEqual([]);
    await screen.close();
  });
});

test.describe("Kasseal graduation keeps the open attempt", () => {
  test("a curve attempt stays retryable after the token moves to its pool", async () => {
    const s = swapScreen({ kasseal: true });
    s.setSubmit(unansweredPost("a1"));
    const first = await s.open();
    await first.buy("10");
    await first.confirm();
    await first.close();

    s.setVenue("pool");
    const again = await s.open();
    expect(again.ui.amount.value).toBe("10");
    expect(again.ui.confirm.error).toBeUndefined();
    expect(again.ui.confirm.disabled).toBe(false);

    // Another amount, or the other side, is still refused.
    await again.run(() => again.ui.amount.onChange("20"));
    expect(again.ui.confirm.disabled).toBe(true);
    await again.run(() => again.ui.amount.onFlip());
    await again.run(() => again.ui.amount.onChange("10"));
    expect(again.ui.confirm.disabled).toBe(true);
    expect(again.ui.confirm.error).toContain("earlier buy of 10 KAS");
    await again.run(() => again.ui.amount.onFlip());
    await again.run(() => again.ui.amount.onChange("10"));

    // The retry rebuilds on the pool with the same attempt and coins.
    let seen: trade.KassealAttempt | undefined;
    let venue: string | undefined;
    s.setSubmit(async (q, a) => {
      seen = a;
      venue = q.venue;
      return "a1";
    });
    s.statuses.a1 = "accepted";
    await again.confirm();
    expect(venue).toBe("pool");
    expect(seen!.posted).toEqual(["a1"]);
    expect([...seen!.pinned!]).toEqual(["f1:0"]);
    expect(attemptKeys(s.store)).toEqual([]);
    await again.close();
  });
});

test.describe("Kasseal balance guard", () => {
  test("a buy whose max paid exceeds the KAS balance is refused", async () => {
    const s = swapScreen({ kasseal: true, kasBalance: 10 });
    const screen = await s.open();
    // 9.95 KAS in, 10.0495 KAS max paid: above the 10 KAS balance.
    await screen.buy("9.95");
    expect(screen.ui.confirm.error).toBe("Oh, you don't have enough funds");
    expect(screen.ui.confirm.disabled).toBe(true);
    // 9.9 KAS in, 9.999 KAS max paid: inside the balance.
    await screen.run(() => screen.ui.amount.onChange("9.9"));
    expect(screen.ui.confirm.error).toBeUndefined();
    expect(screen.ui.confirm.disabled).toBe(false);
    await screen.close();
  });

  test("a sell above the held amount is refused", async () => {
    const s = swapScreen({ kasseal: true, kasBalance: 0 });
    const screen = await s.open();
    // 50 SEAL held.
    await screen.sell("50.5");
    expect(screen.ui.confirm.error).toBe("Oh, you don't have enough funds");
    expect(screen.ui.confirm.disabled).toBe(true);
    await screen.run(() => screen.ui.amount.onChange("50"));
    expect(screen.ui.confirm.error).toBeUndefined();
    expect(screen.ui.confirm.disabled).toBe(false);
    await screen.close();
  });

  test("a Ledger wallet sees no Kasseal pair", async () => {
    const s = swapScreen({ kasseal: true, wallet: "ledger" });
    const screen = await s.open();
    for (const side of ["in", "out"] as const)
      expect(keys(screen.sheet(side).tokens)).not.toContain("kaspa:A");
    expect(s.tokenCalls.length).toBeGreaterThan(0);
    expect(s.tokenCalls.every((enabled) => !enabled)).toBe(true);
    expect(s.hookCalls).toEqual([]);
    await screen.close();
  });
});
