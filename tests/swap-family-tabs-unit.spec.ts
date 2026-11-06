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
/** An image import as the bundler emits it: its path under the repo, which must exist. */
const asset = (id: string) => {
  const rel = id.replace(/^@\//, "");
  if (!fs.existsSync(path.join(__dirname, "..", rel)))
    throw new Error(`missing asset ${id}`);
  return esm(`/${rel}`);
};
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
} = loadModule("components/screens/asset-selector/SwapFamilyTabs.tsx", {
  ...base,
  "@/assets/images/providers/braid-logo.svg": asset(
    "@/assets/images/providers/braid-logo.svg",
  ),
  "@/assets/images/providers/kron-logo.png": asset(
    "@/assets/images/providers/kron-logo.png",
  ),
}) as typeof import("@/components/screens/asset-selector/SwapFamilyTabs");

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

const DOM_GLOBALS = ["window", "document"];
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
  });
  const pair = { in: KAS.key, out: undefined as string | undefined };
  const Screen = () => {
    const [out, setOut] = React.useState(undefined);
    const [family, setFamily] = React.useState("all");
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
  // No act(): another spec in the run can resolve React's production build, where act throws.
  // Render, then poll the DOM until the commit lands.
  root.render(React.createElement(Screen));
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
  const selected = () =>
    buttons().find(
      (b) =>
        b.getAttribute("role") === "tab" &&
        b.getAttribute("aria-selected") === "true",
    )?.textContent;
  await expect.poll(selected).toBe("All");
  return {
    host,
    selected,
    pair,
    symbols,
    tabs: () =>
      buttons()
        .filter((b) => b.getAttribute("role") === "tab")
        .map((b) => b.textContent),
    tap: async (label: string) => {
      tab(label).click();
      await expect.poll(selected).toBe(label);
    },
    pick: async (symbol: string) => {
      buttons()
        .find((b) => b.querySelector("span")?.textContent === symbol)
        .click();
      const key = tokens.find((t) => t.symbol === symbol)!.key;
      await expect.poll(() => pair.out).toBe(key);
    },
    unmount: () => root.unmount(),
  };
}

test("Standard and KRON tabs split the Kaspa L1 rows; a switch keeps the pair valid", async () => {
  const s = await mountSheet([KAS, STANDARD, CURVE, IGRA]);
  expect(s.tabs()).toEqual(["All", "Standard", "KRON"]);

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
  s.unmount();
});

test("an empty family says so and keeps the tab back to the other", async () => {
  const s = await mountSheet([KAS, CURVE]);
  expect(s.tabs()).toEqual(["All", "Standard", "KRON"]);
  // All never says empty: a KRON-only holder sees the KRON row on open.
  expect(s.host.textContent).not.toContain("tokens to trade");
  expect(s.symbols()).toEqual(["KAS", "KRON"]);
  await s.tap("Standard");
  expect(s.host.textContent).toContain("No Standard tokens to trade");
  expect(s.symbols()).toEqual(["KAS"]);
  await s.tap("KRON");
  expect(s.host.textContent).not.toContain("tokens to trade");
  expect(s.symbols()).toEqual(["KAS", "KRON"]);
  s.unmount();
});

test("the sheet opens on All; KRON and Standard filter; the pair never moves", async () => {
  const s = await mountSheet([KAS, STANDARD, CURVE, IGRA]);
  expect(s.selected()).toBe("All");
  expect(s.symbols().sort()).toEqual(["KAS", "KING", "KRON"]);
  await s.pick("KING");
  const pair = [KAS.key, STANDARD.key];
  expect([s.pair.in, s.pair.out]).toEqual(pair);

  await s.tap("KRON");
  expect(s.symbols().sort()).toEqual(["KAS", "KRON"]);
  expect([s.pair.in, s.pair.out]).toEqual(pair);

  await s.tap("Standard");
  expect(s.symbols().sort()).toEqual(["KAS", "KING"]);
  expect([s.pair.in, s.pair.out]).toEqual(pair);

  await s.tap("All");
  expect(s.symbols().sort()).toEqual(["KAS", "KING", "KRON"]);
  expect([s.pair.in, s.pair.out]).toEqual(pair);
  s.unmount();
});

test("off Kaspa L1 the tabs filter nothing", () => {
  expect(inFamily(STANDARD, "all")).toBe(true);
  expect(hasFamilyRow([KAS], "all")).toBe(true);
  expect(inFamily(IGRA, "kron-legacy")).toBe(true);
  expect(inFamily(KAS, "kcc20-standard")).toBe(true);
  expect(inFamily(STANDARD, "kron-legacy")).toBe(false);
});

test("the Standard and KRON tabs carry their provider's mark, All none", async () => {
  const s = await mountSheet([KAS, STANDARD, CURVE]);
  const tabImages = (): Record<string, { src: string; alt: string }[]> =>
    Object.fromEntries(
      Array.from(s.host.querySelectorAll('[role="tab"]')).map((b: any) => [
        b.textContent,
        Array.from(b.querySelectorAll("img")).map((i: any) => ({
          src: i.getAttribute("src"),
          alt: i.getAttribute("alt"),
        })),
      ]),
    );
  expect(tabImages()).toEqual({
    All: [],
    // Decorative: the label beside it names the tab.
    Standard: [{ src: "/assets/images/providers/braid-logo.svg", alt: "" }],
    KRON: [{ src: "/assets/images/providers/kron-logo.png", alt: "" }],
  });
  for (const [img] of Object.values(tabImages()).filter((v) => v.length))
    expect(fs.existsSync(path.join(__dirname, "..", img.src.slice(1)))).toBe(
      true,
    );
  s.unmount();
});

test("a long list mounts only the rows in view, and the full list scrolls", async () => {
  const many: Row[] = [
    KAS,
    ...Array.from({ length: 180 }, (_, i) => ({
      key: `kaspa:${i.toString(16).padStart(64, "0")}`,
      chain: "kaspa",
      symbol: `STD${i}`,
      address: i.toString(16).padStart(64, "0"),
      family: "kcc20-standard" as const,
    })),
  ];
  const s = await mountSheet(many);
  const rowCount = s.symbols().length;
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThan(many.length);
  // The rows not mounted are padding: the list keeps the full list's height.
  const list = s.host.querySelector("button:not([role])")!
    .parentElement as unknown as HTMLElement;
  expect(parseFloat(list.style.paddingBottom)).toBeGreaterThan(0);
  // A filter to fewer rows than the window mounts them all.
  await s.tap("KRON");
  expect(s.symbols()).toEqual(["KAS"]);
  s.unmount();
});
