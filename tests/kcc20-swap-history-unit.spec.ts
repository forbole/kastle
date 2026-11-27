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
    // Logos resolve to their basename so a spec can tell kaspa.svg from
    // igra.svg; the empty loader made every network mark undefined.
    plugins: [
      {
        name: "svg-basename",
        setup(b) {
          b.onLoad({ filter: /\.svg$/ }, (args) => ({
            contents: `export default ${JSON.stringify(path.basename(args.path))};`,
            loader: "js",
          }));
        },
      },
    ],
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
    // The covenant id that prices the token leg, carried to the row's meta.
    tokenId: MAGPIE_ID,
  });
  expect(m.mapSwapActivity(buy!).meta?.tokenId).toBe(MAGPIE_ID);
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

test("a token no source names is still a row: unknown symbol, no token amount", async () => {
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
  expect(built.swaps.length).toBeGreaterThan(0);
  for (const s of built.swaps) {
    const token = s.fromSymbol === "KAS" ? s.toSymbol : s.fromSymbol;
    expect(token).toBe(m.UNKNOWN_TOKEN_SYMBOL);
    // The sentinel, never base units dressed as display units.
    expect(s.fromSymbol === "KAS" ? s.toAmount : s.fromAmount).toBe("0");
  }
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
  const activity = m.toActivityItem(desc, {
    logoFor: () => undefined,
    priceFor: () => undefined,
  });
  // The KAS leg of a KCC-20 swap is native L1: Kaspa mark, never Igra's.
  expect(activity.chainImage).toBe("kaspa.svg");
  expect(activity.sheet.transfer.fromChainImage).toBe("kaspa.svg");
  expect(activity.sheet.transfer.toChainImage).toBe("kaspa.svg");
  const item = JSON.stringify(activity);
  // KCC-20 operations open on kascov, never the Kaspa explorer.
  expect(item).toContain(`https://kascov.io/#/mainnet/tx/${BUY_TXID}`);
  expect(item).not.toContain("explorer.kaspa.org");
});

test("chain logo: an Igra EVM swap, or one with no chainId, keeps the Igra mark", () => {
  const deps = { logoFor: () => undefined, priceFor: () => undefined };
  for (const chainId of [38833, undefined]) {
    const desc = m.mapSwapActivity(
      buyRow({ id: "0xevm", fromSymbol: "iKAS", toSymbol: "ZEAL", chainId }),
    );
    const activity = m.toActivityItem(desc, deps);
    expect(activity.chainImage).toBe("igra.svg");
    expect(activity.sheet.transfer.fromChainImage).toBe("igra.svg");
    expect(activity.sheet.transfer.toChainImage).toBe("igra.svg");
  }
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
      unattributed: 0,
    },
  );
  expect(out.swaps.map((s) => s.id)).toEqual([`kcc20:${BUY_TXID}:14`]);
  expect(out.degraded).toEqual([
    "swap_history_kcc20_partial",
    "swap_history_kcc20_unattributed",
  ]);
});

test("merge: no KCC-20 family (disabled or loading) returns the EVM result as is", () => {
  const e = evm();
  expect(m.mergeKcc20SwapHistory(e, null)).toBe(e);
});

// TWO_TOKEN_TX's second covenant, as a token kascov lists in the same buy.
const OTHER_ID = "c0ffee" + "0".repeat(58);

test("two tokens in one transaction: two rows, never one merged row, and no read", async () => {
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

  // One unnamed: still two rows (the other an unknown token), so the read is
  // still refused — it would print both tokens' KAS and fees as MAGPIE's.
  const one = build([magpie]);
  expect(one.map((s) => s.toSymbol).sort()).toEqual([
    "MAGPIE",
    m.UNKNOWN_TOKEN_SYMBOL,
  ]);
  const rows2 = m.applyKcc20SwapMoney(
    one,
    await m.fetchKcc20SwapMoney(BUY_WALLET, one),
  );
  expect(rows2).toEqual(one);
  expect(rows2.every((r) => r.fromAmount === "0" && !r.feeAmount)).toBe(true);
  expect(seen).toEqual([]);
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

// ─── Received leg USD (QA7 item 1) ──────────────────────────────────────────

const sheetPriced = (
  prices: Record<string, number>,
  row: SwapActivityRecord = kronRow(),
) =>
  m.toActivityItem(m.mapSwapActivity(row), {
    logoFor: () => undefined,
    priceFor: (s: string) => prices[s.toUpperCase()],
  }).sheet.transfer;

test("a KCC-20 swap's received token is priced by its covenant id", () => {
  const t = sheetPriced({ [KRON_ID.toUpperCase()]: 0.0002 });
  expect(t.receivedAmount).toBe("1,917 KRON");
  expect(t.receivedUsd).toMatch(/^≈ \$\S+ USD$/);
});

test('a received amount with no price says "Price unavailable"; an unread received leg says so', () => {
  expect(sheetPriced({}).receivedUsd).toBe("Price unavailable");
  // A KRC-20 ticker sharing the symbol is not the token's price.
  expect(sheetPriced({ KRON: 5 }).receivedUsd).toBe("Price unavailable");
  // No received amount read: the line says so, and no amount has no price.
  const empty = sheetPriced({}, { ...kronRow(), toAmount: "0" });
  expect("receivedUsd" in empty).toBe(false);
  expect(empty.receivedAmount).toBe("Amount unavailable");
});

// ─── venues: KaspaRocket, Braid, unknown (swap-activity-venues) ─────────────

// Real, captured 2026-11-27 from kascov /transfers?owner=<bare pk> and
// api.kaspa.org /transactions/{txid}, trimmed to the fields read. One wallet:
// a KaspaRocket GUZA buy, a Braid sell deposit, a Braid buy settled at KasForge.
const VENUES = fixture("kascov-transfers-venues-bare-05a0b9.json");
const GUZA_TX = fixture("kaspa-tx-kasparocket-guza-buy.json");
const BRAID_SELL_TX = fixture("kaspa-tx-braid-sell-deposit.json");
const BRAID_SETTLE_TX = fixture("kaspa-tx-braid-buy-settle.json");
const BRAID_DEPOSIT_TX = fixture("kaspa-tx-braid-buy-deposit.json");
const VENUE_WALLET = KRON_WALLET;
const VENUE_PK =
  "05a0b96e3768d6c140840c1e6147fcc739b0d53936dc0082971f3a1db845025c";
const VENUE_TIP = { daa: 603303261, atMs: 1795750893029 };
const GUZA_ID =
  "3cb7bd371ea2014af95f3471d2995ede8ffbde454d3a37e3b566880daf011c5a";
const GUZA_TXID = GUZA_TX.transaction_id as string;
const BRAID_SELL_TXID = BRAID_SELL_TX.transaction_id as string;
const BRAID_SETTLE_TXID = BRAID_SETTLE_TX.transaction_id as string;

/** The venues page built with `tokens`: no token list, holdings or pool cache — a cold start. */
async function venueRecords(
  transfers: unknown = VENUES,
  tokens: Map<string, { symbol: string; decimals?: number }> = new Map(),
) {
  route([
    [
      `${KASCOV}/addr/`,
      {
        token_holdings: [],
        tip_daa: VENUE_TIP.daa,
        tip_at_ms: VENUE_TIP.atMs,
      },
    ],
    [`${KASCOV}/transfers`, transfers],
  ]);
  const fetched = await m.fetchKcc20SwapTransfers(VENUE_WALLET, [VENUE_PK]);
  return m.buildKcc20SwapRecords({
    rows: fetched.rows,
    own: new Set([VENUE_PK, `presence:${VENUE_PK}`]),
    tip: fetched.tip!,
    tokens,
  });
}

test("KaspaRocket buy (real row) is a row on a cold start: no pool cache, no token name or decimals", async () => {
  const built = await venueRecords();
  const guza = built.swaps.find((s) => s.txHash === GUZA_TXID);
  // The venue is the transaction's own: kascov's "KaspaRocket lp-amm v1".
  expect(guza).toMatchObject({
    fromSymbol: "KAS",
    toSymbol: m.UNKNOWN_TOKEN_SYMBOL,
    toAmount: "0",
    status: "completed",
    providerId: "kasparocket",
    tokenId: GUZA_ID,
  });
  const provider = sheetOf(guza!).details.find((d) => d.label === "Provider");
  expect(provider?.value).toBe("KaspaRocket");

  // Named with its 3 display decimals: 523717 base units are 523.717 GUZA.
  const named = await venueRecords(
    VENUES,
    new Map([[GUZA_ID, { symbol: "GUZA", decimals: 3 }]]),
  );
  expect(named.swaps.find((s) => s.txHash === GUZA_TXID)?.toAmount).toBe(
    "523.717",
  );

  // It spends two Braid deposits' change, which is the wallet's own: not Braid.
  const seen = route([[`${KASPA_TX}${GUZA_TXID}`, GUZA_TX]]);
  expect(await m.fetchBraidTxids(VENUE_WALLET, [GUZA_TXID])).toEqual({
    braid: new Set(),
    unread: 0,
    deposits: new Map(),
  });
  expect(seen).toHaveLength(1);
});

test("Braid sell (real deposit): no swap row until its BRT1 payload is read, then a Braid row", async () => {
  const built = await venueRecords();
  // kascov sees a token sent to a script owner, which any P2SH may be.
  expect(built.swaps.some((s) => s.txHash === BRAID_SELL_TXID)).toBe(false);
  const seen = route([[`${KASPA_TX}${BRAID_SELL_TXID}`, BRAID_SELL_TX]]);
  const txids = m.braidCandidateTxids(built.swaps, built.braidSells);
  expect(txids).toContain(BRAID_SELL_TXID);
  const { braid } = await m.fetchBraidTxids(VENUE_WALLET, [BRAID_SELL_TXID]);
  expect(seen).toHaveLength(1);
  const rows = m.applyBraidTxids(built.swaps, built.braidSells, braid);
  const sell = rows.find((s) => s.txHash === BRAID_SELL_TXID);
  expect(sell).toMatchObject({
    fromSymbol: m.UNKNOWN_TOKEN_SYMBOL,
    toSymbol: "KAS",
    status: "completed",
    providerId: "braid",
  });
  expect(
    sheetOf(sell!).details.find((d) => d.label === "Provider")?.value,
  ).toBe("Braid");

  // A pending record for the same deposit already shows it: one row, not two.
  const pending = { ...sell!, id: "braid:ref", status: "pending" as const };
  expect(
    m
      .applyBraidTxids(built.swaps, built.braidSells, braid, [pending])
      .some((s) => s.txHash === BRAID_SELL_TXID),
  ).toBe(false);

  // A send to a script that is not a Braid deposit stays out.
  route([[`${KASPA_TX}${BRAID_SELL_TXID}`, { ...BRAID_SELL_TX, payload: "" }]]);
  m.clearKcc20SwapMoneyCache();
  const { braid: none } = await m.fetchBraidTxids(VENUE_WALLET, [
    BRAID_SELL_TXID,
  ]);
  expect(
    m
      .applyBraidTxids(built.swaps, built.braidSells, none)
      .some((s) => s.txHash === BRAID_SELL_TXID),
  ).toBe(false);
});

test("Braid sell refunded: the token back from the same router note marks it failed", async () => {
  const [deposit] = VENUES.transfers.filter(
    (r: { txid: string }) => r.txid === BRAID_SELL_TXID,
  );
  const [move] = deposit.attribution.movements;
  const refund = {
    ...deposit,
    txid: "ab".repeat(32),
    seq: deposit.seq + 1,
    accepting_daa: deposit.accepting_daa + 100,
    attribution: {
      ...deposit.attribution,
      owner_from: move.owner_to,
      movements: [{ ...move, owner_from: move.owner_to, owner_to: VENUE_PK }],
    },
  };
  const built = await venueRecords({
    ...VENUES,
    transfers: [refund, ...VENUES.transfers],
  });
  expect(
    built.braidSells.find((s) => s.txHash === BRAID_SELL_TXID)?.status,
  ).toBe("failed");
});

test("Braid buy (real settle): kascov names KasForge's market, the spent deposit names Braid", async () => {
  const built = await venueRecords();
  const before = built.swaps.find((s) => s.txHash === BRAID_SETTLE_TXID);
  expect(before).toMatchObject({ fromSymbol: "KAS", providerId: "kasforge" });
  const seen = route([
    [`${KASPA_TX}${BRAID_SETTLE_TXID}`, BRAID_SETTLE_TX],
    [`${KASPA_TX}${BRAID_DEPOSIT_TX.transaction_id}`, BRAID_DEPOSIT_TX],
  ]);
  const { braid } = await m.fetchBraidTxids(VENUE_WALLET, [BRAID_SETTLE_TXID]);
  // The settle, then the deposit its router-coin input came from.
  expect(seen).toHaveLength(2);
  const [row] = m
    .applyBraidTxids(built.swaps, built.braidSells, braid)
    .filter((s) => s.txHash === BRAID_SETTLE_TXID);
  expect(row).toMatchObject({ providerId: "braid", status: "completed" });
  expect(sheetOf(row).details.find((d) => d.label === "Provider")?.value).toBe(
    "Braid",
  );
  // A confirmed answer is final: a second ask reads nothing.
  const again = route([]);
  expect(await m.fetchBraidTxids(VENUE_WALLET, [BRAID_SETTLE_TXID])).toEqual({
    braid: new Set([BRAID_SETTLE_TXID]),
    unread: 0,
    deposits: new Map(),
  });
  expect(again).toEqual([]);
});

test("an unknown venue (no market build) is still a row, its Provider Unknown", async () => {
  const unbuilt = {
    ...VENUES,
    transfers: VENUES.transfers.map((r: { verified_market?: object }) => ({
      ...r,
      verified_market: { ...r.verified_market, build: undefined },
    })),
  };
  const built = await venueRecords(unbuilt);
  const guza = built.swaps.find((s) => s.txHash === GUZA_TXID);
  expect(guza).toBeDefined();
  expect(guza!.providerId).toBeUndefined();
  expect(
    sheetOf(guza!).details.find((d) => d.label === "Provider")?.value,
  ).toBe("Unknown");
});

// ─── PR #505 review (Copilot) ───────────────────────────────────────────────

test("a named token with no decimals keeps its name on the sheet; the amount stays absent", async () => {
  // Named (a verified-list ticker, e.g. a token no longer held) but no scale.
  const built = await venueRecords(
    VENUES,
    new Map([[GUZA_ID, { symbol: "GUZA" }]]),
  );
  const guza = built.swaps.find((s) => s.txHash === GUZA_TXID)!;
  const t = sheetOf(guza).transfer;
  expect(t.toSymbol).toBe("GUZA");
  // The amount was not observed: said so, never "0 GUZA".
  expect(t.receivedAmount).toBe("Amount unavailable");
  // A sell draws the Paid leg even unread: the name, beside a "-" amount.
  const sellToken = built.braidSells.find(
    (s) => s.txHash === BRAID_SELL_TXID,
  )!.tokenId!;
  const sell = (
    await venueRecords(VENUES, new Map([[sellToken, { symbol: "BRD" }]]))
  ).braidSells.find((s) => s.txHash === BRAID_SELL_TXID)!;
  expect(sheetOf(sell).transfer).toMatchObject({
    fromSymbol: "BRD",
    sentAmount: "-",
  });
  // A token nothing names says so, rather than "-".
  const cold = (await venueRecords()).swaps.find(
    (s) => s.txHash === GUZA_TXID,
  )!;
  expect(sheetOf(cold).transfer.toSymbol).toBe(m.UNKNOWN_TOKEN_SYMBOL);
});

test("a Braid read that fails is reported unread, never answered 'not Braid'", async () => {
  route([[`${KASPA_TX}${BRAID_SELL_TXID}`, 500]]);
  const down = await m.fetchBraidTxids(VENUE_WALLET, [BRAID_SELL_TXID]);
  expect(down.braid).toEqual(new Set());
  expect(down.unread).toBe(1);
  // The settle reads, its parent deposit does not: still unknown.
  route([
    [`${KASPA_TX}${BRAID_SETTLE_TXID}`, BRAID_SETTLE_TX],
    [`${KASPA_TX}${BRAID_DEPOSIT_TX.transaction_id}`, 500],
  ]);
  const parentDown = await m.fetchBraidTxids(VENUE_WALLET, [BRAID_SETTLE_TXID]);
  expect(parentDown.unread).toBe(1);
  // A failure is not cached: the next read answers.
  route([[`${KASPA_TX}${BRAID_SELL_TXID}`, BRAID_SELL_TX]]);
  const up = await m.fetchBraidTxids(VENUE_WALLET, [BRAID_SELL_TXID]);
  expect(up).toMatchObject({ braid: new Set([BRAID_SELL_TXID]), unread: 0 });
  // The family carries it to the page as a warning of its own.
  const out = m.mergeKcc20SwapHistory(
    { swaps: [], degraded: [] },
    { swaps: [], health: "ok", unattributed: 0, braidUnread: down.unread },
  );
  expect(out.degraded).toEqual(["swap_history_kcc20_braid_unread"]);
});

test("a BRT1 parent is Braid only through its router coin, not another output", async () => {
  // Someone else's Braid deposit change (a plain P2PK output of a BRT1
  // transaction) spent by the settle: the deposit is real, the coin is not its router's.
  const OTHER =
    "kaspa:qrs2vdyfkcg0ws3r0npxu0zrs2klmv3fqvu7l9ncz8m5wg5y6u2cqah8c2m4y";
  const deposit = structuredClone(BRAID_DEPOSIT_TX);
  deposit.outputs[1].script_public_key_address = OTHER;
  const settle = structuredClone(BRAID_SETTLE_TX);
  const spent = settle.inputs.find(
    (i: { previous_outpoint_hash: string }) =>
      i.previous_outpoint_hash === deposit.transaction_id,
  );
  spent.previous_outpoint_index = 1;
  spent.previous_outpoint_address = OTHER;
  spent.previous_outpoint_amount = deposit.outputs[1].amount;
  route([
    [`${KASPA_TX}${BRAID_SETTLE_TXID}`, settle],
    [`${KASPA_TX}${deposit.transaction_id}`, deposit],
  ]);
  const res = await m.fetchBraidTxids(VENUE_WALLET, [BRAID_SETTLE_TXID]);
  expect(res.braid).toEqual(new Set());
  expect(res.unread).toBe(0);
});

test("a pending Braid sell with no token decimals stays pending, never completed", async () => {
  const built = await venueRecords();
  const chain = built.braidSells.find((s) => s.txHash === BRAID_SELL_TXID)!;
  const walletJson = JSON.stringify({
    version: 1,
    inputs: [
      {
        transactionId: "aa".repeat(32),
        index: 0,
        sequence: "0",
        sigOpCount: 1,
        signatureScript: "",
        utxo: {
          address: null,
          amount: "300000000",
          scriptPublicKey: `000020${VENUE_PK}ac`,
          blockDaaScore: "1",
          isCoinbase: false,
        },
      },
    ],
    outputs: [{ value: "299000000", scriptPublicKey: `000020${VENUE_PK}ac` }],
    subnetworkId: "00".repeat(20),
    lockTime: "0",
    gas: "0",
    payload: "",
  });
  const pending = m.braidPendingRecords(
    [
      {
        ref: "ref-sell",
        pairKey: `${VENUE_PK}:${chain.tokenId}`,
        startedAt: VENUE_TIP.atMs,
        prepared: {
          userPublicKey: VENUE_PK,
          depositTxid: BRAID_SELL_TXID,
          from: { id: chain.tokenId!, symbol: "BRD" },
          to: { id: "", symbol: "KAS" },
          amountIn: "1000",
          walletJson,
        },
      } as unknown as Parameters<typeof m.braidPendingRecords>[0][number],
    ],
    VENUE_PK,
    // Named, but no source gives its scale.
    new Map([[chain.tokenId!, { symbol: "BRD" }]]),
  );
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    status: "pending",
    fromSymbol: "BRD",
    toSymbol: "KAS",
    txHash: BRAID_SELL_TXID,
  });
  // As the hook composes them: the chain's confirmed deposit defers to the
  // local record, so the trade reads in flight.
  const rows = [
    ...pending,
    ...m.applyBraidTxids(
      built.swaps,
      built.braidSells,
      new Set([BRAID_SELL_TXID]),
      pending,
    ),
  ].filter((s) => s.txHash === BRAID_SELL_TXID);
  expect(rows.map((s) => s.status)).toEqual(["pending"]);
  expect(sheetOf(rows[0]).transfer.fromSymbol).toBe("BRD");
});

// ─── Braid swaps complete in the list and the sheet ─────────────────────────

test("Braid sell: the deposit already read gives the row its network fee", async () => {
  const built = await venueRecords();
  const seen = route([[`${KASPA_TX}${BRAID_SELL_TXID}`, BRAID_SELL_TX]]);
  const { braid, deposits } = await m.fetchBraidTxids(VENUE_WALLET, [
    BRAID_SELL_TXID,
  ]);
  // No request beyond the one that names it Braid.
  expect(seen).toHaveLength(1);
  // 844387220 in − 842560820 out; router coin = output 1, 1 KAS.
  expect(deposits.get(BRAID_SELL_TXID)).toEqual({
    networkFeeSompi: 1826400n,
    coin: {
      index: 1,
      address:
        "kaspa:ppkq7uays9fjnfyzpxpj0ncz3azksrecsx8z6d7w9rxvxtqxngxts5fkpg2r9",
      amountSompi: 100000000n,
    },
  });
  const sell = m
    .applyBraidTxids(built.swaps, built.braidSells, braid, [], deposits)
    .find((s) => s.txHash === BRAID_SELL_TXID)!;
  expect(sell).toMatchObject({ feeAmount: "0.018264", feeSymbol: "KAS" });
  expect(
    sheetOf(sell).details.find((d) => d.label === "Network fee")?.value,
  ).toBe("0.018 KAS"); // fmtFee caps the sheet at 3 dp
});

// api.kaspa.org /addresses/{router coin}/full-transactions?resolve_previous_outpoints=light&limit=10
// for BRAID_SELL_TX's coin, read live 2026-11-27 and trimmed to the fields read:
// the deposit and its settle 568d41…, which pays the wallet 10.18004 KAS.
const BRAID_SELL_COIN = fixture(
  "kaspa-addr-braid-sell-coin.live-2026-11-27.json",
);
const KASPA_ADDR = "https://api.kaspa.org/addresses/";

async function braidSell(
  listing: unknown,
  tokens?: Map<string, { symbol: string; decimals?: number }>,
) {
  const built = await venueRecords(VENUES, tokens);
  route([
    [`${KASPA_TX}${BRAID_SELL_TXID}`, BRAID_SELL_TX],
    [KASPA_ADDR, listing],
  ]);
  const { braid, deposits } = await m.fetchBraidTxids(VENUE_WALLET, [
    BRAID_SELL_TXID,
  ]);
  const seen = route([[KASPA_ADDR, listing]]);
  const settles = await m.fetchBraidSellSettles(VENUE_WALLET, deposits);
  const row = m
    .applyBraidTxids(
      built.swaps,
      built.braidSells,
      braid,
      [],
      deposits,
      settles,
    )
    .find((s) => s.txHash === BRAID_SELL_TXID)!;
  return { row, settles, seen };
}

test("Braid sell (live settle): Received net of the router coin, bond and both fees", async () => {
  const { row, settles, seen } = await braidSell(BRAID_SELL_COIN);
  // One request: the coin's listing carries the settle whole.
  expect(seen).toHaveLength(1);
  expect(seen[0]).toContain(
    "/addresses/kaspa%3Appkq7uays9fjnfyzpxpj0ncz3azksrecsx8z6d7w9rxvxtqxngxts5fkpg2r9/full-transactions",
  );
  // 1018004000 to the wallet − 100000000 coin − 50000000 freed note bond
  // − 1826400 deposit fee; settle fee 4239874067435 in − 4239864581435 out.
  expect(settles.get(BRAID_SELL_TXID)).toEqual({
    state: "done",
    kasSompi: 866177600n,
    settleFeeSompi: 9486000n,
  });
  expect(row).toMatchObject({
    toSymbol: "KAS",
    toAmount: "8.661776",
    status: "completed",
    // 1826400 + 9486000
    feeAmount: "0.113124",
    feeSymbol: "KAS",
  });
  const item = m.toActivityItem(m.mapSwapActivity(row), {
    logoFor: () => undefined,
    priceFor: () => undefined,
  });
  // fmtAmount caps the list and sheet at 3 dp; the record keeps all 8.
  expect(item.amountNumber).toBe("+8.662");
  expect(item.amountSymbol).toBe("KAS");
  expect(item.tone).toBe("credit");
  expect(item.sheet.transfer.receivedAmount).toBe("8.662 KAS");
  // No decimals for this token on a cold start: Rate needs both legs.
  expect(item.sheet.details.find((d) => d.label === "Rate")?.value).toBe("-");
  // Scaled, both legs exist and Rate follows.
  m.clearKcc20SwapMoneyCache();
  const scaled = await braidSell(
    BRAID_SELL_COIN,
    new Map([[row.tokenId!, { symbol: "BRD", decimals: 8 }]]),
  );
  const sheet = sheetOf(scaled.row);
  expect(sheet.details.find((d) => d.label === "Rate")?.value).toMatch(
    /^1 BRD ≈ [\d.,]+ KAS$/,
  );
  // Final: the second ask reads nothing.
  const again = route([]);
  expect(
    (
      await m.fetchBraidSellSettles(
        VENUE_WALLET,
        new Map([[BRAID_SELL_TXID, {}]]),
      )
    ).get(BRAID_SELL_TXID)?.state,
  ).toBe("done");
  expect(again).toEqual([]);
});

test("Braid sell: no accepted spender is Pending, never Completed", async () => {
  const depositOnly = BRAID_SELL_COIN.filter(
    (t: { transaction_id: string }) => t.transaction_id === BRAID_SELL_TXID,
  );
  const { row } = await braidSell(depositOnly);
  expect(row.status).toBe("pending");
  expect(row.toAmount).toBe("0");
  // The settle in a block not accepted is not a settle either.
  const unaccepted = BRAID_SELL_COIN.map((t: object) => ({
    ...t,
    is_accepted: false,
  }));
  expect((await braidSell(unaccepted)).row.status).toBe("pending");
  // Not cached: once accepted, the next read finds it.
  const { row: later } = await braidSell(BRAID_SELL_COIN);
  expect(later.status).toBe("completed");
});

test("Braid sell: a settle that pays nothing for the token is failed; a batched one is refused", async () => {
  const settleOf = (
    f: (t: { inputs: object[]; outputs: { amount: number }[] }) => void,
  ) =>
    BRAID_SELL_COIN.map((t: { transaction_id: string }) => {
      if (t.transaction_id === BRAID_SELL_TXID) return t;
      const c = structuredClone(t) as never;
      f(c);
      return c;
    });
  // Refund shape: only the coin back, less the settle fee.
  const refund = settleOf((t) => {
    t.outputs[2].amount = 90514000;
    t.outputs[1].amount += 1018004000 - 90514000;
  });
  expect((await braidSell(refund)).row.status).toBe("failed");
  m.clearKcc20SwapMoneyCache(); // the refund is final, so it was cached
  // Someone else's plain input: the fee is not the wallet's alone.
  const batched = settleOf((t) => {
    t.inputs.push({
      previous_outpoint_hash: "cd".repeat(32),
      previous_outpoint_index: "0",
      previous_outpoint_address:
        "kaspa:qrs2vdyfkcg0ws3r0npxu0zrs2klmv3fqvu7l9ncz8m5wg5y6u2cqah8c2m4y",
      previous_outpoint_amount: 1000,
      covenant_id: null,
    });
  });
  const { row, settles } = await braidSell(batched);
  expect(settles.size).toBe(0);
  expect(row).toMatchObject({ toAmount: "0", feeAmount: "0.018264" });
});

test("Braid sell, settle unread: Received drawn as Amount unavailable, KAS named, Kastle fee 0 KAS", async () => {
  const built = await venueRecords();
  const sell = m
    .applyBraidTxids(built.swaps, built.braidSells, new Set([BRAID_SELL_TXID]))
    .find((s) => s.txHash === BRAID_SELL_TXID)!;
  const sheet = sheetOf(sell);
  expect(sheet.title).toBe(`Swap ${m.UNKNOWN_TOKEN_SYMBOL} → KAS`);
  expect(sheet.transfer).toMatchObject({
    receivedLabel: "Received",
    receivedAmount: "Amount unavailable",
    toSymbol: "KAS",
  });
  expect(sheet.details.find((d) => d.label === "Kastle fee")?.value).toBe(
    "0 KAS",
  );
  // Failed delivered nothing: "-", not "unavailable".
  expect(sheetOf({ ...sell, status: "failed" }).transfer.receivedAmount).toBe(
    "-",
  );
  // In flight: the line says what is coming.
  expect(sheetOf({ ...sell, status: "pending" }).transfer.receivedLabel).toBe(
    "You'll receive",
  );
  // A KRON row that paid no cut still shows no Kastle fee row.
  const kron = built.swaps.find((s) => s.providerId !== "braid")!;
  expect(sheetOf(kron).details.some((d) => d.label === "Kastle fee")).toBe(
    false,
  );
});

test("a token the wallet sold out of is named and scaled from KRON's registry", async () => {
  const cold = await venueRecords();
  const tokenId = cold.braidSells.find(
    (s) => s.txHash === BRAID_SELL_TXID,
  )!.tokenId!;
  expect(
    cold.braidSells.find((s) => s.txHash === BRAID_SELL_TXID),
  ).toMatchObject({ fromSymbol: m.UNKNOWN_TOKEN_SYMBOL, fromAmount: "0" });
  // Not held, not in the verified list: the registry (upper-case id) alone.
  const registry = [
    {
      covenantId: tokenId.toUpperCase(),
      entry: { symbol: "BRD", decimals: 8 },
    },
  ];
  const named = await venueRecords(
    VENUES,
    m.kcc20SwapTokenMeta([], [], registry),
  );
  const sell = named.braidSells.find((s) => s.txHash === BRAID_SELL_TXID)!;
  expect(sell.fromSymbol).toBe("BRD");
  expect(Number(sell.fromAmount)).toBeGreaterThan(0);
  expect(sheetOf(sell).transfer.sentAmount).toMatch(/ BRD$/);
  // An earlier source wins; the registry fills only what it left out.
  expect(
    m
      .kcc20SwapTokenMeta(
        [{ covenantId: tokenId, meta: { symbol: "MINE" } }],
        [],
        registry,
      )
      .get(tokenId),
  ).toEqual({ symbol: "MINE", decimals: 8 });
});

test("Braid buy: money and Braid reads share one transaction cache; Paid, fee, Provider filled", async () => {
  const built = await venueRecords();
  const seen = route([
    [`${KASPA_TX}${BRAID_SETTLE_TXID}`, BRAID_SETTLE_TX],
    [`${KASPA_TX}${BRAID_DEPOSIT_TX.transaction_id}`, BRAID_DEPOSIT_TX],
  ]);
  // Both SWR entries fire on the same render.
  const [money, { braid }] = await Promise.all([
    m.fetchKcc20SwapMoney(
      VENUE_WALLET,
      built.swaps.filter((s) => s.txHash === BRAID_SETTLE_TXID),
    ),
    m.fetchBraidTxids(VENUE_WALLET, [BRAID_SETTLE_TXID]),
  ]);
  // The settle and its deposit, once each — not once per reader.
  const txidOf = (u: string) => /transactions\/([0-9a-f]{64})/.exec(u)?.[1];
  expect(seen.map(txidOf).sort()).toEqual(
    [BRAID_SETTLE_TXID, BRAID_DEPOSIT_TX.transaction_id].sort(),
  );
  const [row] = m
    .applyBraidTxids(
      m.applyKcc20SwapMoney(built.swaps, money),
      built.braidSells,
      braid,
    )
    .filter((s) => s.txHash === BRAID_SETTLE_TXID);
  // Hand-computed from the two fixtures (the plan's figures): the deposit
  // funds the router coin, so its fee joins the settle's.
  expect(row).toMatchObject({
    providerId: "braid",
    fromSymbol: "KAS",
    fromAmount: "9.365754",
    feeAmount: "0.090604",
    feeSymbol: "KAS",
  });
  expect(row.kastleFeeAmount).toBeUndefined();
  expect(
    sheetOf(row).details.find((d) => d.label === "Kastle fee")?.value,
  ).toBe("0 KAS");
});
