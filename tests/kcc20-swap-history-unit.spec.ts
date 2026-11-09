import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Kcc20SwapTx } from "@/lib/activity/kcc20-swap-history";
import type { SwapActivityRecord } from "@/lib/activity/mappers";

// The activity modules reach image assets through lib/layer2 and the
// adapters, which Playwright's loader cannot import. esbuild bundles the real
// modules with those assets emptied; nothing under test reads them.
type Modules = typeof import("@/lib/activity/kcc20-swap-history") &
  typeof import("@/lib/activity/mappers") &
  typeof import("@/lib/activity/adapters") &
  typeof import("@/lib/activity/swap-history");

let m: Modules;

const FIXTURES = path.join(
  import.meta.dirname,
  "fixtures",
  "kcc20",
  "activity",
);
const fixture = (name: string) =>
  JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8"));

// api.kaspa.org /transactions/{txid}?inputs&outputs&resolve_previous_outpoints=light,
// captured 2026-11-02 (copied from kastle-mobile), trimmed to the fields read.
const BUY_TX = fixture("kaspa-tx-kcc20-buy.json");
const SELL_TX = fixture("kaspa-tx-kcc20-sell.json");
// Synthetic: BUY_TX plus a 0.3 KAS input and output under a second token's
// covenant — one transaction trading two tokens, so three covenants.
const TWO_TOKEN_TX = fixture("kaspa-tx-kcc20-two-token.json");
// Real kascov /transfers page for MAGPIE (147dff…), wallet 1d5927…: tx
// b0ee70… is an exact curve buy of 10148861 base units.
const MAGPIE = fixture("transfers-bare-147dff-page1.json");
// Real kascov row for sell tx d67e69…, attribution ambiguous (no token amount).
const AMBIGUOUS_SELL = fixture("kcc20-transfers-ambiguous-sell.json");

const MAGPIE_ID =
  "147dff25df3d7d098dad25e0757bc25300987a9df522c94fe1d76f825bf699db";
const MAGPIE_PK =
  "1d592736aec35948dc05913eb48b3b471a7619a63fca7834ffe974e1401a6dda";
const YELLO_ID =
  "28c8fbf492c8dcb3a909ea2db19e9b2609a23b17858b03a49a82180b077f23bd";
const BUY_WALLET =
  "kaspa:qqw4jfek4mp4jjxuqkgnadyt8dr35ase5clu57p5ll5hfc2qrfka55ze84xgk";
const SELL_WALLET =
  "kaspa:qqnd4ppeky4jjs8z8qpln6u5j9hamdukctp0j3wafl5t9lfythtxjzexg722d";
const BUY_TXID =
  "b0ee70cdd8e8ae13d83eaf3719c1956ea39a52761f4cdb3209ad08f7e6fe33ea";
const TIP = { daa: 580980773, atMs: 1_793_600_000_000 };
const KASCOV = "https://kascov.io/data/mainnet";
const KASPA_TX = "https://api.kaspa.org/transactions/";

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `kcc20-swap-unit-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        "@/lib/activity/kcc20-swap-history",
        "@/lib/activity/mappers",
        "@/lib/activity/adapters",
        "@/lib/activity/swap-history",
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
test.beforeEach(() => m.clearKcc20SwapMoneyCache());
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Prefix → JSON body (or 500). Unmatched URLs reject, as an offline API would. */
function route(routes: [string, unknown][]) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const hit = routes.find(([p]) => url.startsWith(p) || url.includes(p));
    if (!hit) throw new Error(`unmocked ${url}`);
    if (hit[1] === 500) return new Response("", { status: 500 });
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  }) as typeof fetch;
  return seen;
}

const holdingsDoc = {
  token_holdings: [],
  tip_daa: TIP.daa,
  tip_at_ms: TIP.atMs,
};

async function magpieSwaps(transfers: unknown) {
  route([
    [`${KASCOV}/addr/`, holdingsDoc],
    // Any follow-up page is empty, so paging stops after the fixture.
    ["before_daa=", { transfers: [] }],
    [`${KASCOV}/transfers`, transfers],
  ]);
  const fetched = await m.fetchKcc20SwapTransfers("kaspa:test", [MAGPIE_PK]);
  return {
    fetched,
    built: m.buildKcc20SwapRecords({
      rows: fetched.rows,
      own: new Set([MAGPIE_PK, `presence:${MAGPIE_PK}`]),
      tip: TIP,
      tokens: new Map([[MAGPIE_ID, { symbol: "MAGPIE", decimals: 0 }]]),
    }),
  };
}

const sompi = (
  v: {
    kasSompi: bigint;
    networkFeeSompi: bigint;
    venueFeeSompi: bigint;
  } | null,
) =>
  v && {
    kas: String(v.kasSompi),
    networkFee: String(v.networkFeeSompi),
    venueFee: String(v.venueFeeSompi),
  };

// ─── the three transaction fixtures ─────────────────────────────────────────

// Hand-computed from the fixtures, in sompi (kastle-mobile's figures).
// Buy: wallet in 124052513916, change 92886195104, 2 KAS bond → 30966318812;
//   inputs − outputs = network fee 17956980; third-party output 457364953.
// Sell: proceeds net of the freed bond 14212732120; network fee 46586880;
//   third-party outputs 129681000 + 20000000.
test("buy fixture: outlay, network fee and venue cut are three separate numbers", () => {
  expect(sompi(m.deriveKcc20SwapMoney(BUY_TX, BUY_WALLET, "buy"))).toEqual({
    kas: "30966318812",
    networkFee: "17956980",
    venueFee: "457364953",
  });
});

test("sell fixture: proceeds net of both fees", () => {
  expect(sompi(m.deriveKcc20SwapMoney(SELL_TX, SELL_WALLET, "sell"))).toEqual({
    kas: "14212732120",
    networkFee: "46586880",
    venueFee: "149681000",
  });
});

test("two-token fixture: a transaction spanning more than one pair is refused", () => {
  expect(m.deriveKcc20SwapMoney(TWO_TOKEN_TX, BUY_WALLET, "buy")).toBeNull();
});

test("refuses the wrong wallet, the wrong direction, and a third-party funder", () => {
  expect(m.deriveKcc20SwapMoney(BUY_TX, SELL_WALLET, "buy")).toBeNull();
  expect(m.deriveKcc20SwapMoney(BUY_TX, BUY_WALLET, "sell")).toBeNull();
  const tx = {
    ...SELL_TX,
    inputs: [
      ...SELL_TX.inputs,
      { previous_outpoint_address: BUY_WALLET, previous_outpoint_amount: 1 },
    ],
  };
  expect(m.deriveKcc20SwapMoney(tx, SELL_WALLET, "sell")).toBeNull();
});

// The token UTXOs on both fixtures sit at covenant (p2sh) addresses. At the
// wallet's own address they are still bond, never change, so the KAS leg holds.
const atWallet = <T extends { covenant_id?: string | null }>(
  utxos: T[],
  pick: (u: T) => boolean,
  field: "previous_outpoint_address" | "script_public_key_address",
  wallet: string,
) => utxos.map((u) => (pick(u) ? { ...u, [field]: wallet } : u));

test("buy fixture: the KAS leg is plain wallet inputs − plain wallet change − the bond, wherever the token UTXO sits", () => {
  const plainAt = (u: { covenant_id?: string | null }, a?: string) =>
    !u.covenant_id && a === BUY_WALLET;
  const buy: Required<Kcc20SwapTx> = BUY_TX;
  const walletIn = buy.inputs
    .filter((i) => plainAt(i, i.previous_outpoint_address))
    .reduce((n, i) => n + BigInt(i.previous_outpoint_amount!), 0n);
  const change = buy.outputs
    .filter((o) => plainAt(o, o.script_public_key_address))
    .reduce((n, o) => n + BigInt(o.amount!), 0n);
  // The user's new MAGPIE UTXO: 2 KAS under the token's covenant.
  const isBond = (o: { covenant_id?: string | null; amount?: number }) =>
    o.covenant_id === MAGPIE_ID && o.amount === 200_000_000;
  expect(BUY_TX.outputs.filter(isBond)).toHaveLength(1);
  expect(String(walletIn - change - 200_000_000n)).toBe("30966318812");

  const tx = {
    ...BUY_TX,
    outputs: atWallet(
      BUY_TX.outputs,
      isBond,
      "script_public_key_address",
      BUY_WALLET,
    ),
  };
  expect(sompi(m.deriveKcc20SwapMoney(tx, BUY_WALLET, "buy"))).toEqual(
    sompi(m.deriveKcc20SwapMoney(BUY_TX, BUY_WALLET, "buy")),
  );
});

test("sell fixture: spent token UTXOs at the wallet's address are not counted twice", () => {
  const tx = {
    ...SELL_TX,
    inputs: atWallet(
      SELL_TX.inputs,
      (i: { covenant_id?: string | null }) => i.covenant_id === YELLO_ID,
      "previous_outpoint_address",
      SELL_WALLET,
    ),
  };
  expect(sompi(m.deriveKcc20SwapMoney(tx, SELL_WALLET, "sell"))).toEqual({
    kas: "14212732120",
    networkFee: "46586880",
    venueFee: "149681000",
  });
});

// ─── kascov rows → records ──────────────────────────────────────────────────

test("an exact buy becomes a row with the KAS side as the unobserved sentinel", async () => {
  const { fetched, built } = await magpieSwaps(MAGPIE);
  expect(fetched.health).toBe("ok");
  const buy = built.swaps.find((s) => s.id.startsWith(`kcc20:${BUY_TXID}:`));
  expect(buy).toMatchObject({
    fromSymbol: "KAS",
    toSymbol: "MAGPIE",
    fromAmount: "0",
    toAmount: "10148861",
    status: "completed",
    txHash: BUY_TXID,
    chainId: 1,
  });
  // Unenriched: no fee field at all, and never the "-" marker.
  expect(buy?.feeAmount).toBeUndefined();
  expect(buy?.kastleFeeAmount).toBeUndefined();
  expect(buy?.kastleFeeUnobserved).toBeUndefined();
  // The KAS sentinel never renders: the leg is omitted, not "0 KAS".
  expect(m.mapSwapActivity(buy!).sent).toBeUndefined();
});

test("a trade with no attributed token amount is dropped and counted, never 0", async () => {
  // AMBIGUOUS_SELL's token and wallet (kastle-mobile's kcc20-swap-history test).
  const wallet = "a1".repeat(32);
  route([
    [`${KASCOV}/addr/`, holdingsDoc],
    ["before_daa=", { transfers: [] }],
    [`${KASCOV}/transfers`, AMBIGUOUS_SELL],
  ]);
  const fetched = await m.fetchKcc20SwapTransfers("kaspa:test", [
    `presence:${wallet}`,
  ]);
  const built = m.buildKcc20SwapRecords({
    rows: fetched.rows,
    own: new Set([wallet, `presence:${wallet}`]),
    tip: TIP,
    tokens: new Map([[YELLO_ID, { symbol: "YELLO", decimals: 0 }]]),
  });
  expect(built.swaps).toEqual([]);
  expect(built.unattributed).toBe(1);
  for (const s of (await magpieSwaps(MAGPIE)).built.swaps) {
    expect(
      Number(s.fromSymbol === "KAS" ? s.toAmount : s.fromAmount),
    ).toBeGreaterThan(0);
  }
});

test("a token no source names is counted unidentified", async () => {
  route([
    [`${KASCOV}/addr/`, holdingsDoc],
    ["before_daa=", { transfers: [] }],
    [`${KASCOV}/transfers`, MAGPIE],
  ]);
  const fetched = await m.fetchKcc20SwapTransfers("kaspa:test", [MAGPIE_PK]);
  const built = m.buildKcc20SwapRecords({
    rows: fetched.rows,
    own: new Set([MAGPIE_PK]),
    tip: TIP,
    tokens: new Map(),
  });
  expect(built.swaps).toEqual([]);
  expect(built.unidentified).toBeGreaterThan(0);
});

test("kascov down: unreachable, no rows", async () => {
  route([
    [`${KASCOV}/addr/`, 500],
    [`${KASCOV}/transfers`, 500],
  ]);
  const fetched = await m.fetchKcc20SwapTransfers("kaspa:test", [MAGPIE_PK]);
  expect(fetched).toMatchObject({ rows: [], health: "unreachable" });
});

// ─── enrichment ─────────────────────────────────────────────────────────────

function buyRow(over: Partial<SwapActivityRecord> = {}): SwapActivityRecord {
  return {
    id: `kcc20:${BUY_TXID}:14`,
    timestampMs: TIP.atMs,
    fromSymbol: "KAS",
    toSymbol: "MAGPIE",
    fromAmount: "0",
    toAmount: "10148861",
    status: "completed",
    txHash: BUY_TXID,
    chainId: 1,
    ...over,
  };
}

test("buy enrichment: feeAmount is the network fee alone, the cut rides in kastleFeeAmount", async () => {
  route([[`${KASPA_TX}${BUY_TXID}`, BUY_TX]]);
  const swaps = [buyRow()];
  const money = await m.fetchKcc20SwapMoney(BUY_WALLET, swaps);
  const [row] = m.applyKcc20SwapMoney(swaps, money);
  expect(row).toMatchObject({
    fromAmount: "309.66318812",
    feeAmount: "0.1795698",
    feeSymbol: "KAS",
    kastleFeeAmount: "4.57364953",
    kastleFeeSymbol: "KAS",
  });
  const desc = m.mapSwapActivity(row);
  expect(desc.meta?.l2Chain).toBe("Kaspa");
  const item = JSON.stringify(
    m.toActivityItem(desc, {
      logoFor: () => undefined,
      priceFor: () => undefined,
    }),
  );
  expect(item).toContain(`https://explorer.kaspa.org/txs/${BUY_TXID}`);
});

test("two-token transaction: the fetched read is refused and the row keeps its placeholder", async () => {
  route([[`${KASPA_TX}${BUY_TXID}`, TWO_TOKEN_TX]]);
  const swaps = [buyRow()];
  const [row] = m.applyKcc20SwapMoney(
    swaps,
    await m.fetchKcc20SwapMoney(BUY_WALLET, swaps),
  );
  expect(row).toEqual(swaps[0]);
});

test("one transaction, two rows: neither is enriched, not even asked for", async () => {
  const seen = route([[`${KASPA_TX}${BUY_TXID}`, BUY_TX]]);
  const swaps = [
    buyRow(),
    buyRow({ id: `kcc20:${BUY_TXID}:15`, toSymbol: "OTHER" }),
  ];
  expect(m.kcc20SwapMoneyTxids(swaps)).toEqual([]);
  const money = await m.fetchKcc20SwapMoney(BUY_WALLET, swaps);
  expect(seen).toEqual([]);
  // Even handed a read, the shared transaction is not split between rows.
  const forced = new Map([
    [BUY_TXID, m.deriveKcc20SwapMoney(BUY_TX, BUY_WALLET, "buy")!],
  ]);
  expect(m.applyKcc20SwapMoney(swaps, money)).toEqual(swaps);
  expect(m.applyKcc20SwapMoney(swaps, forced)).toEqual(swaps);
});

test("a failed L1 read leaves the row as it was and is not cached", async () => {
  route([[KASPA_TX, 500]]);
  const swaps = [buyRow()];
  expect((await m.fetchKcc20SwapMoney(BUY_WALLET, swaps)).size).toBe(0);
  route([[`${KASPA_TX}${BUY_TXID}`, BUY_TX]]);
  expect((await m.fetchKcc20SwapMoney(BUY_WALLET, swaps)).size).toBe(1);
});

// ─── merge ──────────────────────────────────────────────────────────────────

const evm = (): {
  swaps: SwapActivityRecord[];
  degraded: ReturnType<Modules["mergeSwapHistories"]>["degraded"];
} => ({
  swaps: [
    {
      id: "0xevm",
      timestampMs: 1,
      fromSymbol: "iKAS",
      toSymbol: "ZEAL",
      fromAmount: "1",
      toAmount: "2",
      status: "completed",
    },
  ],
  degraded: ["swap_history_partial"],
});

test("merge: an unreachable KCC-20 family keeps the EVM rows and adds its own token", () => {
  const out = m.mergeKcc20SwapHistory(evm(), {
    swaps: [],
    health: "unreachable",
    unidentified: 0,
    unattributed: 0,
  });
  expect(out.swaps.map((s) => s.id)).toEqual(["0xevm"]);
  expect(out.degraded).toEqual([
    "swap_history_partial",
    "swap_history_kcc20_unavailable",
  ]);
});

test("merge: a malformed KCC-20 row is skipped and counted, the rest survive", () => {
  const bad = { id: "kcc20:bad" } as unknown as SwapActivityRecord;
  const out = m.mergeKcc20SwapHistory(
    { swaps: [], degraded: [] },
    {
      swaps: [bad, buyRow()],
      health: "truncated",
      unidentified: 1,
      unattributed: 0,
    },
  );
  expect(out.swaps.map((s) => s.id)).toEqual([`kcc20:${BUY_TXID}:14`]);
  expect(out.degraded).toEqual([
    "swap_history_kcc20_partial",
    "swap_history_kcc20_unidentified",
    "swap_history_kcc20_unattributed",
  ]);
});

test("merge: no KCC-20 family (disabled or loading) returns the EVM result as is", () => {
  const e = evm();
  expect(m.mergeKcc20SwapHistory(e, null)).toBe(e);
});

// TWO_TOKEN_TX's second covenant, as a token kascov lists in the same buy.
const OTHER_ID = "c0ffee" + "0".repeat(58);

test("two tokens in one transaction: two rows or one refused row, never one merged row", async () => {
  const { fetched } = await magpieSwaps(MAGPIE);
  const rows = [
    ...fetched.rows,
    ...fetched.rows
      .filter((r) => r.txid === BUY_TXID)
      .map((r) => ({ ...r, tokenId: OTHER_ID })),
  ];
  const build = (tokens: [string, { symbol: string; decimals: number }][]) =>
    m
      .buildKcc20SwapRecords({
        rows,
        own: new Set([MAGPIE_PK, `presence:${MAGPIE_PK}`]),
        tip: TIP,
        tokens: new Map(tokens),
      })
      .swaps.filter((s) => s.txHash === BUY_TXID);
  const magpie: [string, { symbol: string; decimals: number }] = [
    MAGPIE_ID,
    { symbol: "MAGPIE", decimals: 0 },
  ];

  // Both named: two rows, one id each, and neither is asked about or enriched.
  const both = build([magpie, [OTHER_ID, { symbol: "OTHER", decimals: 0 }]]);
  expect(both.map((s) => s.toSymbol).sort()).toEqual(["MAGPIE", "OTHER"]);
  expect(new Set(both.map((s) => s.id)).size).toBe(2);
  const seen = route([[`${KASPA_TX}${BUY_TXID}`, TWO_TOKEN_TX]]);
  expect(
    m.applyKcc20SwapMoney(both, await m.fetchKcc20SwapMoney(BUY_WALLET, both)),
  ).toEqual(both);
  expect(seen).toEqual([]);

  // One unnamed: the survivor is the transaction's only row, and the read is
  // still refused — it would print both tokens' KAS and fees as MAGPIE's.
  const one = build([magpie]);
  expect(one).toHaveLength(1);
  const [row] = m.applyKcc20SwapMoney(
    one,
    await m.fetchKcc20SwapMoney(BUY_WALLET, one),
  );
  expect(row).toEqual(one[0]);
  expect(row.fromAmount).toBe("0");
  expect(row.feeAmount).toBeUndefined();
});

// ─── KRON commit → reveal (QA item 5) ───────────────────────────────────────

// api.kaspa.org, captured 2026-11-09, trimmed to the fields read: a real KRON
// pool buy of 1,917 KRON. Its plain input is a P2SH output of the wallet's own
// commit transaction (lib/kcc20/swap.ts), not the wallet's P2PK UTXO.
const KRON_TX = fixture("kaspa-tx-kron-commit-buy.json");
const KRON_COMMIT = fixture("kaspa-tx-kron-commit-buy-commit.json");
const KRON_TXID = KRON_TX.transaction_id as string;
const KRON_COMMIT_TXID = KRON_COMMIT.transaction_id as string;
const KRON_WALLET =
  "kaspa:qqz6pwtwxa5dds2qssxpuc28lnrnnvx48ymdcqyzju0n58dcg5p9c6luwmcyg";
const KRON_ID =
  "7a98370c0d6b037c28089d7b77cd8229120804cb416ef592ddb99e23820544e4";

const kronRow = (): SwapActivityRecord => ({
  id: `kcc20:${KRON_TXID}:8221:${KRON_ID}`,
  timestampMs: TIP.atMs,
  fromSymbol: "KAS",
  toSymbol: "KRON",
  fromAmount: "0",
  toAmount: "1917",
  status: "completed",
  txHash: KRON_TXID,
  providerId: "kron",
  chainId: 1,
});

const sheetOf = (row: SwapActivityRecord) =>
  m.toActivityItem(m.mapSwapActivity(row), {
    logoFor: () => undefined,
    priceFor: () => undefined,
  }).sheet;

test("KRON commit-funded buy (real tx): paid leg, network fee and rate fill; no '-'", async () => {
  // Without its commit the P2SH input reads as a third party's: the old drop.
  expect(m.deriveKcc20SwapMoney(KRON_TX, KRON_WALLET, "buy")).toBeNull();
  const seen = route([
    [`${KASPA_TX}${KRON_TXID}`, KRON_TX],
    [`${KASPA_TX}${KRON_COMMIT_TXID}`, KRON_COMMIT],
  ]);
  const swaps = [kronRow()];
  const [row] = m.applyKcc20SwapMoney(
    swaps,
    await m.fetchKcc20SwapMoney(KRON_WALLET, swaps),
  );
  expect(seen).toHaveLength(2);
  // Hand-computed, sompi: P2SH 1499646400 − change 12812000 − bond 50000000
  // + commit fee 353600; fee = reveal 13834400 + commit 353600.
  expect(row).toMatchObject({
    fromAmount: "14.37188",
    toAmount: "1917",
    feeAmount: "0.14188",
    feeSymbol: "KAS",
    kastleFeeAmount: "0.4",
    kastleFeeSymbol: "KAS",
  });
  const sheet = sheetOf(row);
  expect(sheet.transfer.sentAmount).toBe("14.372 KAS");
  expect(sheet.transfer.receivedAmount).toBe("1,917 KRON");
  const value = (label: string) =>
    sheet.details.find((d) => d.label === label)?.value;
  expect(value("Network fee")).toBe("0.142 KAS");
  expect(value("Rate")).toMatch(/^1 KAS ≈ 133\.38\d* KRON$/);
  expect(value("Provider")).toBe("KRON");
  expect(sheet.details.filter((d) => d.value === "-")).toEqual([]);
});

test("a commit not funded by the wallet alone is still refused", () => {
  const foreign = {
    ...KRON_COMMIT,
    inputs: [
      ...KRON_COMMIT.inputs,
      { previous_outpoint_address: BUY_WALLET, previous_outpoint_amount: 1 },
    ],
  };
  const commits = (c: typeof KRON_COMMIT) => new Map([[KRON_COMMIT_TXID, c]]);
  expect(
    m.deriveKcc20SwapMoney(KRON_TX, KRON_WALLET, "buy", commits(foreign)),
  ).toBeNull();
  expect(
    m.deriveKcc20SwapMoney(KRON_TX, BUY_WALLET, "buy", commits(KRON_COMMIT)),
  ).toBeNull();
  // A commit whose output is not the one the swap spends counts for nothing.
  const reshaped = {
    ...KRON_COMMIT,
    outputs: KRON_COMMIT.outputs.map((o: { amount: number }) => ({
      ...o,
      amount: o.amount - 1,
    })),
  };
  expect(
    m.deriveKcc20SwapMoney(KRON_TX, KRON_WALLET, "buy", commits(reshaped)),
  ).toBeNull();
});

test("a KCC-20 swap and an EVM swap carry the same detail label list", async () => {
  route([
    [`${KASPA_TX}${KRON_TXID}`, KRON_TX],
    [`${KASPA_TX}${KRON_COMMIT_TXID}`, KRON_COMMIT],
  ]);
  const swaps = [kronRow()];
  const [kcc20] = m.applyKcc20SwapMoney(
    swaps,
    await m.fetchKcc20SwapMoney(KRON_WALLET, swaps),
  );
  const evmRow: SwapActivityRecord = {
    id: "0xswap",
    timestampMs: TIP.atMs,
    fromSymbol: "iKAS",
    toSymbol: "NACHO",
    fromAmount: "10",
    toAmount: "3",
    status: "completed",
    txHash: "0xswap",
    providerId: "zealous-swap",
    feeAmount: "0.01",
    feeSymbol: "iKAS",
    kastleFeeAmount: "0.03",
    kastleFeeSymbol: "iKAS",
  };
  const labels = (r: SwapActivityRecord) =>
    sheetOf(r).details.map((d) => d.label);
  expect(labels(kcc20)).toEqual(labels(evmRow));
  expect(labels(evmRow)).toEqual([
    "Status",
    "Network fee",
    "Kastle fee",
    "Rate",
    "Provider",
    "Transaction",
  ]);
  const transfer = (r: SwapActivityRecord) =>
    Object.keys(sheetOf(r).transfer).sort();
  expect(transfer(kcc20)).toEqual(transfer(evmRow));
});
