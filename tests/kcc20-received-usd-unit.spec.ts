import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Kcc20Token } from "@/lib/kcc20";
import type { KronMarkets } from "@/lib/kcc20/swap";
import type { SwapActivityRecord } from "@/lib/activity/mappers";

// The swap detail sheet's Received USD: each KCC-20 token resolved as the
// dashboard resolves it (useKcc20Price), so both show one number. esbuild
// bundles the real modules with assets emptied, as the other unit specs do.
type Modules = typeof import("@/lib/activity/mappers") &
  typeof import("@/lib/activity/adapters") &
  typeof import("@/lib/kcc20/useKcc20Price");
let m: Modules;

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `kcc20-received-usd-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        "@/lib/activity/mappers",
        "@/lib/activity/adapters",
        "@/lib/kcc20/useKcc20Price",
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

// Leo's row (QA): 14.372 KAS → 1,917 KRON, the real tx of
// tests/fixtures/kcc20/activity/kaspa-tx-kron-commit-buy.json.
const KRON_TXID = JSON.parse(
  readFileSync(
    path.join(
      import.meta.dirname,
      "fixtures",
      "kcc20",
      "activity",
      "kaspa-tx-kron-commit-buy.json",
    ),
    "utf8",
  ),
).transaction_id as string;
const KRON_ID =
  "7a98370c0d6b037c28089d7b77cd8229120804cb416ef592ddb99e23820544e4";
// A standard-family token: KRON lists none, kascov's market prices it.
const STD_ID =
  "41d44970ba6307bcec418f677fd253778d0ffa47750d179dff647061aa6c0d40";
// KAS price implied by Leo's Paid line: 14.372 KAS ≈ $0.41170444.
const KAS_USD = 0.41170444 / 14.372;

const buyRow = (
  tokenId: string,
  symbol: string,
  amount: string,
): SwapActivityRecord => ({
  id: `kcc20:${KRON_TXID}:8221:${tokenId}`,
  timestampMs: Date.UTC(2026, 10, 7, 2, 54),
  fromSymbol: "KAS",
  toSymbol: symbol,
  fromAmount: "14.372",
  toAmount: amount,
  status: "completed",
  txHash: KRON_TXID,
  providerId: "kron",
  chainId: 1,
});

const token = (
  covenantId: string,
  family: Kcc20Token["family"],
  meta: Kcc20Token["meta"],
): Kcc20Token => ({
  covenantId,
  family,
  tick: meta?.symbol ?? "",
  amount: 0n,
  spendable: 0n,
  meta,
});

const markets = (
  curves: { covenantId: string; priceKas?: number }[],
  graduated: { covenantId: string; priceKas?: number }[] = [],
) => Object.assign([...curves], { graduated }) as unknown as KronMarkets;

type PriceInput = Parameters<Modules["kcc20UsdPrices"]>[1];

/** The sheet's transfer block, priced as the Activity screen prices it. */
function sheet(
  row: SwapActivityRecord,
  tokens: Kcc20Token[],
  sources: Omit<PriceInput, "kaspaPrice">,
) {
  const prices = new Map<string, number>([["KAS", KAS_USD]]);
  for (const [id, usd] of m.kcc20UsdPrices(tokens, {
    ...sources,
    kaspaPrice: KAS_USD,
  }))
    prices.set(id, usd);
  return m.toActivityItem(m.mapSwapActivity(row), {
    logoFor: () => undefined,
    priceFor: (s) => prices.get(s.toUpperCase()),
  }).sheet.transfer;
}

/** The number a "≈ $0.12345678 USD" line states. */
function usdOf(line: string | undefined): number {
  const match = /^≈ \$([\d,.]+) USD$/.exec(line ?? "");
  expect(match, `not a USD line: ${line}`).not.toBeNull();
  return Number(match![1].replace(/,/g, ""));
}

/**
 * `line` states `usd` as the fiat format rounds it: to the cent at or above
 * $0.01, to four significant digits below (six decimals at most).
 */
function expectUsd(line: string | undefined, usd: number) {
  const shown = usdOf(line);
  if (usd >= 0.01) expect(Math.abs(shown - usd)).toBeLessThanOrEqual(0.005);
  else
    expect(Math.abs(shown - usd)).toBeLessThanOrEqual(
      Math.max(usd * 5e-4, 5e-7),
    );
}

// ─── resolveKcc20Price: useKcc20Price's resolution, exported ─────────────────

test("curve family: KRON's curve, then its graduated pool; the cache only until KRON answers", () => {
  const legacy = token(KRON_ID, "kron-legacy", {
    symbol: "KRON",
    name: "Kron Token",
    decimals: 0,
  });
  const base = { kaspaPrice: KAS_USD, cached: 0.005 };
  expect(
    m.resolveKcc20Price(legacy, {
      ...base,
      markets: markets(
        [{ covenantId: KRON_ID, priceKas: 0.007 }],
        [{ covenantId: KRON_ID, priceKas: 0.006 }],
      ),
    }),
  ).toEqual({ live: 0.007, priceKas: 0.007 });
  expect(
    m.resolveKcc20Price(legacy, {
      ...base,
      markets: markets([], [{ covenantId: KRON_ID, priceKas: 0.006 }]),
    }).priceKas,
  ).toBe(0.006);
  // Not answered: the cached price stands in.
  expect(m.resolveKcc20Price(legacy, base)).toEqual({
    live: undefined,
    priceKas: 0.005,
  });
  // Answered without the token: no price, and no cached one either.
  expect(
    m.resolveKcc20Price(legacy, { ...base, markets: markets([]) }).priceKas,
  ).toBeUndefined();
});

test("standard family: kascov's spot only, never a KRC-20 namesake; null from kascov drops the cache", () => {
  const std = token(STD_ID, "kcc20-standard", {
    symbol: "NACHO",
    name: "NACHO",
    decimals: 8,
    unverified: true,
  });
  const base = { kaspaPrice: KAS_USD, cached: 0.5 };
  expect(m.resolveKcc20Price(std, { ...base, spot: 0.2 }).priceKas).toBe(0.2);
  // kascov has no market: no price, whatever a KRC-20 "NACHO" trades at.
  expect(
    m.resolveKcc20Price(std, {
      ...base,
      spot: null,
      ...({ krc20: [{ symbol: "nacho", price: 0.003 }] } as object),
    }).priceKas,
  ).toBeUndefined();
  expect(m.resolveKcc20Price(std, base).priceKas).toBe(0.5);
  // KRON's markets never price a standard token.
  expect(
    m.resolveKcc20Price(std, {
      ...base,
      spot: null,
      markets: markets([{ covenantId: STD_ID, priceKas: 9 }]),
    }).priceKas,
  ).toBeUndefined();
});

// ─── The sheet's Received USD ────────────────────────────────────────────────

test("a held standard token priced by kascov's spot shows its Received USD (amount × spot × KAS)", () => {
  const std = token(STD_ID, "kcc20-standard", {
    symbol: "NACHO",
    name: "NACHO",
    decimals: 8,
    unverified: true,
  });
  const t = sheet(buyRow(STD_ID, "NACHO", "120.5"), [std], {
    markets: markets([]),
    spots: new Map([[STD_ID, 0.0002]]),
  });
  expect(t.receivedAmount).toBe("120.5 NACHO");
  expectUsd(t.receivedUsd, 120.5 * 0.0002 * KAS_USD);
});

test("Leo's KRON row before KRON's markets answer: the dashboard's cached price, not a missing line", () => {
  const kron = token(KRON_ID, "kron-legacy", {
    symbol: "KRON",
    name: "Kron Token",
    decimals: 0,
  });
  const cachedKas = 0.006708823915842323;
  const t = sheet(buyRow(KRON_ID, "KRON", "1917"), [kron], {
    cached: { [KRON_ID]: cachedKas },
  });
  expect(t.receivedAmount).toBe("1,917 KRON");
  expectUsd(t.receivedUsd, 1917 * cachedKas * KAS_USD);
  // The Paid leg is the KAS amount at the KAS price, as before.
  expectUsd(t.sentUsd, 14.372 * KAS_USD);
});

test("a token no longer held keeps its KRON market price (graduated pool)", () => {
  const t = sheet(buyRow(KRON_ID, "KRON", "1917"), [], {
    markets: markets([], [{ covenantId: KRON_ID, priceKas: 0.0067 }]),
  });
  expectUsd(t.receivedUsd, 1917 * 0.0067 * KAS_USD);
});

test("no source prices the token: the Received line says the price is unavailable", () => {
  const std = token(STD_ID, "kcc20-standard", {
    symbol: "NACHO",
    name: "NACHO",
    decimals: 8,
    unverified: true,
  });
  const t = sheet(buyRow(STD_ID, "NACHO", "120.5"), [std], {
    markets: markets([]),
    // kascov answered: no market; a stale cache entry.
    spots: new Map([[STD_ID, null]]),
    cached: { [STD_ID]: 0.3 },
  });
  expect(t.receivedAmount).toBe("120.5 NACHO");
  expect(t.receivedUsd).toBe("Price unavailable");
  // The Paid leg still shows.
  expectUsd(t.sentUsd, 14.372 * KAS_USD);
});

test("no KAS price yet: no KCC-20 price is made up", () => {
  const prices = m.kcc20UsdPrices([], {
    markets: markets([{ covenantId: KRON_ID, priceKas: 0.007 }]),
    kaspaPrice: 0,
  });
  expect(prices.size).toBe(0);
});

// SWR's default compare (dequal/lite) calls any two Maps equal, so a refreshed
// spot was discarded. sameSpots is the compare the Activity spot fetch uses.
test("sameSpots compares spot Maps by content, not by type", () => {
  const before = new Map<string, number | null>([["abc", 0.2]]);
  expect(m.sameSpots(before, new Map([["abc", 0.3]]))).toBe(false);
  expect(m.sameSpots(before, new Map([["abc", 0.2]]))).toBe(true);
  expect(m.sameSpots(before, new Map([["abc", null]]))).toBe(false);
  expect(m.sameSpots(before, new Map([["xyz", 0.2]]))).toBe(false);
  expect(
    m.sameSpots(
      before,
      new Map([
        ["abc", 0.2],
        ["xyz", 1],
      ]),
    ),
  ).toBe(false);
  expect(m.sameSpots(undefined, before)).toBe(false);
  expect(m.sameSpots(undefined, undefined)).toBe(true);
});

// ─── The list row's USD: the same covenant-id price as the sheet ────────────

// QA wallet 2026-11-26: 77,000 KPEPE (kascov 6c5d77…, a standard token at
// 0.00013132628 KAS) read "≈ $1,374.61 USD" on its Activity row: the row priced
// the leg by ticker, and Igra's ERC-20 "KPEPE" trades at $0.0179.
const KPEPE_ID =
  "6c5d77e7c094412389a07d1d4e96e079e24fc772a8c3e8fa3e134686da9f1a03";

test("a KCC-20 row's list USD is its covenant's price, never a ticker namesake's", () => {
  const kpepe = token(KPEPE_ID, "kcc20-standard", {
    symbol: "KPEPE",
    name: "KPEPE",
    decimals: 0,
  });
  const kas = 0.0266;
  const prices = new Map<string, number>([
    ["KAS", kas],
    // The ERC-20 / KRC-20 symbol map Activity also builds.
    ["KPEPE", 0.017943390347176052],
  ]);
  for (const [id, usd] of m.kcc20UsdPrices([kpepe], {
    spots: new Map([[KPEPE_ID, 0.00013132628]]),
    kaspaPrice: kas,
  }))
    prices.set(id, usd);
  const item = m.toActivityItem(
    m.mapSwapActivity({
      ...buyRow(KPEPE_ID, "KPEPE", "77000"),
      tokenId: KPEPE_ID,
    }),
    { logoFor: () => undefined, priceFor: (s) => prices.get(s.toUpperCase()) },
  );
  const expected = 77000 * 0.00013132628 * kas; // ≈ $0.269
  console.log("row:", item.amountNumber, item.amountSymbol, item.amountUsd);
  expect(usdOf(item.amountUsd)).toBeCloseTo(expected, 2);
  // The row and the sheet read one number.
  expect(item.amountUsd).toBe(item.sheet.transfer.receivedUsd);
});

test("a KCC-20 row whose covenant has no price shows no ticker namesake's", () => {
  const prices = new Map<string, number>([
    ["KAS", 0.0266],
    ["PEPE", 0.000002858355099295944],
  ]);
  const item = m.toActivityItem(
    m.mapSwapActivity({
      ...buyRow(KPEPE_ID, "PEPE", "18922"),
      tokenId: KPEPE_ID,
    }),
    { logoFor: () => undefined, priceFor: (s) => prices.get(s.toUpperCase()) },
  );
  expect(item.amountUsd).toBe("Price unavailable");
});
