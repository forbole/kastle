import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";
import { KASSEAL_LABELS } from "@/ui/popup/kasseal/labels";
import * as trade from "@/lib/kasseal/trade";
import * as errorCopy from "@/lib/kasseal/errorCopy";
import * as format from "@/components/kasseal/format";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const { createRoot } = nodeRequire("react-dom/client");
const { act } = React;

/** Transpiles real component source and evaluates it with `stubs` as its imports. */
function loadModule(file: string, stubs: Record<string, unknown>) {
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
  new Function("require", "module", "exports", outputText)(
    (id: string) => stubs[id] ?? {},
    module,
    module.exports,
  );
  return module.exports;
}

const baseStubs = {
  react: React,
  "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
  "./labels": { KASSEAL_LABELS },
  "lucide-react": { Rocket: () => null },
  "tailwind-merge": {
    twMerge: (...c: unknown[]) => c.filter(Boolean).join(" "),
  },
};

const QuoteSummary = loadModule(
  "ui/popup/kasseal/QuoteSummary.tsx",
  baseStubs,
).default;
const LaunchpadAction = loadModule(
  "ui/popup/kasseal/LaunchpadAction.tsx",
  baseStubs,
).default;

test.describe("Kasseal QuoteSummary bound label", () => {
  const row = (side: "buy" | "sell", boundKind: string) =>
    renderToStaticMarkup(
      React.createElement(QuoteSummary, {
        side,
        boundKind,
        pay: "100 KAS",
        receive: "1,000 SEAL",
        bound: "990 SEAL",
        fee: "1 KAS",
        slippage: "1%",
      }),
    );

  test("a pool buy's bound is a minimum received, not a max paid", () => {
    const html = row("buy", "min-received");
    expect(html).toContain(KASSEAL_LABELS.minReceived);
    expect(html).not.toContain(KASSEAL_LABELS.maxPaid);
  });

  test("a curve buy's bound is a max paid", () => {
    const html = row("buy", "max-paid");
    expect(html).toContain(KASSEAL_LABELS.maxPaid);
    expect(html).not.toContain(KASSEAL_LABELS.minReceived);
  });
});

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

async function mountAction(disabled: boolean) {
  const win = new Window();
  installDom(win);
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const opened: true[] = [];
  const hints: boolean[] = [];
  const root = createRoot(container);
  await act(async () =>
    root.render(
      React.createElement(LaunchpadAction, {
        disabled,
        onOpen: () => opened.push(true),
        onHintChange: (shown: boolean) => hints.push(shown),
        tooltipId: "kasseal",
      }),
    ),
  );
  const button = container.querySelector("button") as any;
  return {
    button,
    opened,
    hints,
    unmount: () => act(() => root.unmount()),
  };
}

test.describe("Kasseal dashboard Launchpad action", () => {
  test("is a focusable button, not a clickable div", () => {
    const html = renderToStaticMarkup(
      React.createElement(LaunchpadAction, {
        disabled: false,
        onOpen: () => {},
        onHintChange: () => {},
        tooltipId: "kasseal",
      }),
    );
    expect(html).toMatch(/^<button type="button"[^>]*aria-disabled="false"/);
    expect(html).toContain(KASSEAL_LABELS.dashboardAction);
  });

  test("opens on activation", async () => {
    const a = await mountAction(false);
    await act(async () => a.button.click());
    expect(a.opened.length).toBe(1);
    await a.unmount();
  });

  test("Ledger: aria-disabled, inert, and explains itself on focus", async () => {
    const a = await mountAction(true);
    expect(a.button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => a.button.click());
    expect(a.opened.length).toBe(0);
    await act(async () => a.button.focus());
    await act(async () => a.button.blur());
    expect(a.hints).toEqual([true, false]);
    await a.unmount();
  });
});

const SettingsContext = {
  NetworkType: { Mainnet: "mainnet", TestnetT10: "testnet-10" },
  KASSEAL_API_URLS: { mainnet: "https://k" },
};

test.describe("Kasseal token response", () => {
  const api = loadModule("lib/kasseal/api.ts", {
    "@/contexts/SettingsContext.tsx": SettingsContext,
  });
  const respond = (covenantId: string) =>
    (async () =>
      new Response(
        JSON.stringify({ meta: { covenantId, ticker: "B" }, supply: {} }),
        { status: 200 },
      )) as unknown as typeof fetch;

  test("a response for another covenant is rejected", async () => {
    let err: unknown;
    await api
      .fetchKassealToken("https://k", "A", respond("B"))
      .catch((e: unknown) => {
        err = e;
      });
    expect(String(err)).toContain("token response is for B, not A");
  });

  test("a response for the requested covenant is returned", async () => {
    const token = await api.fetchKassealToken("https://k", "A", respond("A"));
    expect(token.covenantId).toBe("A");
  });
});

/** Default-export stubs need the ES-module flag the transpiled imports check. */
const esm = (stubs: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(stubs).map(([id, m]) => [
      id,
      m && "default" in m ? { __esModule: true, ...m } : m,
    ]),
  );

/**
 * The real trade screen over an in-memory extension storage: a closed popup
 * is an unmount, reopening it a fresh mount over the same storage.
 */
function tradeScreen() {
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
  const analytics: string[] = [];
  let panel: any;
  let submitImpl: (
    deps: trade.KassealSubmissionDeps,
    attempt: trade.KassealAttempt,
  ) => Promise<string> = async () => "x";
  const token = { covenantId: "A", ticker: "SEAL", decimals: 8 };
  const Screen = loadModule(
    "components/kasseal/KassealTrade.tsx",
    esm({
      ...baseStubs,
      "react-router-dom": {
        useNavigate: () => () => {},
        useParams: () => ({ covenantId: "A" }),
      },
      swr: { default: (key: unknown) => ({ data: key ? "ab" : undefined }) },
      viem: nodeRequire("viem"),
      "@kassealhq/sdk": {
        errorCode: (e: any) => e?.code,
        finalize: (b: unknown) => b,
      },
      "@/ui/general/PageHeader": { default: () => null },
      "@/ui/general/Button": {
        default: (p: any) =>
          React.createElement(
            "button",
            { onClick: p.onClick, disabled: p.disabled },
            p.children,
          ),
      },
      "@/ui/popup/kasseal/TradePanel": {
        default: (p: any) => {
          panel = p;
          return null;
        },
      },
      "@/ui/popup/kasseal/QuoteSummary": { default: () => null },
      "@/ui/popup/kasseal/labels": { KASSEAL_LABELS },
      "@/components/screens/Settings.tsx": { explorerTxLinks: {} },
      "@/contexts/SettingsContext.tsx": SettingsContext,
      "@/hooks/useRpcClientStateful": {
        default: () => ({ networkId: "mainnet" }),
      },
      "@/hooks/wallet/useWalletManager": {
        default: () => ({ account: { address: "kaspa:me" } }),
      },
      "@/hooks/wallet/useKaspaHotWalletSigner": { default: () => ({}) },
      "@/hooks/useAnalytics": {
        default: () => ({
          emitKassealTradeCompleted: (e: any) =>
            analytics.push(`${e.status} ${e.side}`),
        }),
      },
      "@/lib/kasseal/api": {
        fetchTxStatus: async (_: string, txid: string) => ({
          kind: statuses[txid] ?? "unknown",
          txid,
        }),
        kassealBaseUrl: () => "https://k",
        kassealNetworkOf: (n: string) => n,
        postTx: async () => ({}),
      },
      "@/lib/kasseal/useKassealTokens": {
        useKassealToken: () => ({ data: token, mutate: async () => {} }),
      },
      "@/lib/kasseal/useKassealQuote": {
        kassealBuilder: () => ({}),
        useKassealMarket: () => ({
          data: { proof: { tokenId: "A", curveId: "C" } },
          refresh: async () => {},
        }),
        useKassealQuote: (
          side: string,
          _t: unknown,
          _m: unknown,
          amountIn?: bigint,
        ) =>
          amountIn
            ? {
                quote: {
                  side,
                  venue: "curve",
                  lots: 1n,
                  amountIn,
                  amountOut: 1n,
                  feeSompi: 0n,
                  bound: amountIn,
                },
              }
            : {},
      },
      "@/lib/kasseal/trade": {
        ...trade,
        submitKassealTrade: (
          d: trade.KassealSubmissionDeps,
          a: trade.KassealAttempt,
        ) => submitImpl(d, a),
      },
      "@/lib/kasseal/attempts": attempts,
      "@/lib/kasseal/sign": { signKassealTx: async () => [] },
      "@/lib/kasseal/errorCopy": errorCopy,
      "./format": format,
    }),
  ).default;

  const settle = () =>
    act(async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    });

  async function open() {
    const win = new Window();
    installDom(win);
    const container = win.document.createElement("div");
    win.document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(React.createElement(Screen)));
    await settle();
    const click = async (label: string) => {
      const b = [...container.querySelectorAll("button")].find(
        (x: any) => x.textContent === label,
      ) as any;
      expect(b, label).toBeTruthy();
      await act(async () => b.click());
      await settle();
    };
    const panelDo = async (f: (p: any) => void) => {
      await act(async () => f(panel));
      await settle();
    };
    return {
      click,
      panelDo,
      panel: () => panel,
      text: () => container.textContent ?? "",
      close: () => act(() => root.unmount()),
    };
  }

  return {
    open,
    store,
    statuses,
    analytics,
    setSubmit: (f: typeof submitImpl) => {
      submitImpl = f;
    },
  };
}

/** A submission whose POST went out and then gave up without an answer. */
const unansweredPost =
  (txid: string) =>
  async (d: trade.KassealSubmissionDeps, a: trade.KassealAttempt) => {
    a.pinned ??= new Set(["f1:0"]);
    await d.persist!({ ...a, posted: [...a.posted, txid] });
    a.posted.push(txid);
    throw new trade.KassealTradeError("outcome-unknown", "gave up");
  };

test.describe("Kasseal trade screen open attempt", () => {
  test("a closed popup reopens on the open attempt and refuses another trade", async () => {
    const s = tradeScreen();
    s.setSubmit(unansweredPost("a1"));
    const first = await s.open();
    await first.panelDo((p) => p.onAmountChange("10"));
    await first.panelDo((p) => p.onReview());
    await first.click(KASSEAL_LABELS.confirm);
    expect(first.text()).toContain(KASSEAL_LABELS.tryAgain);
    expect(s.store.size).toBe(1);
    await first.close();

    const again = await s.open();
    expect(again.panel().side).toBe("buy");
    expect(again.panel().amount).toBe("10");
    expect(again.panel().canReview).toBe(true);
    await again.panelDo((p) => p.onAmountChange("20"));
    expect(again.panel().canReview).toBe(false);
    expect(again.panel().error).toContain("may still go through");

    // The retry gets the restored attempt: same coins, earlier txid first.
    let seen: trade.KassealAttempt | undefined;
    s.setSubmit(async (_d, a) => {
      seen = a;
      return "a1";
    });
    await again.panelDo((p) => p.onAmountChange("10"));
    await again.panelDo((p) => p.onReview());
    await again.click(KASSEAL_LABELS.confirm);
    expect(seen!.posted).toEqual(["a1"]);
    expect([...seen!.pinned!]).toEqual(["f1:0"]);
    expect(again.text()).toContain(KASSEAL_LABELS.done);
    // Landed: the attempt is cleared, so the next trade starts fresh.
    expect(
      Object.keys((s.store.get("local:kasseal_attempts") as object) ?? {}),
    ).toEqual([]);
    await again.close();
  });

  test("after Try again, a sell cannot inherit the open buy", async () => {
    const s = tradeScreen();
    s.setSubmit(unansweredPost("a1"));
    const screen = await s.open();
    await screen.panelDo((p) => p.onAmountChange("10"));
    await screen.panelDo((p) => p.onReview());
    await screen.click(KASSEAL_LABELS.confirm);
    await screen.click(KASSEAL_LABELS.tryAgain);

    await screen.panelDo((p) => p.onSideChange("sell"));
    expect(screen.panel().canReview).toBe(false);
    expect(screen.panel().error).toContain("earlier buy of 10 KAS");
    expect(s.analytics).toEqual(["failed buy"]);
    await screen.close();
  });

  test("an attempt that landed while the popup was closed is cleared on reopen", async () => {
    const s = tradeScreen();
    s.setSubmit(unansweredPost("a1"));
    const first = await s.open();
    await first.panelDo((p) => p.onAmountChange("10"));
    await first.panelDo((p) => p.onReview());
    await first.click(KASSEAL_LABELS.confirm);
    await first.close();

    s.statuses.a1 = "accepted";
    const again = await s.open();
    await again.panelDo((p) => p.onSideChange("sell"));
    await again.panelDo((p) => p.onAmountChange("5"));
    expect(again.panel().canReview).toBe(true);
    expect(again.panel().error).toBeUndefined();
    expect(
      Object.keys(s.store.get("local:kasseal_attempts") as object),
    ).toEqual([]);
    await again.close();
  });

  test("a failure before any POST leaves nothing locked", async () => {
    const s = tradeScreen();
    s.setSubmit(async () => {
      throw new trade.KassealTradeError("no-pool", "no pool");
    });
    const screen = await s.open();
    await screen.panelDo((p) => p.onAmountChange("10"));
    await screen.panelDo((p) => p.onReview());
    await screen.click(KASSEAL_LABELS.confirm);
    await screen.click(KASSEAL_LABELS.tryAgain);
    await screen.panelDo((p) => p.onSideChange("sell"));
    expect(screen.panel().canReview).toBe(true);
    expect(s.store.size).toBe(0);
    await screen.close();
  });
});
