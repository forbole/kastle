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
  typeof import("@/lib/kcc20/krc20Fill");
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

// /token/41d449…/events?order=desc&limit=100 (NACHO, captured 2026-11-09): its newest page;
// seqs 1401 and 1400 are splits from the wallet's bare key, owner_from on every delta.
const NACHO_EVENTS = fixture("kascov-events-nacho-41d449.json");
// /transfers?owner=presence:05a0b9…&token_id=41d449…: empty. /transfers covers verified-market
// tokens only, so NACHO's history comes from the event log.
const NACHO_TRANSFERS = fixture("kascov-transfers-nacho-presence-05a0b9.json");
const NACHO_ID =
  "41d44970ba6307bcec418f677fd253778d0ffa47750d179dff647061aa6c0d40";

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
        "@/lib/kcc20/krc20Fill",
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

async function nachoEvents() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(`${KASCOV}/token/${NACHO_ID}/events`))
      return new Response(JSON.stringify(NACHO_EVENTS), { status: 200 });
    throw new Error(`unmocked ${url}`);
  }) as typeof fetch;
  return (await m.fetchTokenEvents(NACHO_ID)).events;
}

test("NACHO has no /transfers rows: its history is the event log", () => {
  expect(NACHO_TRANSFERS.transfers).toEqual([]);
  expect(NACHO_TRANSFERS.scope).toBe("verified_market_tokens");
});

test("a NACHO split from the wallet reads as a send with its amount", async () => {
  const entries = m.eventEntries(await nachoEvents(), own(), TIP);
  expect(entries.map((e) => e.seq)).toEqual([1401, 1400]);
  expect(entry(entries, 1401)).toMatchObject({
    kind: "send",
    amount: 10000000000n,
    ambiguous: false,
    counterparty:
      "fe049e0f3701fae03b66d77543113114934509c3d2da05e3b528937908067962",
  });
  for (const e of entries) {
    const row = m.toHistoryRow(e);
    expect(row.kind).toBe("send");
    expect(row.direction).toBe("out");
    expect(String(row.amount)).toBe("10000000000");
  }
});

test("a merge names no input owner: unattributed, no amount", async () => {
  serveKascov();
  const { events } = await m.fetchTokenEvents(YELLO_ID);
  const [e] = m.eventEntries(
    events.filter((x) => x.seq === 45),
    own(),
    TIP,
  );
  expect(e).toMatchObject({ seq: 45, kind: "unknown", ambiguous: true });
  const row = m.toHistoryRow(e);
  expect(row.kind).toBe("unknown");
  expect(row.amount).toBeUndefined();
  expect(row.counterparty).toBeUndefined();
});

const kcc20 = (
  over: Partial<import("@/lib/kcc20").Kcc20Token>,
): import("@/lib/kcc20").Kcc20Token => ({
  covenantId: NACHO_ID,
  family: "kcc20-standard",
  tick: "",
  amount: 1n,
  spendable: 1n,
  ...over,
});
const LOGO = "https://cdn.example/nacho.png";

test("ticker and logo fill from the sole KRC-20 namesake; decimals never do", () => {
  const filled = m.fillFromKrc20(kcc20({ tick: "NACHO", meta: undefined }), [
    { symbol: "NACHO", decimals: 8, logoURI: LOGO },
    { symbol: "KASPY", decimals: 8, logoURI: "x" },
  ]);
  expect(filled.meta?.decimals).toBeUndefined();
  expect(filled.meta).toEqual({
    symbol: "NACHO",
    name: "NACHO",
    logoURI: LOGO,
    unverified: true,
  });
});

test("an ambiguous or missing namesake fills nothing", () => {
  const token = kcc20({ tick: "NACHO" });
  const twice = [
    { symbol: "NACHO", decimals: 8, logoURI: LOGO },
    { symbol: "nacho", decimals: 0, logoURI: "y" },
  ];
  expect(m.fillFromKrc20(token, twice)).toBe(token);
  const nameless = kcc20({});
  expect(m.fillFromKrc20(nameless, [{ symbol: "NACHO" }])).toBe(nameless);
});

test("a field the KCC-20 row sets is never overwritten", () => {
  const filled = m.fillFromKrc20(
    kcc20({
      tick: "NACHO",
      meta: {
        symbol: "NACHO",
        name: "Nacho the Kat",
        decimals: 6,
        unverified: true,
      },
    }),
    [{ symbol: "NACHO", decimals: 8, logoURI: LOGO }],
  );
  expect(filled.meta).toEqual({
    symbol: "NACHO",
    name: "Nacho the Kat",
    decimals: 6,
    logoURI: LOGO,
    unverified: true,
  });
});
