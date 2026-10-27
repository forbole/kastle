import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";
import { KASSEAL_LABELS } from "@/ui/popup/kasseal/labels";

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
