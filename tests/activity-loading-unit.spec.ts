import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { KurveBridgeActivity } from "@/lib/bridge/kat-registry";

// What the PR #508 loading changes must keep doing, against the real modules
// with fetch and the clock replaced: the count gates (Kurve payouts, Igra
// head), Refresh, page scoping, the no-fee wait and the collector splice.
type Modules = typeof import("@/lib/activity/exit-payout") &
  typeof import("@/lib/bridge/igra-deposit-history") &
  typeof import("@/lib/activity/kurve-completion") &
  typeof import("@/lib/activity/fetch-feed") &
  typeof import("@/lib/bridge/kat-bridge-history") &
  typeof import("@/lib/bridge/kat-observed-fees") &
  typeof import("@/lib/bridge/fee-collector") &
  typeof import("@/lib/layer2");
let m: Modules;

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `activity-loading-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        "@/lib/activity/exit-payout",
        "@/lib/bridge/igra-deposit-history",
        "@/lib/activity/kurve-completion",
        "@/lib/activity/fetch-feed",
        "@/lib/bridge/kat-bridge-history",
        "@/lib/bridge/kat-observed-fees",
        "@/lib/bridge/fee-collector",
        "@/lib/layer2",
      ]
        .map((p) => `export * from ${JSON.stringify(p)};`)
        .join("\n"),
      resolveDir: repo,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
    tsconfig: path.join(repo, "tsconfig.json"),
    loader: { ".png": "empty", ".svg": "empty" },
    plugins: [
      {
        name: "storage",
        setup(b) {
          b.onResolve({ filter: /^wxt\/storage$/ }, () => ({
            path: "s",
            namespace: "stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            loader: "js",
            contents: `export const storage = { getItem: async () => null, setItem: async () => {} };`,
          }));
        },
      },
    ],
    logLevel: "error",
  });
  m = await import(pathToFileURL(outfile).href);
});

const S = 1_000;
const ADDR = "kaspa:qqwallet";
const ENTRY =
  "kaspa:ppvnxxzm0rr37zpnwux2f2ntvfpr4uqdpm7zsvsztg3en92r7gs0wkmr72q9n";

// ─── fetch + clock ───────────────────────────────────────────────────────────
let now = 0;
let calls: string[] = [];
let answer: (url: string, body?: string) => unknown = () => null;
const realFetch = globalThis.fetch;
const realNow = Date.now;
const realWarn = console.warn;

test.beforeEach(() => {
  now = Date.UTC(2026, 10, 27, 12);
  calls = [];
  Date.now = () => now;
  console.warn = () => {};
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(String(url));
    const body = answer(String(url), init?.body as string | undefined);
    return body === null
      ? new Response("{}", { status: 500 })
      : new Response(JSON.stringify(body));
  }) as typeof fetch;
  m.clearVaultPayoutCache();
  m.clearIgraDepositCache();
  m.clearKatBridgeHistoryWarnings();
  m.clearKatObservedFeeCache();
});
test.afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
  console.warn = realWarn;
});
const count = (part: string) => calls.filter((u) => u.includes(part)).length;

// ─── Kurve payouts: the count gate ───────────────────────────────────────────
const VAULT = "kaspa:qqvault";
const payoutTx = {
  transaction_id: "PAYOUT",
  accepting_block_time: 1,
  inputs: [{ previous_outpoint_address: VAULT }],
  outputs: [{ script_public_key_address: ADDR, amount: 1_194_000_000 }],
};
/** Upstream as a CDN serves it: `total` for the count, `listing` for the page. */
function vaultUpstream(state: { total: number; listing: unknown[] }) {
  answer = (url) =>
    url.endsWith("/transactions-count")
      ? { total: state.total }
      : url.includes("/full-transactions")
        ? state.listing
        : null;
}

test("kurve: a new count paired with an old cached listing is re-listed ≥ 8 s later before it may gate", async () => {
  // t=0: the payout landed; the count already shows it, the cached listing
  // (max-age 8 s) does not yet.
  const up = { total: 1, listing: [] as unknown[] };
  vaultUpstream(up);
  expect(await m.fetchVaultPayouts(ADDR, VAULT)).toEqual([]);
  up.listing = [payoutTx];
  // A Refresh/focus read 3 s later: still inside the window, re-lists.
  now += 3 * S;
  expect(await m.fetchVaultPayouts(ADDR, VAULT)).toHaveLength(1);
  expect(count("/full-transactions")).toBe(2);
  // The 10 s poll: ≥ 8 s after the count was first seen — this listing
  // confirms the hold.
  now += 7 * S;
  expect(await m.fetchVaultPayouts(ADDR, VAULT)).toHaveLength(1);
  expect(count("/full-transactions")).toBe(3);
  // Confirmed: an unchanged count costs the count read only.
  now += 10 * S;
  expect(await m.fetchVaultPayouts(ADDR, VAULT)).toHaveLength(1);
  expect(count("/full-transactions")).toBe(3);
  expect(count("/transactions-count")).toBe(4);
});

test("kurve: the listing is re-read whenever the count moves", async () => {
  const up = { total: 1, listing: [] as unknown[] };
  vaultUpstream(up);
  await m.fetchVaultPayouts(ADDR, VAULT);
  now += 10 * S;
  await m.fetchVaultPayouts(ADDR, VAULT); // confirms
  now += 10 * S;
  up.total = 2;
  up.listing = [payoutTx];
  expect(await m.fetchVaultPayouts(ADDR, VAULT)).toHaveLength(1);
  expect(count("/full-transactions")).toBe(3);
});

const kurveExit = (): KurveBridgeActivity => ({
  originTxHash: "0xorigin",
  direction: "l2-to-l1",
  amount: "12",
  tokenSymbol: "KAS",
  status: "PENDING",
  destTxHash: null,
  timestampMs: now,
});

test("kurve: Refresh re-lists payouts even under a confirmed count", async () => {
  const up = { total: 1, listing: [] as unknown[] };
  // The hot wallet is the vault here.
  answer = (url) =>
    url.endsWith("/transactions-count")
      ? { total: up.total }
      : url.includes("/full-transactions")
        ? up.listing
        : null;
  const wallets = { kaspaAddress: ADDR, evmAddress: null };
  await m.applyKurveCompletions([kurveExit()], wallets);
  now += 10 * S;
  await m.applyKurveCompletions([kurveExit()], wallets); // confirmed: []
  now += 10 * S;
  // Upstream now lists a payout the confirmed hold does not have (the count
  // cannot be trusted to have moved, e.g. an index row replaced).
  up.listing = [
    {
      ...payoutTx,
      accepting_block_time: now,
      inputs: [{ previous_outpoint_address: m.KURVE_L1_HOT_WALLET }],
    },
  ];
  const polled = await m.applyKurveCompletions([kurveExit()], wallets);
  expect(polled[0].status).toBe("PENDING");
  expect(count("/full-transactions")).toBe(2);
  const refreshed = await m.applyKurveCompletions([kurveExit()], {
    ...wallets,
    force: true,
  });
  expect(count("/full-transactions")).toBe(3);
  expect(refreshed[0].status).toBe("COMPLETED");
});

// ─── Igra deposits: the head gate ────────────────────────────────────────────
const LANE_PAYLOAD = "92" + "11".repeat(20) + "00e1f50500000000" + "00000000";
const depositTx = (id: string) => ({
  transaction_id: id,
  accepting_block_time: 1,
  is_accepted: true,
  payload: LANE_PAYLOAD,
  inputs: [{ previous_outpoint_address: ADDR }],
  outputs: [{ script_public_key_address: ENTRY, amount: 100_000_000 }],
});
const plainTx = (id: string) => ({
  transaction_id: id,
  accepting_block_time: 1,
  is_accepted: true,
  inputs: [{ previous_outpoint_address: "kaspa:qqother" }],
  outputs: [{ script_public_key_address: ADDR, amount: 1 }],
});
function igraUpstream(state: { total: number; head: unknown[] }) {
  answer = (url) =>
    url.endsWith("/transactions-count")
      ? { total: state.total }
      : url.includes("/full-transactions")
        ? new URL(url).searchParams.get("offset") === "0"
          ? state.head
          : []
        : null;
}
const igra = (force = false) =>
  m.fetchIgraDeposits({ kaspaAddress: ADDR, entryAddress: ENTRY, force });
const pages = () => calls.filter((u) => u.includes("offset=0")).length;

test("igra: a new count paired with an old cached head is re-read ≥ 8 s later before it may gate", async () => {
  const up = { total: 1, head: [plainTx("old")] as unknown[] };
  igraUpstream(up);
  await igra(); // cold scan
  // Past the settled head TTL: a deposit landed; the count shows it, the
  // cached page 0 does not yet.
  now += 61 * S;
  up.total = 2;
  expect((await igra()).deposits).toHaveLength(0);
  up.head = [depositTx("dep"), plainTx("old")];
  // Next look past the TTL: the hold is unconfirmed, so page 0 is re-read.
  now += 61 * S;
  expect((await igra()).deposits.map((d) => d.txId)).toEqual(["dep"]);
  expect(pages()).toBe(3);
  // Confirmed now: an unchanged count costs the count read only.
  now += 61 * S;
  expect((await igra()).deposits).toHaveLength(1);
  expect(pages()).toBe(3);
});

test("igra: page 0 is re-read whenever the count moves", async () => {
  const up = { total: 1, head: [plainTx("old")] as unknown[] };
  igraUpstream(up);
  await igra();
  for (let i = 0; i < 2; i++) {
    now += 61 * S;
    await igra(); // second one confirms the count
  }
  expect(pages()).toBe(3);
  now += 61 * S;
  await igra();
  expect(pages()).toBe(3); // gated
  up.total = 2;
  up.head = [depositTx("dep"), plainTx("old")];
  now += 61 * S;
  expect((await igra()).deposits).toHaveLength(1);
  expect(pages()).toBe(4);
});

test("igra: Refresh re-reads page 0 inside the head TTL and under a confirmed count", async () => {
  const up = { total: 1, head: [plainTx("old")] as unknown[] };
  igraUpstream(up);
  await igra();
  for (let i = 0; i < 2; i++) {
    now += 61 * S;
    await igra();
  }
  expect(pages()).toBe(3);
  up.head = [depositTx("dep"), plainTx("old")];
  now += 1 * S; // inside the TTL
  expect((await igra(true)).deposits).toHaveLength(1);
  expect(pages()).toBe(4);
});

// ─── Page scoping ────────────────────────────────────────────────────────────
const EVM = "0x178F82eD0c5a5B924CD72529d0267Be5b452C337";
const feedFor = (page: "swap" | "bridge") =>
  m.fetchActivityFeed({ page, sender: EVM, kaspaAddress: ADDR, force: false });

test("page scoping: Swap reads the L2 swap explorers and no bridge source", async () => {
  answer = () => null;
  await feedFor("swap");
  expect(count("module=account")).toBeGreaterThan(0);
  expect(count("katbridge") + count("api.kaspa.org")).toBe(0);
});

test("page scoping: Bridge reads the bridge sources and no swap explorer", async () => {
  answer = () => null;
  await feedFor("bridge");
  expect(count("katbridge")).toBeGreaterThan(0);
  expect(count("module=account")).toBe(0);
});

// ─── KAT observed fees: the no-fee wait ──────────────────────────────────────
const katRow = (over: Record<string, unknown>) => ({
  id: "row",
  direction: "DEPOSIT",
  fromChainId: 0,
  toChainId: 0,
  fromWallet: ADDR,
  toWallet: ADDR,
  tokenContract: "",
  tokenTick: "KAS",
  amount: "1",
  status: "COMPLETED",
  l1TxId: null,
  l2TxHash: null,
  completedAt: null,
  createdAt: new Date(now).toISOString(),
  ...over,
});

test("fees: a fee read that came back empty is retried once 10 minutes pass, not before", async () => {
  answer = () => null; // the L1 read fails
  const row = katRow({ l1TxId: "REVEAL" }) as never;
  await m.attachKatObservedFees([row]);
  expect(count("/transactions/REVEAL")).toBe(1);
  now += 5 * 60 * S;
  await m.attachKatObservedFees([row]);
  expect(count("/transactions/REVEAL")).toBe(1);
  now += 5 * 60 * S + S;
  await m.attachKatObservedFees([row]);
  expect(count("/transactions/REVEAL")).toBe(2);
});

// ─── KAT collector side: the page-0 splice ───────────────────────────────────
/** KAT's collector history: page 0 then page 1 (hasMore on page 0). */
function collectorUpstream(state: { page0: unknown[]; page1: unknown[] }) {
  answer = (url) => {
    if (!url.includes("katbridge")) return null;
    const u = new URL(url);
    const own =
      u.searchParams.get("fromL2Wallet") !==
      m.KAT_IGRA_FEE_COLLECTOR_BRIDGE_ADDRESS;
    const p1 = u.searchParams.get("offset") !== "0";
    return {
      data: {
        transactions: own ? [] : p1 ? state.page1 : state.page0,
        pagination: { hasMore: !own && !p1 },
      },
    };
  };
}
const exit = (id: string, toWallet = "kaspa:qqother", status = "COMPLETED") =>
  katRow({ id, direction: "WITHDRAW", toWallet, status });
const collectorReads = () =>
  count(`fromL2Wallet=${m.KAT_IGRA_FEE_COLLECTOR_BRIDGE_ADDRESS}`);
const kat = () =>
  m.fetchKatBridgeHistory({ kaspaAddress: ADDR, evmAddress: EVM });

test("collector: an overlapping page 0 is spliced onto the held read — one page, not all", async () => {
  const up = { page0: [exit("b"), exit("a")], page1: [exit("z")] };
  collectorUpstream(up);
  await kat();
  expect(collectorReads()).toBe(2); // full: pages 0 and 1
  up.page0 = [exit("c"), exit("b")];
  now += 10 * S;
  await kat();
  expect(collectorReads()).toBe(3); // page 0 only
});

test("collector: a page 0 that no longer overlaps the held rows pays for the full read", async () => {
  const up = { page0: [exit("b"), exit("a")], page1: [exit("z")] };
  collectorUpstream(up);
  await kat();
  up.page0 = [exit("e"), exit("d")];
  up.page1 = [exit("c"), exit("b")];
  now += 10 * S;
  await kat();
  expect(collectorReads()).toBe(2 + 1 + 2); // head, then the full read
});

test("collector: this wallet's PENDING exit outside page 0 pays for the full read, and its status lands", async () => {
  const up = {
    page0: [exit("b"), exit("a")],
    page1: [exit("mine", ADDR, "PENDING")],
  };
  collectorUpstream(up);
  expect((await kat()).txs.find((t) => t.id === "mine")?.status).toBe(
    "PENDING",
  );
  up.page0 = [exit("c"), exit("b")];
  up.page1 = [exit("a"), exit("mine", ADDR, "COMPLETED")];
  now += 10 * S;
  expect((await kat()).txs.find((t) => t.id === "mine")?.status).toBe(
    "COMPLETED",
  );
  expect(collectorReads()).toBe(2 + 1 + 2);
});
