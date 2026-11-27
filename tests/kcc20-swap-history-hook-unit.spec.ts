import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";

// The real useKcc20SwapHistory, rendered under happy-dom with its own SWR,
// over the recorded venues wallet (tests/fixtures/kcc20/activity). Stubbed:
// settings, flags and the token list (context hooks), the pending-Braid store
// (browser storage), the owner key (WASM) and KRON's registry. Everything
// between kascov's rows and the returned family is the real code.
type Bundle = typeof import("@/hooks/useKcc20SwapHistory") &
  typeof import("@/lib/activity/kcc20-swap-history") & {
    React: typeof import("react");
    createRoot: typeof import("react-dom/client").createRoot;
    SWRConfig: typeof import("swr").SWRConfig;
  };

let b: Bundle;

const FIXTURES = path.join(
  import.meta.dirname,
  "fixtures",
  "kcc20",
  "activity",
);
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));
const VENUES = fixture("kascov-transfers-venues-bare-05a0b9.json");
const TXS = [
  "kaspa-tx-kasparocket-guza-buy.json",
  "kaspa-tx-braid-sell-deposit.json",
  "kaspa-tx-braid-buy-settle.json",
  "kaspa-tx-braid-buy-deposit.json",
].map(fixture);
const COIN = fixture("kaspa-addr-braid-sell-coin.live-2026-11-27.json");
const SELL_TXID = TXS[1].transaction_id as string;
const DEPOSIT_ONLY = COIN.filter(
  (t: { transaction_id: string }) => t.transaction_id === SELL_TXID,
);
const WALLET =
  "kaspa:qqz6pwtwxa5dds2qssxpuc28lnrnnvx48ymdcqyzju0n58dcg5p9c6luwmcyg";
const PK = "05a0b96e3768d6c140840c1e6147fcc739b0d53936dc0082971f3a1db845025c";

const STUBS: [RegExp, string, string?][] = [
  [
    /^@\/hooks\/useSettings(\.ts)?$/,
    `export const useSettings = () => [{ networkId: "mainnet" }];`,
  ],
  [
    /^@\/hooks\/useFeatureFlags(\.ts)?$/,
    `export const useFeatureFlags = () => ({ isKcc20StandardEnabled: true });`,
  ],
  [
    /^@\/lib\/kcc20\/useKcc20Tokens(\.ts)?$/,
    `export default () => ({ data: [], isLoading: false });`,
  ],
  [
    /^@\/lib\/braid\/pending$/,
    `export const getPendingBraidSwaps = async () => []; export const subscribeBraidSwaps = () => () => {};`,
    "hook",
  ],
  [
    /^@\/lib\/kcc20\/swap$/,
    // The sold token, held no more and in no list: only KRON's registry names it.
    `export const fetchKronMarkets = async () => Object.assign([{ covenantId: "${"B77CB1A7A9701CC4398EDB5BE836688FEB13463A62F4F57DA86104108ECDDFE4"}", entry: { symbol: "BRD", decimals: 8 } }], { graduated: [] });`,
    "hook",
  ],
  [
    /^@\/lib\/kcc20\/history$/,
    `export const standardOwnerKey = () => new Uint8Array(32).fill(5);
     export const ownerStrings = () => ["${PK}", "presence:${PK}", "p2pkh:00"];`,
    "hook",
  ],
];

test.beforeAll(async () => {
  // SWR and react-dom decide "server or browser" once, at import.
  const win = new Window();
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `kcc20-swap-hook-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        `export * from "@/hooks/useKcc20SwapHistory";`,
        `export { clearKcc20SwapMoneyCache } from "@/lib/activity/kcc20-swap-history";`,
        `export * as React from "react";`,
        `export { createRoot } from "react-dom/client";`,
        `export { SWRConfig } from "swr";`,
      ].join("\n"),
      resolveDir: repo,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    tsconfig: path.join(repo, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"development"' },
    loader: {
      ".png": "empty",
      ".svg": "empty",
      ".jpg": "empty",
      ".webp": "empty",
      ".css": "empty",
    },
    plugins: [
      {
        name: "hook-stubs",
        setup(p) {
          p.onResolve({ filter: /^@\// }, (args) => {
            const hit = STUBS.find(
              ([re, , only]) =>
                re.test(args.path) &&
                (!only || args.importer.endsWith("useKcc20SwapHistory.ts")),
            );
            return hit
              ? { path: args.path, namespace: "stub", pluginData: hit[1] }
              : undefined;
          });
          p.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: args.pluginData,
            loader: "js",
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  b = (await import(pathToFileURL(outfile).href)) as Bundle;
});

let listing: unknown = DEPOSIT_ONLY;
let listings = 0;
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;

test.beforeEach(() => {
  b.clearKcc20SwapMoneyCache();
  listing = DEPOSIT_ONLY;
  listings = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = decodeURIComponent(String(input));
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("kascov.io") && url.includes("/addr/"))
      return json({
        token_holdings: [],
        tip_daa: 603303261,
        tip_at_ms: 1795750893029,
      });
    // One owner string carries the fixture; `presence:` has nothing more.
    if (url.includes("kascov.io") && url.includes("/transfers"))
      return json(
        url.includes("presence:") || url.includes("before_daa=")
          ? { transfers: [] }
          : VENUES,
      );
    if (url.includes("/full-transactions")) {
      listings++;
      return listing === 500
        ? new Response("", { status: 500 })
        : json(listing);
    }
    const tx = TXS.find((t) =>
      url.includes(`/transactions/${t.transaction_id}`),
    );
    if (tx) return json(tx);
    return new Response("", { status: 404 });
  }) as typeof fetch;
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.setTimeout = realSetTimeout;
});

async function render() {
  const { React, createRoot, SWRConfig } = b;
  let latest: ReturnType<typeof b.useKcc20SwapHistory> | undefined;
  const Probe = () => {
    latest = b.useKcc20SwapHistory(WALLET, true);
    return null;
  };
  const root = createRoot(document.createElement("div"));
  const cache = new Map();
  await React.act(async () =>
    root.render(
      React.createElement(
        SWRConfig,
        { value: { provider: () => cache } },
        React.createElement(Probe),
      ),
    ),
  );
  const sell = () => latest?.family?.swaps.find((s) => s.txHash === SELL_TXID);
  /** Waits (in act) until the sell row reads `status`, or gives up. */
  const until = async (status: string) => {
    for (let i = 0; i < 100 && sell()?.status !== status; i++)
      await React.act(() => new Promise((r) => realSetTimeout(r, 20)));
    return sell();
  };
  return {
    h: () => latest!,
    until,
    unmount: () => React.act(async () => root.unmount()),
  };
}

test("hook: refresh() lands a settle accepted after the first read — Pending turns Completed", async () => {
  const r = await render();
  expect((await r.until("pending"))?.status).toBe("pending");
  listing = COIN;
  const before = listings;
  await b.React.act(async () => void (await r.h().refresh()));
  expect(listings).toBeGreaterThan(before);
  // SWR's default compare calls any two Maps equal and kept the open read.
  expect(await r.until("completed")).toMatchObject({
    status: "completed",
    fromSymbol: "BRD",
    toAmount: "8.661776",
    feeAmount: "0.113124",
  });
  await r.unmount();
});

test("hook: the open sell's own re-check reaches the row without a refresh", async () => {
  // The 30 s re-check, run at 30 ms; every other timer as asked.
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) =>
    realSetTimeout(fn, ms === 30_000 ? 30 : ms, ...a)) as typeof setTimeout;
  const r = await render();
  expect((await r.until("pending"))?.status).toBe("pending");
  listing = COIN;
  expect((await r.until("completed"))?.toAmount).toBe("8.661776");
  // Final: the re-check stops once nothing is open.
  const after = listings;
  await b.React.act(() => new Promise((res) => realSetTimeout(res, 200)));
  expect(listings).toBe(after);
  await r.unmount();
});

test("hook: a failed listing is re-read on its own — the sell does not keep a dash", async () => {
  // The 30 s re-check, run at 30 ms; every other timer as asked.
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...a: unknown[]) =>
    realSetTimeout(fn, ms === 30_000 ? 30 : ms, ...a)) as typeof setTimeout;
  listing = 500;
  const r = await render();
  const tick = () =>
    b.React.act(() => new Promise((res) => realSetTimeout(res, 20)));
  // The failed read lands: no settle, nothing marked open, Received unread.
  for (let i = 0; i < 100 && listings === 0; i++) await tick();
  expect(listings).toBeGreaterThan(0);
  listing = COIN;
  const sell = () => r.h().family?.swaps.find((s) => s.txHash === SELL_TXID);
  for (let i = 0; i < 100 && sell()?.toAmount !== "8.661776"; i++) await tick();
  expect(sell()).toMatchObject({ status: "completed", toAmount: "8.661776" });
  await r.unmount();
});
