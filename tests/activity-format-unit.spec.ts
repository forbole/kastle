import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// E6 (25b0a33) builds the Activity formatters once instead of per call. Its
// claim — output unchanged — checked here: each formatter against the code it
// replaced, inlined below, over every currency and magnitude band it branches
// on, and dates this year and before.
type Modules = typeof import("@/lib/utils") &
  typeof import("@/lib/activity/format") &
  typeof import("@/lib/activity/adapters") &
  typeof import("@/lib/activity/mappers");
let m: Modules;

test.beforeAll(async () => {
  const repo = path.resolve(import.meta.dirname, "..");
  const outfile = path.join(tmpdir(), `activity-format-${process.pid}.mjs`);
  await build({
    stdin: {
      contents: [
        "@/lib/utils",
        "@/lib/activity/format",
        "@/lib/activity/adapters",
        "@/lib/activity/mappers",
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
    loader: { ".png": "empty", ".svg": "empty", ".wasm": "empty" },
    logLevel: "error",
  });
  m = await import(pathToFileURL(outfile).href);
});

// ─── the code E6 replaced (dd85e34) ──────────────────────────────────────────
const SYMBOL: Record<string, "narrowSymbol" | "symbol"> = {
  CNY: "narrowSymbol",
  EUR: "symbol",
  HKD: "symbol",
  JPY: "narrowSymbol",
  RUB: "narrowSymbol",
  TWD: "symbol",
  USD: "symbol",
};
function oldFiat(number: number, code = "USD"): string {
  const abs = Math.abs(number);
  const currencyDisplay = SYMBOL[code] ?? "symbol";
  const fmt = (max: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay,
      minimumFractionDigits: 2,
      maximumFractionDigits: max,
    }).format(number);
  if (!Number.isFinite(number) || abs === 0 || abs >= 0.01) return fmt(2);
  if (abs < 1e-6) {
    const floor = oldFiat(1e-6, code);
    return number < 0 ? `>-${floor}` : `<${floor}`;
  }
  return fmt(Math.min(6, 3 - Math.floor(Math.log10(abs))));
}
function oldAmount(value: string): string {
  if (!value) return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n !== 0 && Math.abs(n) < 0.001) {
    const tiny = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 8,
    }).format(n);
    return Number(tiny) === 0 ? `${n < 0 ? "-" : ""}<0.00000001` : tiny;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
}
function oldDateTime(timestampMs: number): string {
  const d = new Date(timestampMs);
  const date = d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date}｜${time}`;
}

const MAGNITUDES = [
  0, 1e-9, 9.99e-7, 1e-6, 3.3e-6, 4.56789e-5, 0.000123, 0.00123, 0.0099,
  0.00999999, 0.01, 0.05, 0.5, 1, 12.345, 1374.61, 98765.4321, 1e9,
];
const VALUES = [
  ...MAGNITUDES,
  ...MAGNITUDES.map((v) => -v),
  NaN,
  Infinity,
  -Infinity,
];

test("formatFiatAmount: same text as per-call formatters, every currency and band", () => {
  const cases = Object.keys(SYMBOL).flatMap((code) =>
    // Twice: the second pass reads the formatters the first one built.
    [...VALUES, ...VALUES].map((v) => [v, code] as const),
  );
  for (const [v, code] of cases)
    expect(`${code} ${v} ${m.formatFiatAmount(v, code)}`).toBe(
      `${code} ${v} ${oldFiat(v, code)}`,
    );
  expect(cases.length).toBe(7 * 2 * 39);
});

test("fmtAmount: same text as per-call formatters", () => {
  const inputs = [
    "",
    "abc",
    ...VALUES.map(String),
    "0.000000001",
    "-0.0000000004",
    "18922.123456",
    "123456789012345678901234567890",
  ];
  for (const s of [...inputs, ...inputs])
    expect(`${s} ${m.fmtAmount(s)}`).toBe(`${s} ${oldAmount(s)}`);
});

test("formatDateTime: same text as toLocale*String, this year and earlier", () => {
  const thisYear = new Date().getFullYear();
  const stamps = [thisYear, thisYear - 1, 2020].flatMap((y) =>
    [0, 5, 11].flatMap((mo) =>
      [
        [1, 0, 0],
        [15, 9, 5],
        [28, 23, 59],
      ].map(([d, h, mi]) => new Date(y, mo, d, h, mi).getTime()),
    ),
  );
  for (const t of [...stamps, ...stamps])
    expect(m.formatDateTime(t)).toBe(oldDateTime(t));
});

// ─── every cached formatter is total: bad input prints, never throws ──────

const noDeps = { logoFor: () => undefined, priceFor: () => undefined };

test("an unparseable Igra accepting_block_time renders its row, does not throw", () => {
  for (const accepting_block_time of [undefined, null, "garbage", NaN, 9e15]) {
    const row = m.mapIgraDepositActivity({
      txId: "97b1aa",
      evmAddress: "0x151e6413aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      amountSompi: 972_500_000,
      entryOutSompi: 972_500_000,
      kastleFeeSompi: 0,
      // igra-deposit-history copies the REST field through unchecked.
      timestampMs: accepting_block_time as unknown as number,
      accepted: true,
    });
    const item = m.toActivityItem(row, noDeps);
    // null is epoch to Date, the rest are invalid: same text either way.
    expect(item.dateTime).toBe(oldDateTime(row.timestampMs));
    expect(item.sheet.subtitle).toBe(item.dateTime);
  }
});

test("amount, fiat and rate formatters print the old text for non-finite input", () => {
  for (const v of [NaN, Infinity, -Infinity, undefined as unknown as number])
    expect(m.formatFiatAmount(v)).toBe(oldFiat(v));
  for (const s of ["NaN", "Infinity", "-Infinity", "1e400", "0x"])
    expect(m.fmtAmount(s)).toBe(oldAmount(s));
  // received / sent overflows to Infinity: the per-call RATE printed "∞".
  const swap = m.mapSwapActivity({
    id: "s",
    timestampMs: Date.UTC(2026, 0, 1),
    fromSymbol: "KAS",
    toSymbol: "iKAS",
    fromAmount: "5e-324",
    toAmount: "1e308",
    status: "completed",
  });
  const rate = m
    .toActivityItem(swap, noDeps)
    .sheet.details.find((d) => d.label === "Rate");
  const old = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
  expect(rate?.value).toBe(`1 KAS ≈ ${old.format(Infinity)} iKAS`);
});
