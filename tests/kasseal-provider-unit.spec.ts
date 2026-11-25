import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";
import { BRAID_PROVIDER } from "@/lib/braid/constants";
import { KASPAROCKET_PROVIDER } from "@/lib/kasparocket/config";
import type {
  L1Leg,
  L1Listings,
  L1Provider,
  L1ProviderId,
} from "@/hooks/swap/l1Providers";

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

// A default import of a stub: esModuleInterop unwraps only an ES-module-shaped object.
const esm = (d: unknown) => ({ __esModule: true, default: d });
/** An image import as the bundler emits it: its path under the repo, which must exist. */
const asset = (id: string) => {
  const rel = id.replace(/^@\//, "");
  if (!fs.existsSync(path.join(__dirname, "..", rel)))
    throw new Error(`missing asset ${id}`);
  return esm(`/${rel}`);
};

// The extension's own network enum, not kaspa-web3's.
const NetworkType = { Mainnet: "mainnet", TestnetT10: "testnet-10" };
const l1 = loadModule("hooks/swap/l1Providers.ts", {
  react: React,
  "@/contexts/SettingsContext": { NetworkType },
  "@/lib/braid/constants": { BRAID_PROVIDER },
  "@/lib/kasparocket/config": { KASPAROCKET_PROVIDER },
  "@/assets/images/providers/braid-logo.svg": asset(
    "@/assets/images/providers/braid-logo.svg",
  ),
  "@/assets/images/providers/kron-logo.png": asset(
    "@/assets/images/providers/kron-logo.png",
  ),
}) as typeof import("@/hooks/swap/l1Providers");
const {
  L1_PROVIDERS,
  KASSEAL_NETWORKS,
  isL1Enabled,
  kronListing,
  useL1Provider,
} = l1;

const Icon = () => null;
// The provider sheet's row, as Swap.tsx draws each L1 provider.
const { ProviderRow } = loadModule("components/swap-bridge/ui.tsx", {
  react: React,
  "react/jsx-runtime": nodeRequire("react/jsx-runtime"),
  "tailwind-merge": nodeRequire("tailwind-merge"),
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
  "@/components/dashboard/ClipboardCopy": esm(Icon),
  "@/hooks/useStorageState": esm(() => [[], async () => {}, false]),
  viem: { BaseError: class BaseError extends Error {} },
  "@/lib/format-amount": { formatAmount: String },
  "/node_modules/flag-icons/css/flag-icons.min.css": {},
});

const jsxRuntime = nodeRequire("react/jsx-runtime");
const feeSummary = loadModule("components/swap-bridge/swap-fee-summary.tsx", {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "@/lib/format-amount": { formatAmount: String },
});
// The screen's L1 sheet rows, over the real ProviderRow, FeeRow and registry helpers.
const { L1ProviderRows, L1FeeRows, L1WalletRows } = loadModule(
  "components/swap-bridge/l1Rows.tsx",
  {
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@/components/swap-bridge/swap-fee-summary": feeSummary,
    "@/components/swap-bridge/ui": { ProviderRow },
    "@/hooks/swap/l1Providers": { isL1Enabled: l1.isL1Enabled },
    "@/lib/format-amount": { formatAmount: String },
  },
) as typeof import("@/components/swap-bridge/l1Rows");

const MAIN = NetworkType.Mainnet;
const TESTNET = NetworkType.TestnetT10;

const CURVE_ID = "c".repeat(64);
const GRAD_ID = "d".repeat(64);
const UNLISTED_ID = "e".repeat(64);

const KAS: L1Leg = { type: "KAS" };
const CURVE: L1Leg = { type: "KCC20", covenantId: CURVE_ID };
const GRAD: L1Leg = { type: "KCC20", covenantId: GRAD_ID };
const UNLISTED: L1Leg = { type: "KCC20", covenantId: UNLISTED_ID };

// The screen's own "kronMarkets" download: curve tokens in the array, a
// graduated token only on `graduated`, as fetchKronMarkets returns them.
const KRON_MARKETS = Object.assign(
  [{ covenantId: CURVE_ID, curveCovenantId: "a".repeat(64), tick: "CURVE" }],
  { graduated: [{ covenantId: GRAD_ID }] },
) as unknown as Parameters<typeof kronListing>[0];
const KRON = kronListing(KRON_MARKETS);

const provider = (id: L1ProviderId) =>
  L1_PROVIDERS.find((p: L1Provider) => p.id === id)!;
const supporting = (
  a?: L1Leg,
  b?: L1Leg,
  networkId?: string,
  listings?: L1Listings,
) =>
  L1_PROVIDERS.filter((p: L1Provider) =>
    p.supports(a, b, networkId, listings),
  ).map((p: L1Provider) => p.id);

const DOM_GLOBALS = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
const saved = new Map<string, PropertyDescriptor | undefined>();

// The worker is shared with other specs: leave no fake DOM behind.
test.afterEach(() => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
  saved.clear();
});

type Props = { a?: L1Leg; b?: L1Leg; networkId?: string; l?: L1Listings };

/** Mounts useL1Provider in a happy-dom document; `id()` reads the provider it returns. */
async function mountProvider(props: Props) {
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
  let latest: [L1ProviderId, (id: L1ProviderId) => void] | undefined;
  const Probe = ({ a, b, networkId, l }: Props) => {
    latest = useL1Provider(a, b, networkId, l);
    return null;
  };
  const root = createRoot(win.document.createElement("div"));
  await act(async () => root.render(React.createElement(Probe, props)));
  return {
    id: () => latest![0],
    choose: (id: L1ProviderId) => act(async () => latest![1](id)),
    setPair: (next: Props) =>
      act(async () => root.render(React.createElement(Probe, next))),
    unmount: () => act(async () => root.unmount()),
  };
}

const KASSEAL = new Set([CURVE_ID]);
const BOTH = { kasseal: KASSEAL, kron: KRON };
// KaspaRocket off: the hook always returns a boolean, and `enabled` reads a
// missing flag as on (`?? true`), which would add its row to every sheet here.
const flagsWith = (isKassealEnabled: boolean) =>
  ({ isKassealEnabled, isKaspaRocketEnabled: false }) as unknown as Parameters<
    NonNullable<L1Provider["enabled"]>
  >[0];
const ON = flagsWith(true);
const OFF = flagsWith(false);

/** Renders `el` into a fresh happy-dom document. */
async function render(el: unknown) {
  const win = new Window();
  for (const k of DOM_GLOBALS)
    if (!saved.has(k))
      saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = win.document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(el));
  return { host, unmount: () => act(async () => root.unmount()) };
}

/** The provider sheet as Swap.tsx builds it: every registry row, its `supporting` filter. */
async function sheet(flags: unknown, listings: L1Listings, currentId: string) {
  const supporting = L1_PROVIDERS.filter(
    (p: L1Provider) =>
      isL1Enabled(p, flags as never) && p.supports(KAS, CURVE, MAIN, listings),
  );
  const { host, unmount } = await render(
    React.createElement(L1ProviderRows, {
      providers: L1_PROVIDERS,
      flags,
      supporting,
      currentId,
      onPick: () => {},
    }),
  );
  const rows = Array.from(host.querySelectorAll("button")).map((b: any) => {
    const spans = b.querySelectorAll("div > span");
    return {
      name: spans[0]?.textContent,
      subtitle: spans[1]?.textContent,
      disabled: b.disabled,
    };
  });
  await unmount();
  return rows;
}

test("a pair Kasseal and KRON both route: Kasseal is first and the default; a KRON pick sticks", async () => {
  expect(await sheet(ON, BOTH, "kasseal")).toEqual([
    { name: "Kasseal", subtitle: undefined, disabled: false },
    { name: "KRON", subtitle: undefined, disabled: false },
    { name: "Braid", subtitle: "Unsupported Pair", disabled: true },
  ]);

  const ui = await mountProvider({
    a: KAS,
    b: CURVE,
    networkId: MAIN,
    l: BOTH,
  });
  expect(ui.id()).toBe("kasseal");
  await ui.choose("kron");
  // An amount change re-renders the screen with the same pair: still KRON.
  await ui.setPair({ a: KAS, b: CURVE, networkId: MAIN, l: BOTH });
  expect(ui.id()).toBe("kron");
  // KRON stops routing it: Kasseal stands in; the KRON pick comes back with KRON.
  await ui.setPair({
    a: KAS,
    b: CURVE,
    networkId: MAIN,
    l: { kasseal: KASSEAL },
  });
  expect(ui.id()).toBe("kasseal");
  await ui.setPair({ a: KAS, b: CURVE, networkId: MAIN, l: BOTH });
  expect(ui.id()).toBe("kron");
  await ui.unmount();

  // The default leaves Kasseal only once Kasseal stops routing the pair.
  const fresh = await mountProvider({
    a: CURVE,
    b: KAS,
    networkId: MAIN,
    l: BOTH,
  });
  expect(fresh.id()).toBe("kasseal");
  await fresh.setPair({ a: CURVE, b: KAS, networkId: MAIN, l: { kron: KRON } });
  expect(fresh.id()).toBe("kron");
  await fresh.setPair({ a: CURVE, b: KAS, networkId: MAIN, l: BOTH });
  expect(fresh.id()).toBe("kasseal");
  await fresh.unmount();
});

test("the screen mounts on a non-L1 pair: a curve pair picked later still defaults to Kasseal", async () => {
  // Swap opens on Igra (no L1 leg): the fallback is KRON, and must not stick.
  const ui = await mountProvider({ networkId: MAIN, l: BOTH });
  expect(ui.id()).toBe("kron");
  await ui.setPair({ a: KAS, b: CURVE, networkId: MAIN, l: BOTH });
  expect(ui.id()).toBe("kasseal");
  await ui.unmount();
});

test("kasseal_enabled_extension off: no Kasseal row, and KRON stays the default", async () => {
  const kasseal = L1_PROVIDERS.find((p: L1Provider) => p.id === "kasseal")!;
  expect(isL1Enabled(kasseal, ON)).toBe(true);
  expect(isL1Enabled(kasseal, OFF)).toBe(false);
  // The screen asks for no Kasseal listing while the flag is off.
  const off = { kasseal: undefined, kron: KRON };
  expect((await sheet(OFF, off, "kron")).map((r) => r.name)).toEqual([
    "KRON",
    "Braid",
  ]);
  const ui = await mountProvider({ a: KAS, b: CURVE, networkId: MAIN, l: off });
  expect(ui.id()).toBe("kron");
  // A pair nothing routes falls back to KRON, never to the flagged Kasseal.
  await ui.setPair({ a: KAS, b: UNLISTED, networkId: MAIN, l: off });
  expect(ui.id()).toBe("kron");
  await ui.unmount();
});

test("Kasseal is offered on mainnet and testnet-10, never testnet-11", () => {
  expect(KASSEAL_NETWORKS).toEqual([MAIN, TESTNET]);
  const kasseal = L1_PROVIDERS.find((p: L1Provider) => p.id === "kasseal")!;
  const l = { kasseal: KASSEAL };
  expect(kasseal.supports(KAS, CURVE, MAIN, l)).toBe(true);
  expect(kasseal.supports(CURVE, KAS, TESTNET, l)).toBe(true);
  expect(kasseal.supports(KAS, CURVE, "testnet-11", l)).toBe(false);
  expect(kasseal.supports(KAS, CURVE, undefined, l)).toBe(false);
  // Only a listed token, only against KAS.
  expect(kasseal.supports(KAS, UNLISTED, MAIN, l)).toBe(false);
  expect(kasseal.supports(CURVE, CURVE, MAIN, l)).toBe(false);
});

/** The Est. Fee sheet's L1 body, as Swap.tsx draws it: label and value per row. */
async function feeSheet(h: {
  feeLines: unknown[];
  totalDebit?: unknown;
  creditLines?: unknown[];
}) {
  const { host, unmount } = await render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(L1FeeRows, { lines: h.feeLines }),
      React.createElement(L1WalletRows, {
        totalDebit: h.totalDebit,
        creditLines: h.creditLines,
      }),
      React.createElement(feeSummary.SwapFeeSummary, {
        kastleFee: 0,
        kastleFeeSymbol: "KAS",
        kastleFeeBps: 0,
      }),
    ),
  );
  const rows = Array.from(host.children).map((row: any) => {
    const [label, value] = row.querySelectorAll("div > span");
    return [label?.textContent, value?.textContent];
  });
  await unmount();
  return rows;
}

test("a quote's totalDebit is its own row and creditLines are signed lines; neither enters the fee sum", async () => {
  const line = (name: string, amount: number, display: string) => ({
    name,
    symbol: "KAS",
    amount,
    display,
    hint: "-",
  });
  // kassealFeeLines' shape: network, then Kasseal's trading fee; no Kastle cut.
  const feeLines = [
    line("Network", 0.02, "0.02 KAS"),
    line("Kasseal", 0.1, "0.1 KAS"),
  ];
  const fees = [
    ["Network fees", "0.02 KAS"],
    ["Kasseal fees", "0.1 KAS"],
  ];
  const kastle = ["Kastle fees", "-"];

  expect(await feeSheet({ feeLines })).toEqual([...fees, kastle]);
  // A curve buy: what leaves the wallet, apart from the fees.
  expect(
    await feeSheet({ feeLines, totalDebit: { amount: 10.12, symbol: "KAS" } }),
  ).toEqual([...fees, ["Total debit", "-10.12 KAS"], kastle]);
  // A curve sell: signed credits, apart from the fees.
  expect(
    await feeSheet({
      feeLines,
      creditLines: [
        line("You receive", 4.9, "+4.9 KAS"),
        line("Token cell", -0.2, "-0.2 KAS"),
      ],
    }),
  ).toEqual([
    ...fees,
    ["You receive", "+4.9 KAS"],
    ["Token cell", "-0.2 KAS"],
    kastle,
  ]);
});

test("the confirm label while pending is the provider's own copy, not Braid's", () => {
  const BRAID = "BRAID_COPY";
  const types = loadModule("hooks/swap/l1Types.ts", {
    "@/lib/braid/constants": { BRAID_PENDING_COPY: BRAID },
  }) as typeof import("@/hooks/swap/l1Types");
  const KASSEAL_COPY = "A Kasseal swap for this pair is still settling.";
  expect(types.l1PendingCopy({ pendingCopy: KASSEAL_COPY })).toBe(KASSEAL_COPY);
  expect(types.l1PendingCopy({})).toBe(BRAID);
  // The screen reads it for whichever provider is current, never Braid's constant.
  const screen = fs.readFileSync(
    path.join(__dirname, "..", "components/screens/Swap.tsx"),
    "utf8",
  );
  expect(screen).toMatch(
    /label=\{l1\?\.pending \? l1PendingCopy\(l1\) : undefined\}/,
  );
  expect(screen).not.toContain("BRAID_PENDING_COPY");
});

test("flag on but Kasseal's listing unknown: its row is greyed Unsupported Pair, never the default", async () => {
  const unknown = { kasseal: undefined, kron: KRON };
  expect(await sheet(ON, unknown, "kron")).toEqual([
    { name: "Kasseal", subtitle: "Unsupported Pair", disabled: true },
    { name: "KRON", subtitle: undefined, disabled: false },
    { name: "Braid", subtitle: "Unsupported Pair", disabled: true },
  ]);
  const ui = await mountProvider({
    a: KAS,
    b: CURVE,
    networkId: MAIN,
    l: unknown,
  });
  expect(ui.id()).toBe("kron");
  // Its listing lands: Kasseal takes the default.
  await ui.setPair({ a: KAS, b: CURVE, networkId: MAIN, l: BOTH });
  expect(ui.id()).toBe("kasseal");
  await ui.unmount();
});
