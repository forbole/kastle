import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { IgraCredit } from "@/lib/bridge/igra-credits";
import type { IgraDeposit } from "@/lib/bridge/igra-deposit-history";
import type { KurveBridgeActivity } from "@/lib/bridge/kat-registry";
import type { ActivityRowDescriptor } from "@/lib/activity/types";

// The activity modules reach image assets (chain logos) through lib/layer2
// and the adapters, which Playwright's loader cannot import. esbuild bundles
// the real modules with those assets emptied; nothing under test reads them.
type Modules = typeof import("@/lib/activity/mappers") &
  typeof import("@/lib/activity/adapters") &
  typeof import("@/lib/activity/kurve-completion") &
  typeof import("@/lib/bridge/igra-credits") &
  typeof import("@/lib/bridge/kat-registry");

let m: Modules;

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `activity-unit-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        "@/lib/activity/mappers",
        "@/lib/activity/adapters",
        "@/lib/activity/kurve-completion",
        "@/lib/bridge/igra-credits",
        "@/lib/bridge/kat-registry",
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
    logLevel: "error",
  });
  m = await import(pathToFileURL(outfile).href);
});

const EVM = "0x151e6413aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const T0 = Date.UTC(2026, 8, 20, 12);
const MIN = 60_000;

const deposit = (over: Partial<IgraDeposit> = {}): IgraDeposit => ({
  txId: "97b1aa",
  evmAddress: EVM,
  amountSompi: 972_500_000,
  entryOutSompi: 972_500_000,
  kastleFeeSompi: 0,
  timestampMs: T0,
  accepted: true,
  ...over,
});

const credit = (amountSompi: number, timeMs: number, index: string) =>
  ({ amountSompi, timeMs, index }) satisfies IgraCredit;

const deps = { logoFor: () => undefined, priceFor: () => undefined };

// ─── Igra deposits: completion needs the L2 credit ──────────────────────────

test("igra: an accepted deposit without an observed credit is never completed", () => {
  expect(m.mapIgraDepositActivity(deposit()).status).toBe("unknown");
  expect(
    m.mapIgraDepositActivity(deposit({ credit: { status: "missing" } })).status,
  ).toBe("unknown");
  expect(
    m.mapIgraDepositActivity(deposit({ credit: { status: "awaiting" } }))
      .status,
  ).toBe("pending");
  expect(m.mapIgraDepositActivity(deposit({ accepted: false })).status).toBe(
    "pending",
  );
});

test("igra: an observed credit completes the row and is the received leg", () => {
  const row = m.mapIgraDepositActivity(
    deposit({
      credit: { status: "credited", amountSompi: 972_500_000, timeMs: T0 },
    }),
  );
  expect(row.status).toBe("completed");
  expect(row.received).toEqual({ value: "9.725", symbol: "iKAS" });
  expect(row.meta?.fee).toBe("0 KAS");
});

test("igra: credits match by exact amount inside the window, one credit per deposit", () => {
  const a = deposit({ txId: "a", timestampMs: T0 });
  const b = deposit({ txId: "b", timestampMs: T0 + 40_000 });
  const lists = new Map([
    [
      EVM,
      {
        complete: true,
        credits: [
          credit(972_500_000, T0 - 529_000, "1"),
          credit(972_500_000, T0 - 489_000, "2"),
          // Right amount, far outside the window: not this deposit's credit.
          credit(972_500_000, T0 - 90 * MIN, "3"),
        ],
      },
    ],
  ]);
  const out = m.matchIgraCredits([b, a], lists, T0 + 2 * 60 * MIN);
  const statuses = out.map((d) => d.credit?.status);
  expect(statuses).toEqual(["credited", "credited"]);
  expect(
    new Set(out.map((d) => (d.credit as { timeMs: number }).timeMs)).size,
  ).toBe(2);

  // A third same-amount deposit finds no free credit in its window.
  const c = deposit({ txId: "c", timestampMs: T0 + 60_000 });
  const withC = m.matchIgraCredits([a, b, c], lists, T0 + 2 * 60 * MIN);
  expect(withC.find((d) => d.txId === "c")?.credit).toEqual({
    status: "missing",
  });
  // …and is only "awaiting" while the window is still open.
  const early = m.matchIgraCredits([a, b, c], lists, T0 + 5 * MIN);
  expect(early.find((d) => d.txId === "c")?.credit).toEqual({
    status: "awaiting",
  });
});

test("igra: an unreadable or truncated credit list leaves older deposits unobserved", () => {
  const old = deposit({ txId: "old", timestampMs: T0 });
  const recent = deposit({ txId: "new", timestampMs: T0 + 10 * 60 * MIN });
  const truncated = new Map([
    [EVM, { complete: false, credits: [credit(1, T0 + 9 * 60 * MIN, "9")] }],
  ]);
  const out = m.matchIgraCredits([old, recent], truncated, T0 + 20 * 60 * MIN);
  expect(out.find((d) => d.txId === "old")?.credit).toBeUndefined();
  expect(out.find((d) => d.txId === "new")?.credit).toEqual({
    status: "missing",
  });

  const unreadable = m.matchIgraCredits(
    [old],
    new Map([[EVM, null]]),
    T0 + 20 * 60 * MIN,
  );
  expect(unreadable[0].credit).toBeUndefined();
  expect(m.mapIgraDepositActivity(unreadable[0]).status).toBe("unknown");
});

test("igra: withdrawals parse sompi-exact wei and expose the next page", () => {
  const parsed = m.parseIgraWithdrawals({
    items: [
      {
        amount: "9725000000000000000",
        timestamp: "2026-09-20T12:00:00.000000Z",
        index: "42",
      },
      // Not a whole sompi: not a lane credit.
      { amount: "1", timestamp: "2026-09-20T12:00:00Z", index: "43" },
      { amount: "oops", timestamp: "2026-09-20T12:00:00Z", index: "44" },
    ],
    next_page_params: { index: 41, items_count: 50 },
  });
  expect(parsed.credits).toEqual([
    { amountSompi: 972_500_000, timeMs: T0, index: "42" },
  ]);
  expect(parsed.next).toEqual({ index: 41, items_count: 50 });
  expect(
    m.parseIgraWithdrawals({ items: [], next_page_params: null }).next,
  ).toBe(null);
});

test("igra: attachIgraCredits degrades to unobserved when the fetch throws", async () => {
  const out = await m.attachIgraCredits([deposit()], async () => {
    throw new Error("down");
  });
  expect(out[0].credit).toBeUndefined();
  // Unaccepted deposits never trigger a fetch.
  let calls = 0;
  await m.attachIgraCredits([deposit({ accepted: false })], async () => {
    calls++;
    return null;
  });
  expect(calls).toBe(0);
});

// ─── bridge list amount: received only once completed ──────────────────────

const bridgeRow = (
  status: ActivityRowDescriptor["status"],
): ActivityRowDescriptor => ({
  id: `x:${status}`,
  type: "igra_deposit",
  timestampMs: T0,
  direction: "in",
  sent: { value: "10", symbol: "KAS" },
  received: { value: "9.725", symbol: "iKAS" },
  status,
  actions: [],
  meta: { route: "l1-to-l2" },
});

test("adapter: a bridge shows received only when completed, sent otherwise", () => {
  const done = m.toActivityItem(bridgeRow("completed"), deps);
  expect(done.amountNumber).toBe("+9.725");
  expect(done.amountSymbol).toBe("iKAS");
  expect(done.tone).toBe("credit");

  for (const status of ["pending", "failed", "unknown"] as const) {
    const item = m.toActivityItem(bridgeRow(status), deps);
    expect(item.amountNumber).toBe("10");
    expect(item.amountSymbol).toBe("KAS");
    expect(item.tone).toBe("neutral");
  }
  // The sheet still shows the expectation, labelled as one.
  expect(
    m.toActivityItem(bridgeRow("pending"), deps).sheet.transfer.receivedLabel,
  ).toBe("You'll receive");
});

// ─── Kurve: received/fee only from an observed payout ───────────────────────

const kurve = (
  over: Partial<KurveBridgeActivity> = {},
): KurveBridgeActivity => ({
  originTxHash: "0xorigin",
  direction: "l2-to-l1",
  amount: "12",
  tokenSymbol: "KAS",
  status: "PENDING",
  destTxHash: null,
  timestampMs: T0,
  ...over,
});

test("kurve: an exit with no observed payout has no received leg and no fee", () => {
  const row = m.mapKurveBridgeActivity(kurve({ status: "COMPLETED" }));
  expect(row.received).toBeUndefined();
  expect(row.meta?.fee).toBeUndefined();
});

test("kurve: an exit's received leg and fee come from the observed payout", () => {
  const row = m.mapKurveBridgeActivity(
    kurve({ status: "COMPLETED", observedPayoutSompi: 1_190_000_000 }),
  );
  expect(row.received).toEqual({ value: "11.9", symbol: "KAS" });
  expect(row.meta?.fee).toBe("0.1 KAS");
});

test("kurve: a deposit prefers the observed credit over the flat fee", () => {
  const flat = m.mapKurveBridgeActivity(kurve({ direction: "l1-to-l2" }));
  expect(flat.received).toEqual({ value: "11.5", symbol: "KAS" });
  expect(flat.meta?.fee).toBe("0.5 KAS");
  const seen = m.mapKurveBridgeActivity(
    kurve({ direction: "l1-to-l2", observedPayoutSompi: 1_140_000_000 }),
  );
  expect(seen.received).toEqual({ value: "11.4", symbol: "KAS" });
  expect(seen.meta?.fee).toBe("0.6 KAS");
});

test("kurve: completion carries the matched payout; registry-completed rows look it up by hash", async () => {
  const payouts = [
    { txHash: "L1PAYOUT", amountSompi: 1_194_000_000, timeMs: T0 + 40_000 },
    { txHash: "L1OTHER", amountSompi: 497_500_000, timeMs: T0 - 60 * MIN },
  ];
  const out = await m.applyKurveCompletions(
    [
      kurve(),
      kurve({
        originTxHash: "0xsettled",
        amount: "5",
        status: "COMPLETED",
        destTxHash: "l1other",
        timestampMs: T0 - 61 * MIN,
      }),
    ],
    { kaspaAddress: "kaspa:q", evmAddress: null },
    { l1Payouts: async () => payouts, l2Credits: async () => [] },
  );
  expect(out[0]).toMatchObject({
    status: "COMPLETED",
    destTxHash: "L1PAYOUT",
    observedPayoutSompi: 1_194_000_000,
  });
  expect(out[1]).toMatchObject({
    status: "COMPLETED",
    destTxHash: "l1other",
    observedPayoutSompi: 497_500_000,
  });
});

// ─── Kurve registry pagination ──────────────────────────────────────────────

test("registry: pages until hasMore is false, and flags a capped or broken read", async () => {
  const realFetch = globalThis.fetch;
  const offsets: number[] = [];
  const page = (n: number, hasMore: boolean) => ({
    success: true,
    data: {
      transactions: Array.from({ length: n }, (_, i) => ({
        originTxHash: `0x${offsets.length}-${i}`,
      })),
      pagination: { total: 0, limit: 100, offset: 0, hasMore },
    },
  });
  try {
    let plan: (offset: number) => Response;
    globalThis.fetch = (async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      expect(new URL(url).searchParams.get("limit")).toBe("100");
      offsets.push(offset);
      return plan(offset);
    }) as typeof fetch;

    plan = (offset) =>
      Response.json(offset < 200 ? page(100, true) : page(7, false));
    const all = await m.fetchKurveRegistry("kaspa:q");
    expect(offsets).toEqual([0, 100, 200]);
    expect(all?.rows).toHaveLength(207);
    expect(all?.truncated).toBe(false);

    offsets.length = 0;
    plan = () => Response.json(page(100, true));
    const capped = await m.fetchKurveRegistry("kaspa:q");
    expect(capped?.truncated).toBe(true);
    expect(capped?.rows).toHaveLength(offsets.length * 100);

    offsets.length = 0;
    plan = (offset) =>
      offset === 0
        ? Response.json(page(100, true))
        : new Response("", { status: 500 });
    const broken = await m.fetchKurveRegistry("kaspa:q");
    expect(broken?.rows).toHaveLength(100);
    expect(broken?.truncated).toBe(true);

    plan = () => new Response("", { status: 500 });
    expect(await m.fetchKurveRegistry("kaspa:q")).toBeNull();
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── Adapter formatting + ETA caption regressions ───────────────────────────

const row = (over: Partial<ActivityRowDescriptor>): ActivityRowDescriptor => ({
  id: "r",
  type: "bridge",
  timestampMs: T0,
  direction: "out",
  status: "pending",
  actions: [],
  ...over,
});

test("rowTitle: failed and refund_claimable never read Bridged/Swapped", () => {
  expect(m.rowTitle(row({ status: "failed" }))).toBe("Failed");
  expect(m.rowTitle(row({ status: "refund_claimable" }))).toBe("Refunded");
});

test("fmtAmount/fmtFee: a tiny non-zero amount never renders 0", () => {
  expect(m.fmtAmount("0.000000000000000001")).toBe("0.000000000000000001");
  expect(m.fmtAmount("0.0003")).toBe("0.0003");
  expect(m.fmtAmount("1.23456")).toBe("1.235");
  expect(m.fmtAmount("0")).toBe("0");
  expect(m.fmtFee("0.000000000000000001 KAS")).toBe("0.000000000000000001 KAS");
});

test("usdText: a value under $0.005 yields no line", () => {
  expect(m.usdText({ value: "0.001", symbol: "KAS" }, () => 0.1)).toBe("");
  expect(m.usdText({ value: "100", symbol: "KAS" }, () => 0.1)).not.toBe("");
});

test("buildDetails: pending exits (KAT and Kurve) carry the 48h caption, deposits do not", () => {
  const caption = (r: ActivityRowDescriptor) =>
    m.buildDetails(r).find((d: { label: string }) => d.label === "Status")
      ?.subtext;
  const eta = "Usually done within 48 hours";
  expect(caption(row({ meta: { route: "l2-to-l1" } }))).toBe(eta);
  expect(
    caption(row({ type: "bridge_kurve", meta: { route: "l2-to-l1" } })),
  ).toBe(eta);
  expect(
    caption(row({ type: "bridge_kurve", meta: { route: "l1-to-l2" } })),
  ).toBeUndefined();
  expect(caption(row({ meta: { route: "l1-to-l2" } }))).toBeUndefined();
});

test("formatDateTime: only a prior-year timestamp shows the year", () => {
  const y = new Date().getFullYear();
  expect(m.formatDateTime(new Date(y - 1, 5, 15, 12).getTime())).toContain(
    String(y - 1),
  );
  expect(m.formatDateTime(new Date(y, 0, 1, 12).getTime())).not.toContain(
    String(y),
  );
});
