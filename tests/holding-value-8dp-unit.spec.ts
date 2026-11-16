import { registerHooks } from "node:module";
import { expect, test } from "@playwright/test";
import type { HistoryRecord } from "@/lib/history/types";

// lib/utils and the history format module reach network logos and
// package.json: stub images as their path and load JSON as JSON.
registerHooks({
  load(url, context, next) {
    if (url.endsWith(".json"))
      return next(url, { ...context, importAttributes: { type: "json" } });
    if (!/\.(svg|png)$/.test(url)) return next(url, context);
    return {
      format: "commonjs",
      source: `module.exports = ${JSON.stringify(url)};`,
      shortCircuit: true,
    };
  },
});

const { formatUsdAmount, formatHoldingUsd, formatTokenAmount, formatFeeInKas } =
  await import("@/lib/utils");
const { historyFiatText } = await import("@/ui/popup/history/format");
const { formatKcc20Balance } = await import("@/ui/popup/kcc20/labels");

test.describe("formatUsdAmount: fees and main's callers keep sub-dollar digits", () => {
  test("below $1 keeps up to 8 decimals", () => {
    expect(formatUsdAmount(0.29696232)).toBe("$0.29696232");
    expect(formatUsdAmount(0.5)).toBe("$0.50");
    expect(formatUsdAmount(0.00123)).toBe("$0.00123");
    expect(formatUsdAmount(0.00000001)).toBe("$0.00000001");
  });

  test("$1 or more keeps 2 decimals and grouping; 0 is $0.00", () => {
    expect(formatUsdAmount(1)).toBe("$1.00");
    expect(formatUsdAmount(1.23456789)).toBe("$1.23");
    expect(formatUsdAmount(1234567.891)).toBe("$1,234,567.89");
    expect(formatUsdAmount(0)).toBe("$0.00");
  });

  test("below 1e-8 floors to the < form", () => {
    expect(formatUsdAmount(9.9e-9)).toBe("<$0.00000001");
    expect(formatUsdAmount(-0.000000004)).toBe(">-$0.00000001");
  });
});

test.describe("formatHoldingUsd: holding values", () => {
  test("a cent or more stays at 2 decimals", () => {
    expect(formatHoldingUsd(0.29696232)).toBe("$0.30");
    expect(formatHoldingUsd(1.5)).toBe("$1.50");
    expect(formatHoldingUsd(0.01)).toBe("$0.01");
    expect(formatHoldingUsd(1234567.891)).toBe("$1,234,567.89");
  });

  test("below a cent shows up to 8 decimals, never $0.00", () => {
    expect(formatHoldingUsd(0.004)).toBe("$0.004");
    expect(formatHoldingUsd(0.0000042)).toBe("$0.0000042");
    expect(formatHoldingUsd(0.00999999)).toBe("$0.00999999");
    expect(formatHoldingUsd(0.00000001)).toBe("$0.00000001");
  });

  test("exact 0 shows $0.00", () => {
    expect(formatHoldingUsd(0)).toBe("$0.00");
  });

  test("below 1e-8 floors to the < form", () => {
    expect(formatHoldingUsd(9.9e-9)).toBe("<$0.00000001");
    expect(formatHoldingUsd(-0.000000004)).toBe(">-$0.00000001");
  });

  test("decimal-less currency: cutoff is one whole unit, never prints 0", () => {
    // JPY/KRW have no minor unit (Intl reports 0 fraction digits).
    expect(formatHoldingUsd(0.4, "JPY")).toBe("¥0.4");
    expect(formatHoldingUsd(0.0000042, "JPY")).toBe("¥0.0000042");
    expect(formatHoldingUsd(0.4, "KRW")).toBe("₩0.4");
    // At or above ¥1 the currency keeps its own 0 digits.
    expect(formatHoldingUsd(1, "JPY")).toBe("¥1");
    expect(formatHoldingUsd(1234.4, "JPY")).toBe("¥1,234");
    expect(formatHoldingUsd(0, "JPY")).toBe("¥0");
    // Two-digit currencies keep the cent cutoff.
    expect(formatHoldingUsd(0.4, "EUR")).toBe("€0.40");
    expect(formatHoldingUsd(0.004, "EUR")).toBe("€0.004");
  });

  test("history row fiat: 3 places unless they collapse a non-zero value", () => {
    const rec = (usd: number) =>
      ({
        fiat: { value: { usd }, quality: "approximate" },
      }) as unknown as HistoryRecord;
    expect(historyFiatText(rec(19.2354))).toBe("≈ $19.235 USD");
    expect(historyFiatText(rec(0))).toBe("≈ $0.000 USD");
    expect(historyFiatText(rec(0.0000042))).toBe("≈ $0.0000042 USD");
    expect(historyFiatText(rec(0.0004))).toBe("≈ $0.0004 USD");
    expect(historyFiatText(rec(-0.0004))).toBe("≈ -$0.0004 USD");
  });

  test("history row fiat: values 3 places already show keep main's text", () => {
    const rec = (usd: number) =>
      ({
        fiat: { value: { usd }, quality: "approximate" },
      }) as unknown as HistoryRecord;
    expect(historyFiatText(rec(0.001))).toBe("≈ $0.001 USD");
    // 0.0007 rounds to $0.001 at 3 places, as on main: not rerouted.
    expect(historyFiatText(rec(0.0007))).toBe("≈ $0.001 USD");
    expect(historyFiatText(rec(0.0005))).toBe("≈ $0.001 USD");
  });
});

test.describe("holding amount: a non-zero amount never prints 0", () => {
  test("tiny float amounts keep 8 decimals, below that floor", () => {
    expect(formatTokenAmount(0.00000042)).toBe("0.00000042");
    expect(formatTokenAmount(0.000000001)).toBe("<0.00000001");
    expect(formatTokenAmount(0)).toBe("0");
    expect(formatTokenAmount(1234.5)).toBe("1,234.5");
  });

  test("dust below 1e-8 renders the floor form, not 0", () => {
    // 1 wei of an 18-decimal ERC-20 / EVM KAS, as the balance hooks parse it.
    const oneWei = parseFloat("0.000000000000000001");
    expect(formatTokenAmount(oneWei)).toBe("<0.00000001");
    expect(formatTokenAmount(oneWei)).not.toBe("0");
    expect(formatTokenAmount(0.0000000099)).toBe("<0.00000001");
    // Exactly at the floor shows the value itself, not the < form.
    expect(formatTokenAmount(0.00000001)).toBe("0.00000001");
    // A layout cap on digits keeps the non-zero floor at that cap.
    expect(formatTokenAmount(oneWei, 4)).toBe("<0.0001");
    expect(formatTokenAmount(0.00004, 4)).toBe("<0.0001");
  });

  test("fee floor unchanged", () => {
    expect(formatFeeInKas(0.000001)).toBe("<0.00001");
    expect(formatFeeInKas(0.2)).toBe("0.2");
  });

  test("KCC-20 holding: 3-place collapse shows the exact value", () => {
    expect(formatKcc20Balance({ amount: 42n, meta: { decimals: 8 } })).toBe(
      "0.00000042",
    );
    expect(
      formatKcc20Balance({ amount: 1234500n, meta: { decimals: 3 } }),
    ).toBe("1,234.5");
  });
});
