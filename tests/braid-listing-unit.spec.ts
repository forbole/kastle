import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { test, expect } from "@playwright/test";
import { Window } from "happy-dom";
import type { L1Token } from "@braid_swap/sdk";

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

const DOM_GLOBALS = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"];
const saved = new Map<string, PropertyDescriptor | undefined>();

function installDom() {
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
  return win;
}

// The worker is shared with other specs: leave no fake DOM behind.
test.afterEach(() => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
  saved.clear();
});

// SWR reads `window` when first loaded: load it under a document.
installDom();
const swr = nodeRequire("swr");

/** The Braid SDK, stubbed: `tokens()` answers whatever `answer` holds. */
const braid = {
  calls: 0,
  answer: [] as L1Token[],
  async tokens() {
    braid.calls++;
    return braid.answer;
  },
};

const NetworkType = { Mainnet: "mainnet", TestnetT10: "testnet-10" };
const {
  BRAID_TOKENS_TTL_MS,
  LINEAGE_FAMILY,
  braidRows,
  loadBraidTokens,
  useBraidListing,
  useBraidRoutable,
  useBraidTokens,
} = loadModule("hooks/swap/braidListing.ts", {
  react: React,
  swr,
  "@/contexts/SettingsContext": { NetworkType },
  "@/lib/braid/client": { makeBraid: () => braid },
}) as typeof import("@/hooks/swap/braidListing");

const token = (t: Partial<L1Token>): L1Token => ({
  symbol: "TKN",
  name: null,
  id: null,
  lineage: null,
  kind: 1,
  decimals: 8,
  venue: null,
  phase: null,
  builtin: false,
  ...t,
});

const KRON_ID = "a".repeat(64);
const REF_ID = "b".repeat(64);
const ROCKET_ID = "c".repeat(64);
const PINNED_ID = "d".repeat(64);

// A live answer: a pinned KAS row, a pinned KRON pool with no decimals, and
// listed pools across KRON, the standard lineage and KaspaRocket.
const LIVE: L1Token[] = [
  token({ symbol: "KAS", kind: 0, builtin: true }),
  token({
    symbol: "PIN",
    id: PINNED_ID,
    lineage: "kron",
    decimals: null,
    builtin: true,
  }),
  token({ symbol: "GRAD", name: "Graduate", id: KRON_ID, lineage: "kron" }),
  token({ symbol: "REF", name: "Standard", id: REF_ID, lineage: "ref" }),
  token({ symbol: "RKT", name: "Rocket", id: ROCKET_ID, lineage: "kr" }),
];

test("a Braid lineage maps to the wallet family that spends it", () => {
  expect(LINEAGE_FAMILY).toEqual({
    kron: "kron-legacy",
    ref: "kcc20-standard",
  });
  const rows = braidRows(LIVE);
  expect(rows.find((r) => r.covenantId === KRON_ID)?.family).toBe(
    "kron-legacy",
  );
  expect(rows.find((r) => r.covenantId === REF_ID)?.family).toBe(
    "kcc20-standard",
  );
});

test("KaspaRocket and id-less rows are not tokens this wallet holds", () => {
  const rows = braidRows(LIVE);
  expect(rows.map((r) => r.covenantId)).toEqual([PINNED_ID, KRON_ID, REF_ID]);
  expect(rows.some((r) => r.covenantId === ROCKET_ID)).toBe(false);
  // A lineage the map does not know is left out too, never guessed.
  expect(braidRows([token({ id: ROCKET_ID, lineage: "q4" })])).toEqual([]);
});

test("decimals: null is kept as null, not guessed", () => {
  const pinned = braidRows(LIVE).find((r) => r.covenantId === PINNED_ID)!;
  expect(pinned.decimals).toBeNull();
  // No name from Braid: the symbol stands in.
  expect(pinned.name).toBe("PIN");
  expect(braidRows(LIVE).find((r) => r.covenantId === KRON_ID)).toEqual({
    covenantId: KRON_ID,
    family: "kron-legacy",
    name: "Graduate",
    symbol: "GRAD",
    decimals: 8,
  });
});

test("a pinned-only answer is a failed load", async () => {
  const pinnedOnly = LIVE.filter((t) => t.builtin);
  await expect(
    loadBraidTokens({ tokens: async () => pinnedOnly }),
  ).rejects.toThrow("Braid answered only its pinned tokens");
  await expect(loadBraidTokens({ tokens: async () => [] })).rejects.toThrow();
  await expect(loadBraidTokens({ tokens: async () => LIVE })).resolves.toBe(
    LIVE,
  );
});

test("the list refreshes once a minute, the SDK's own cache life", () => {
  expect(BRAID_TOKENS_TTL_MS).toBe(60_000);
});

/** Renders `use` under a fresh SWR cache; `value()` reads its latest return. */
async function mount<T>(use: () => T) {
  const win = installDom();
  let latest: T | undefined;
  const Probe = () => {
    latest = use();
    return null;
  };
  const root = createRoot(win.document.createElement("div"));
  await act(async () =>
    root.render(
      React.createElement(
        swr.SWRConfig,
        { value: { provider: () => new Map(), dedupingInterval: 0 } },
        React.createElement(Probe),
      ),
    ),
  );
  // Let the fetch settle.
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  return {
    value: () => latest,
    unmount: () => act(async () => root.unmount()),
  };
}

test("on mainnet the listing loads; off mainnet Braid is never asked", async () => {
  braid.answer = LIVE;
  braid.calls = 0;
  const off = await mount(() => useBraidListing(NetworkType.TestnetT10));
  expect(off.value()).toBeUndefined();
  expect(braid.calls).toBe(0);
  await off.unmount();

  const on = await mount(() => ({
    listing: useBraidListing(NetworkType.Mainnet),
    routable: useBraidRoutable(NetworkType.Mainnet),
  }));
  expect(on.value()?.listing?.map((r) => r.covenantId)).toEqual([
    PINNED_ID,
    KRON_ID,
    REF_ID,
  ]);
  expect([...(on.value()?.routable ?? [])]).toEqual([
    PINNED_ID,
    KRON_ID,
    REF_ID,
  ]);
  await on.unmount();
});

test("a pinned-only first answer leaves Braid unlisted", async () => {
  braid.answer = LIVE.filter((t) => t.builtin);
  const ui = await mount(() => useBraidRoutable(NetworkType.Mainnet));
  expect(ui.value()).toBeUndefined();
  await ui.unmount();
});

test("a failed refresh keeps the last list", async () => {
  braid.answer = LIVE;
  // SWR re-renders only for the fields read during render.
  const ui = await mount(() => {
    const { data, error, mutate } = useBraidTokens(braid as never, true);
    return { data, error, mutate };
  });
  expect(ui.value()?.data).toBe(LIVE);
  // Braid's API goes down: the SDK answers its pinned table alone.
  braid.answer = LIVE.filter((t) => t.builtin);
  await act(async () => {
    await ui.value()!.mutate();
  });
  expect(ui.value()?.error?.message).toBe(
    "Braid answered only its pinned tokens",
  );
  expect(ui.value()?.data).toBe(LIVE);
  await ui.unmount();
});
