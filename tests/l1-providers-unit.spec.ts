import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";
import { BRAID_PROVIDER } from "@/lib/braid/constants";
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

// The extension's own network enum, not kaspa-web3's.
const NetworkType = { Mainnet: "mainnet", TestnetT10: "testnet-10" };
const { L1_PROVIDERS, hasL1Route, kronListing, useL1Provider } = loadModule(
  "hooks/swap/l1Providers.ts",
  {
    react: React,
    "@/contexts/SettingsContext": { NetworkType },
    "@/lib/braid/constants": { BRAID_PROVIDER },
  },
) as typeof import("@/hooks/swap/l1Providers");

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

test("KRON is listed first, then Braid", () => {
  expect(L1_PROVIDERS.map((p: L1Provider) => [p.id, p.name])).toEqual([
    ["kron", "KRON"],
    ["braid", "Braid"],
  ]);
});

test("KRON's listing is the screen's curve markets: a graduated token is absent", () => {
  expect([...KRON!]).toEqual([CURVE_ID]);
  expect(KRON!.has(GRAD_ID)).toBe(false);
  // No download yet: KRON's listing is unknown, not empty.
  expect(kronListing(undefined)).toBeUndefined();
});

test("a curve token: KRON routes it, Braid only once Braid lists it", async () => {
  const kronOnly = { kron: KRON };
  expect(provider("kron").supports(KAS, CURVE, MAIN, kronOnly)).toBe(true);
  expect(provider("kron").supports(CURVE, KAS, MAIN, kronOnly)).toBe(true);
  expect(provider("braid").supports(KAS, CURVE, MAIN, kronOnly)).toBe(false);
  expect(supporting(KAS, CURVE, MAIN, kronOnly)).toEqual(["kron"]);

  const both = { kron: KRON, braid: new Set([CURVE_ID]) };
  expect(supporting(KAS, CURVE, MAIN, both)).toEqual(["kron", "braid"]);

  // KRON is the default for a pair both providers route.
  const ui = await mountProvider({
    a: KAS,
    b: CURVE,
    networkId: MAIN,
    l: both,
  });
  expect(ui.id()).toBe("kron");
  await ui.setPair({ a: CURVE, b: KAS, networkId: MAIN, l: kronOnly });
  expect(ui.id()).toBe("kron");
  await ui.unmount();
});

test("a graduated token: KRON refuses it, Braid routes it", async () => {
  const listings = { kron: KRON, braid: new Set([GRAD_ID]) };
  expect(provider("kron").supports(KAS, GRAD, MAIN, listings)).toBe(false);
  expect(provider("braid").supports(KAS, GRAD, MAIN, listings)).toBe(true);
  expect(provider("braid").supports(GRAD, KAS, MAIN, listings)).toBe(true);
  expect(supporting(KAS, GRAD, MAIN, listings)).toEqual(["braid"]);
  expect(hasL1Route(GRAD, KAS, MAIN, listings)).toBe(true);

  const ui = await mountProvider({
    a: KAS,
    b: GRAD,
    networkId: MAIN,
    l: listings,
  });
  expect(ui.id()).toBe("braid");
  await ui.setPair({ a: GRAD, b: KAS, networkId: MAIN, l: listings });
  expect(ui.id()).toBe("braid");
  // Back to a curve token Braid does not list: KRON again.
  await ui.setPair({ a: KAS, b: CURVE, networkId: MAIN, l: listings });
  expect(ui.id()).toBe("kron");
  await ui.unmount();
});

test("a pair no provider supports falls back to KRON without throwing", async () => {
  const listings = { kron: KRON, braid: new Set([GRAD_ID]) };
  const pairs: [L1Leg | undefined, L1Leg | undefined][] = [
    [KAS, UNLISTED],
    [UNLISTED, KAS],
    [KAS, KAS],
    [CURVE, GRAD],
    [KAS, undefined],
    // An EVM leg is no L1 leg at all.
    [undefined, GRAD],
  ];
  for (const [a, b] of pairs) {
    expect(hasL1Route(a, b, MAIN, listings)).toBe(false);
    expect(supporting(a, b, MAIN, listings)).toEqual([]);
  }
  // Listings still unknown: nothing is offered either.
  expect(hasL1Route(KAS, CURVE, MAIN, undefined)).toBe(false);
  expect(hasL1Route(KAS, GRAD, MAIN, {})).toBe(false);

  const ui = await mountProvider({
    a: KAS,
    b: UNLISTED,
    networkId: MAIN,
    l: listings,
  });
  expect(ui.id()).toBe("kron");
  await ui.setPair({ a: undefined, b: undefined, networkId: MAIN });
  expect(ui.id()).toBe("kron");
  await ui.unmount();
});

test("off mainnet Braid is not offered, even for a token it lists", async () => {
  const listings = {
    kron: KRON,
    braid: new Set([CURVE_ID, GRAD_ID]),
  };
  for (const net of [TESTNET, undefined]) {
    expect(provider("braid").supports(KAS, GRAD, net, listings)).toBe(false);
    expect(provider("braid").supports(KAS, CURVE, net, listings)).toBe(false);
    expect(supporting(KAS, CURVE, net, listings)).toEqual(["kron"]);
    expect(hasL1Route(KAS, GRAD, net, listings)).toBe(false);
  }

  const ui = await mountProvider({
    a: KAS,
    b: GRAD,
    networkId: TESTNET,
    l: listings,
  });
  expect(ui.id()).toBe("kron");
  await ui.setPair({ a: KAS, b: GRAD, networkId: MAIN, l: listings });
  expect(ui.id()).toBe("braid");
  await ui.unmount();
});

test("a Braid choice holds while Braid routes the pair, and returns once it does again", async () => {
  const both = { kron: KRON, braid: new Set([CURVE_ID]) };
  const ui = await mountProvider({
    a: KAS,
    b: CURVE,
    networkId: MAIN,
    l: both,
  });
  expect(ui.id()).toBe("kron");
  await ui.choose("braid");
  expect(ui.id()).toBe("braid");
  // Braid stops listing it: KRON stands in, the choice is not forgotten.
  await ui.setPair({ a: KAS, b: CURVE, networkId: MAIN, l: { kron: KRON } });
  expect(ui.id()).toBe("kron");
  await ui.setPair({ a: CURVE, b: KAS, networkId: MAIN, l: both });
  expect(ui.id()).toBe("braid");
  await ui.unmount();
});
