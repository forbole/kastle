import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";
import type { Kcc20Family } from "@/lib/kcc20";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const React = nodeRequire("react");
const { createRoot } = nodeRequire("react-dom/client");
const { act } = React;

/** Transpiles a real source file and evaluates it with `stubs` as its imports. */
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
    (id: string) => {
      if (!(id in stubs)) throw new Error(`unexpected runtime import ${id}`);
      return stubs[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}

const base = {
  react: React,
  "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
  "tailwind-merge": nodeRequire("tailwind-merge"),
};
const Icon = () => null;
// A default import of a stub: esModuleInterop unwraps only an ES-module-shaped object.
const esm = (d: unknown) => ({ __esModule: true, default: d });
const { TokenSheet } = loadModule("components/swap-bridge/ui.tsx", {
  ...base,
  "react-router-dom": { useNavigate: () => () => {} },
  "lucide-react": {
    AlertCircle: Icon,
    ArrowRight: Icon,
    ArrowUpDown: Icon,
    Check: Icon,
    Search: Icon,
  },
  "@/assets/images/network-logos/kaspa.svg": esm(""),
  "@/components/Layer2AssetImage": esm(Icon),
  "@/components/Toast": esm({}),
  "@/hooks/useStorageState": esm((_key: string, init: unknown) => {
    const [v, set] = React.useState(init);
    return [v, (f: any) => Promise.resolve(set(f))];
  }),
  "@/lib/format-amount": { formatAmount: String },
  "/node_modules/flag-icons/css/flag-icons.min.css": {},
});
const {
  default: SwapFamilyTabs,
  hasFamilyRow,
  inFamily,
} = loadModule(
  "components/screens/asset-selector/SwapFamilyTabs.tsx",
  base,
) as typeof import("@/components/screens/asset-selector/SwapFamilyTabs");

type Row = {
  key: string;
  chain: string;
  symbol: string;
  address?: string;
  family?: Kcc20Family;
};
const STD_ID = "02".repeat(32);
const CURVE_ID = "7a".repeat(32);
const KAS: Row = { key: "kaspa:native", chain: "kaspa", symbol: "KAS" };
// The Braid listing's "ref" lineage row (e.g. KING) and a KRON curve row, as Swap.tsx builds them.
const STANDARD: Row = {
  key: `kaspa:${STD_ID}`,
  chain: "kaspa",
  symbol: "KING",
  address: STD_ID,
  family: "kcc20-standard",
};
const CURVE: Row = {
  key: `kaspa:${CURVE_ID}`,
  chain: "kaspa",
  symbol: "KRON",
  address: CURVE_ID,
  family: "kron-legacy",
};
const IGRA: Row = { key: "igra:native", chain: "igra", symbol: "iKAS" };

const DOM_GLOBALS = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
const saved = new Map<string, PropertyDescriptor | undefined>();
test.afterEach(() => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
  saved.clear();
});

/** The swap screen's out-side sheet, wired as Swap.tsx wires it: a pair, the tab state, the real sheet. */
async function mountSheet(tokens: Row[]) {
  const win = new Window();
  for (const k of DOM_GLOBALS)
    if (!saved.has(k))
      saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const pair = { in: KAS.key, out: undefined as string | undefined };
  const Screen = () => {
    const [out, setOut] = React.useState(undefined);
    const [family, setFamily] = React.useState("kcc20-standard");
    pair.out = out;
    const side = tokens.map((t) => ({ ...t, disabled: t.key === pair.in }));
    return React.createElement(TokenSheet, {
      open: true,
      onClose: () => {},
      chains: [{ key: "kaspa", label: "Kaspa" }],
      chain: "kaspa",
      onChain: () => {},
      tokens: side.filter((t) => inFamily(t, family)),
      tabs: React.createElement(SwapFamilyTabs, {
        value: family,
        onChange: setFamily,
        empty: !hasFamilyRow(side, family),
      }),
      onSelect: (t: Row) => setOut(t.key),
      recentKey: "local:test",
    });
  };
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Screen)));
  const buttons = () => [...host.querySelectorAll("button")] as any[];
  const symbols = () =>
    buttons()
      .filter((b) => b.getAttribute("role") !== "tab")
      .map((b) => b.querySelector("span")?.textContent)
      .filter(Boolean);
  const tab = (label: string) =>
    buttons().find(
      (b) => b.getAttribute("role") === "tab" && b.textContent === label,
    );
  return {
    host,
    pair,
    symbols,
    tabs: () =>
      buttons()
        .filter((b) => b.getAttribute("role") === "tab")
        .map((b) => b.textContent),
    tap: (label: string) => act(async () => tab(label).click()),
    pick: (symbol: string) =>
      act(async () =>
        buttons()
          .find((b) => b.querySelector("span")?.textContent === symbol)
          .click(),
      ),
    unmount: () => act(async () => root.unmount()),
  };
}

test("Standard and KRON tabs split the Kaspa L1 rows; a switch keeps the pair valid", async () => {
  const s = await mountSheet([KAS, STANDARD, CURVE, IGRA]);
  expect(s.tabs()).toEqual(["Standard", "KRON"]);

  await s.tap("Standard");
  expect(s.symbols()).toEqual(["KAS", "KING"]);
  await s.pick("KING");
  expect([s.pair.in, s.pair.out]).toEqual([KAS.key, STANDARD.key]);

  // A tab tap only filters: the picked pair survives it, both legs still rows.
  await s.tap("KRON");
  expect(s.symbols()).toEqual(["KAS", "KRON"]);
  expect([s.pair.in, s.pair.out]).toEqual([KAS.key, STANDARD.key]);
  await s.pick("KRON");
  expect([s.pair.in, s.pair.out]).toEqual([KAS.key, CURVE.key]);

  await s.tap("Standard");
  expect([s.pair.in, s.pair.out]).toEqual([KAS.key, CURVE.key]);
  expect(s.host.textContent).not.toContain("tokens to trade");
  await s.unmount();
});

test("an empty family says so and keeps the tab back to the other", async () => {
  const s = await mountSheet([KAS, CURVE]);
  expect(s.tabs()).toEqual(["Standard", "KRON"]);
  expect(s.host.textContent).toContain("No Standard tokens to trade");
  expect(s.symbols()).toEqual(["KAS"]);
  await s.tap("KRON");
  expect(s.host.textContent).not.toContain("tokens to trade");
  expect(s.symbols()).toEqual(["KAS", "KRON"]);
  await s.unmount();
});

test("off Kaspa L1 the tabs filter nothing", () => {
  expect(inFamily(IGRA, "kron-legacy")).toBe(true);
  expect(inFamily(KAS, "kcc20-standard")).toBe(true);
  expect(inFamily(STANDARD, "kron-legacy")).toBe(false);
});
