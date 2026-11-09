import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { hexToBytes } from "viem";
import type { KascovTransfer } from "@/lib/kcc20/providers/kascov";

// history.ts reaches the wasm codec and image assets; esbuild bundles it like the swap-history spec.
type Modules = typeof import("@/lib/kcc20/history") &
  typeof import("@/lib/kcc20/providers/kascov") &
  typeof import("@/ui/popup/kcc20/labels");
let m: Modules;

const FIXTURES = path.join(
  import.meta.dirname,
  "fixtures",
  "kcc20",
  "activity",
);
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));

// Real kascov responses, captured 2026-11-09, untrimmed.
// /token/28c8fb…/events?order=desc&limit=100: YELLO's whole log, genesis included (78
// deltas, 46 transitions, no next_before_seq). Merges carry owner_to only, never owner_from.
const EVENTS = fixture("kascov-events-yello-28c8fb.json");
// /transfers?owner=presence:05a0b9…&token_id=28c8fb…: seqs 45 and 43 are "ambiguous"
// merges (KRON market sells, movements []); 44, 41, 40 are exact.
const TRANSFERS = fixture("kascov-transfers-yello-presence-05a0b9.json");

const YELLO_ID =
  "28c8fbf492c8dcb3a909ea2db19e9b2609a23b17858b03a49a82180b077f23bd";
const PK = "05a0b96e3768d6c140840c1e6147fcc739b0d53936dc0082971f3a1db845025c";
const MARKET =
  "covenant:7b97bbf47f5ff4d7d35d6166b3079757cc185a810aef42fa01e736a6291d32ff";
const TIP = { daa: 585700000, atMs: 1_794_196_000_000 };
const KASCOV = "https://kascov.io/data/mainnet";

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `kcc20-attr-unit-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        "@/lib/kcc20/history",
        "@/lib/kcc20/providers/kascov",
        "@/ui/popup/kcc20/labels",
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
    // Assets reached through lib/utils; nothing under test reads them.
    loader: {
      ".png": "empty",
      ".svg": "empty",
      ".jpg": "empty",
      ".webp": "empty",
      ".css": "empty",
    },
    logLevel: "silent",
  });
  m = (await import(pathToFileURL(outfile).href)) as Modules;
});

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

/** kascov answers from the fixtures; anything else rejects, as offline would. */
function serveKascov() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(`${KASCOV}/token/${YELLO_ID}/events`))
      return new Response(JSON.stringify(EVENTS), { status: 200 });
    if (url.startsWith(`${KASCOV}/transfers`))
      return new Response(JSON.stringify(TRANSFERS), { status: 200 });
    throw new Error(`unmocked ${url}`);
  }) as typeof fetch;
}

/** The real fetchTokenEvents, counted. */
function spyEvents() {
  const calls: string[] = [];
  const fetcher: typeof m.fetchTokenEvents = (tokenId, beforeSeq, opts) => {
    calls.push(tokenId);
    return m.fetchTokenEvents(tokenId, beforeSeq, opts);
  };
  return { calls, fetcher };
}

async function rows() {
  serveKascov();
  const { transfers } = await m.fetchOwnerTransfers(`presence:${PK}`, YELLO_ID);
  return transfers;
}

const own = () => new Set(m.ownerStrings(hexToBytes(`0x${PK}`)));
const entry = (entries: { seq: number }[], seq: number) =>
  entries.find((e) => e.seq === seq);

test("an ambiguous market merge is attributed from the event log", async () => {
  const raw = await rows();
  expect(raw.find((r) => r.seq === 43)?.status).toBe("ambiguous");
  const spy = spyEvents();
  const attributed = await m.attributeFromEventLog(raw, YELLO_ID, spy.fetcher);
  expect(spy.calls).toEqual([YELLO_ID]);

  const entries = m.toHistoryEntries(attributed, own(), [], TIP);
  // 180498 in, 130498 back out to the wallet; 45: 70498 in, 25498 back.
  expect(entry(entries, 43)).toMatchObject({
    kind: "sell",
    amount: 50000n,
    counterparty: MARKET,
    ambiguous: false,
  });
  expect(entry(entries, 45)).toMatchObject({
    kind: "sell",
    amount: 45000n,
    counterparty: MARKET,
    ambiguous: false,
  });
  // Exact rows are untouched.
  expect(entry(entries, 44)).toMatchObject({ kind: "send", amount: 60000n });
  expect(entry(entries, 40)).toMatchObject({ kind: "buy", amount: 181498n });
  for (const e of entries) expect(m.toHistoryRow(e).kind).not.toBe("unknown");
});

test("the same merge with no market label classifies as a send", async () => {
  const row43 = (await rows()).find((r) => r.seq === 43)!;
  const plain: KascovTransfer = {
    ...row43,
    marketId: undefined,
    marketSide: undefined,
  };
  const [attributed] = await m.attributeFromEventLog([plain], YELLO_ID);
  const [e] = m.toHistoryEntries([attributed], own(), [], TIP);
  // The covenant is just another owner here: a send of 50000 to it.
  expect(e).toMatchObject({
    kind: "send",
    amount: 50000n,
    counterparty: MARKET,
    ambiguous: false,
  });
});

test("replaying the whole log lands on kascov's live balances", async () => {
  serveKascov();
  const { events } = await m.fetchTokenEvents(YELLO_ID);
  const log = m.replayEventLog(events);
  const net = new Map<string, bigint>();
  for (const moves of log.values())
    for (const mv of moves) {
      net.set(mv.ownerFrom, (net.get(mv.ownerFrom) ?? 0n) - mv.amount);
      net.set(mv.ownerTo, (net.get(mv.ownerTo) ?? 0n) + mv.amount);
    }
  // Genesis gave the market 999999999 and 26da… 1; /token/28c8fb… reads these today.
  expect((net.get(MARKET) ?? 0n) + 999999999n).toBe(999899266n);
  expect(net.get(`presence:${PK}`)).toBe(25498n);
});

test("a non-exact row with no matching event keeps the honest fallback", async () => {
  const row45 = (await rows()).find((r) => r.seq === 45)!;
  const orphan: KascovTransfer = { ...row45, txid: "ab".repeat(32), seq: 99 };
  const [attributed] = await m.attributeFromEventLog([orphan], YELLO_ID);
  expect(attributed.status).toBe("ambiguous");
  const [e] = m.toHistoryEntries([attributed], own(), [], TIP);
  expect(e.ambiguous).toBe(true);
  expect(e.amount).toBeUndefined();
  const row = m.toHistoryRow(e);
  expect(row.kind).toBe("unknown");
  expect(row.amount).toBeUndefined();
  expect(row.counterparty).toBeUndefined();
});

test("a log past the page cap is not replayed", async () => {
  const row45 = (await rows()).find((r) => r.seq === 45)!;
  let calls = 0;
  const endless: typeof m.fetchTokenEvents = async () => ({
    events: [],
    eventsTotal: 1,
    nextBeforeSeq: ++calls,
  });
  const [attributed] = await m.attributeFromEventLog(
    [row45],
    YELLO_ID,
    endless,
  );
  expect(calls).toBe(m.EVENT_LOG_PAGE_CAP);
  expect(attributed.status).toBe("ambiguous");
});

test("an all-exact set reads no event log", async () => {
  const exact = (await rows()).filter((r) => r.status === "exact");
  expect(exact.length).toBeGreaterThan(0);
  const spy = spyEvents();
  const out = await m.attributeFromEventLog(exact, YELLO_ID, spy.fetcher);
  expect(spy.calls).toEqual([]);
  expect(out).toBe(exact);
});

test("a failed /events read keeps the fetched rows, exact ones included", async () => {
  const raw = await rows();
  for (const reason of ["kascov: 503", "kascov: malformed events response"]) {
    const fail: typeof m.fetchTokenEvents = async () => {
      throw new Error(reason);
    };
    expect(await m.attributeFromEventLog(raw, YELLO_ID, fail)).toBe(raw);
  }
});

test("a log short of eventsTotal marks nothing exact", async () => {
  const raw = await rows();
  const short: typeof m.fetchTokenEvents = async (id, before) => ({
    ...(await m.fetchTokenEvents(id, before)),
    eventsTotal: 47,
  });
  const out = await m.attributeFromEventLog(raw, YELLO_ID, short);
  expect(out.find((r) => r.seq === 43)?.status).toBe("ambiguous");
  expect(out.find((r) => r.seq === 45)?.status).toBe("ambiguous");
});

test("a dropped genesis cell does not hand its spend to an equal cell", async () => {
  const ev = (seq: number, deltaIdx: number, ownerTo: string) => ({
    txid: `t${seq}`,
    seq,
    deltaIdx,
    acceptingDaa: 1,
    ownerTo,
    amount: 100n,
  });
  // Genesis A:100 (idx 0) + B:100 (idx 1); A's delta was dropped by the parser.
  // Whole, the owner-less spend of 100 is A's or B's: never exact.
  const log: typeof m.fetchTokenEvents = async () => ({
    events: [ev(0, 1, "presence:b"), ev(1, 0, "presence:d")],
    eventsTotal: 2,
  });
  const row45 = (await rows()).find((r) => r.seq === 45)!;
  const row: KascovTransfer = { ...row45, txid: "t1", seq: 1 };
  const [out] = await m.attributeFromEventLog([row], YELLO_ID, log);
  expect(out.status).toBe("ambiguous");
  expect(out.movements).toEqual([]);
});

test("an amount past 2^53 keeps every whole-token digit", () => {
  expect(m.formatKcc20Amount(10000000000000001n, 0)).toBe(
    "10,000,000,000,000,001",
  );
  expect(m.formatKcc20Amount(123456789012345678901n, 2)).toBe(
    "1,234,567,890,123,456,789.01",
  );
  expect(m.formatKcc20Amount(12345n, 3)).toBe("12.345");
  expect(m.formatKcc20Amount(1n, 8)).toBe("0.00000001");
  expect(m.formatKcc20Amount(0n, 8)).toBe("0");
});
