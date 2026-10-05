import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const React = nodeRequire("react");
const { renderToStaticMarkup } = nodeRequire("react-dom/server");
const { createRoot } = nodeRequire("react-dom/client");
const { act } = React;

/** Transpiles a real component source and evaluates it with `stubs` as its imports. */
function loadModule(file: string, stubs: Record<string, unknown>) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
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

/** Real HoverTooltip; react-tooltip needs layout, so its Tooltip just exposes `isOpen`. */
const tooltipStubs = {
  react: React,
  "react-tooltip": {
    Tooltip: ({ isOpen }: any) =>
      React.createElement("span", { "data-tooltip-open": String(isOpen) }),
  },
};

/** Loads the real BottomNav (and the real HoverTooltip) with app imports stubbed. */
function loadNav(walletType: string, navigate: (p: string) => void) {
  const HoverTooltip = loadModule("components/HoverTooltip.tsx", tooltipStubs);
  const icon = () => null;
  const stubs: Record<string, unknown> = {
    react: React,
    "react-router-dom": {
      useLocation: () => ({ pathname: "/dashboard" }),
      useNavigate: () => navigate,
    },
    "lucide-react": { ArrowRightLeft: icon, History: icon },
    "tailwind-merge": {
      twMerge: (...c: unknown[]) => c.filter(Boolean).join(" "),
    },
    "@/assets/images/home.svg": "",
    "@/assets/images/home-filled.svg": "",
    "@/hooks/useFeatureFlags": {
      useFeatureFlags: () => ({
        isSwapEnabled: true,
        isBridgeEnabled: true,
        isActivityEnabled: true,
      }),
    },
    "@/hooks/wallet/useWalletManager": {
      __esModule: true,
      default: () => ({ wallet: { type: walletType } }),
    },
    "@/components/HoverTooltip": HoverTooltip,
  };
  const mod = loadModule("components/BottomNav.tsx", stubs);
  return mod.default ?? mod.BottomNav;
}

function renderNav(walletType: string, navigate: (p: string) => void) {
  const Nav = loadNav(walletType, navigate);
  return renderToStaticMarkup(React.createElement(Nav));
}

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

/** Mounts into a real (happy-dom) document so React's event handlers are live. */
async function mountNav(walletType: string, navigate: (p: string) => void) {
  const win = new Window();
  installDom(win);
  const container = win.document.createElement("div");
  win.document.body.appendChild(container);
  const Nav = loadNav(walletType, navigate);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Nav)));
  const button = (label: string) =>
    container.querySelector(
      `button[aria-label="${label}"], button[aria-label^="${label}. "]`,
    ) as any;
  const tipOpen = (label: string) =>
    button(label)
      .closest("[data-tooltip-id]")
      .parentElement.querySelector("[data-tooltip-open]")?.dataset.tooltipOpen;
  return {
    button,
    tipOpen,
    act,
    win,
    unmount: () => act(() => root.unmount()),
  };
}

test("ledger wallet: Swap and Bridge are aria-disabled with tooltip", () => {
  const html = renderNav("ledger", () => {});
  for (const label of ["Swap", "Bridge"]) {
    const tip = `Ledger doesn&#x27;t support ${label} function currently.`;
    expect(html).toContain(`data-tooltip-content="${tip}"`);
    const btn = html.match(
      new RegExp(`<button[^>]*aria-label="${label}\\. [^"]*"[^>]*>`),
    );
    expect(btn?.[0]).toContain('aria-disabled="true"');
    expect(btn?.[0]).toContain("opacity-20");
  }
  const home = html.match(/<button[^>]*aria-label="Home"[^>]*>/);
  expect(home?.[0]).not.toContain("aria-disabled");
});

test("non-ledger wallet: no gating", () => {
  const html = renderNav("mnemonic", () => {});
  expect(html).not.toContain("aria-disabled");
  expect(html).not.toContain("data-tooltip-content");
});

test("click guard: ledger clicks never navigate; non-ledger clicks do", async () => {
  const calls: string[] = [];
  const ledger = await mountNav("ledger", (p) => calls.push(p));
  for (const label of ["Swap", "Bridge"]) {
    await ledger.act(async () => ledger.button(label).click());
  }
  expect(calls).toEqual([]);
  await ledger.act(async () => ledger.button("Home").click());
  expect(calls).toEqual(["/dashboard"]); // spy is live: ungated tab still navigates
  await ledger.unmount();

  calls.length = 0;
  const hot = await mountNav("mnemonic", (p) => calls.push(p));
  for (const label of ["Swap", "Bridge"]) {
    await hot.act(async () => hot.button(label).click());
  }
  expect(calls).toEqual(["/swap", "/bridge"]);
  await hot.unmount();
});

test("focus-open: focusing a gated tab opens its tooltip, blur closes it", async () => {
  const nav = await mountNav("ledger", () => {});
  for (const label of ["Swap", "Bridge"]) {
    expect(nav.tipOpen(label)).toBe("false");
    await nav.act(async () => nav.button(label).focus());
    expect(nav.tipOpen(label)).toBe("true");
    await nav.act(async () => nav.button(label).blur());
    expect(nav.tipOpen(label)).toBe("false");
  }
  await nav.unmount();
});

test("HoverTooltip: openOnFocus is opt-in", async () => {
  const win = new Window();
  installDom(win);
  const HoverTooltip = loadModule(
    "components/HoverTooltip.tsx",
    tooltipStubs,
  ).default;
  for (const openOnFocus of [true, false]) {
    const el = win.document.createElement("div");
    win.document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () =>
      root.render(
        React.createElement(
          HoverTooltip,
          { text: "t", openOnFocus },
          React.createElement("button", null, "b"),
        ),
      ),
    );
    await act(async () => (el.querySelector("button") as any).focus());
    expect(
      (el.querySelector("[data-tooltip-open]") as any).dataset.tooltipOpen,
    ).toBe(String(openOnFocus));
    await act(() => root.unmount());
  }
});
