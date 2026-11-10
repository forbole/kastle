import { registerHooks } from "node:module";
import { expect, test } from "@playwright/test";
import type { HistoryRecord } from "@/lib/history/types";
// The shell's format module reaches network logos and package.json; stub
// images as their path and load JSON as JSON (as history-kas-adapter does).
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

const {
  formatRawAmount,
  historyAmountText,
  historyCounterpartyText,
  historyTimeText,
  historyTitle,
} = await import("@/ui/popup/history/format");

const NA = { value: null, quality: "unavailable" } as const;
const T = Date.UTC(2026, 10, 10, 15, 4);

function rec(over: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: "0x1",
    family: "erc20",
    txid: "0x1",
    kind: "send",
    direction: "out",
    amount: {
      value: { raw: "1500000", decimals: 6, symbol: "USDC" },
      quality: "exact",
    },
    kasLeg: NA,
    fiat: NA,
    time: { value: T, quality: "exact" },
    counterparty: {
      value: { address: "0xabc", label: "0xab…bc" },
      quality: "exact",
    },
    fee: NA,
    status: "finalized",
    explorer: null,
    ...over,
  };
}

test.describe("evm-history format", () => {
  test("decimals 6 vs 18", () => {
    expect(formatRawAmount("1500000", 6)).toBe("1.5");
    expect(formatRawAmount("1500000000000000000", 18)).toBe("1.5");
    expect(formatRawAmount("1", 18)).toBe("<0.00000001");
    expect(formatRawAmount("10000000", 8)).toBe("0.1");
    expect(formatRawAmount("1234567891234567", 6)).toBe("1,234,567,891.234567");
    expect(formatRawAmount("123456789", 0)).toBe("123,456,789");
  });

  test("signed amount text by direction", () => {
    expect(historyAmountText(rec())).toBe("−1.5 USDC");
    expect(historyAmountText(rec({ direction: "in" }))).toBe("+1.5 USDC");
    expect(historyAmountText(rec({ direction: "self" }))).toBe("1.5 USDC");
  });

  test("an unavailable amount renders no string at all", () => {
    expect(historyAmountText(rec({ amount: NA }))).toBeNull();
  });

  test("an exact zero amount is not treated as missing", () => {
    const zero = rec({
      direction: "in",
      amount: {
        value: { raw: "0", decimals: 18, symbol: "KAS" },
        quality: "exact",
      },
    });
    expect(historyAmountText(zero)).toBe("+0 KAS");
  });

  test("title by kind", () => {
    expect(historyTitle("send")).toBe("Sent");
    expect(historyTitle("receive")).toBe("Received");
    expect(historyTitle("self")).toBe("Self transfer");
    expect(historyTitle("deploy")).toBe("Contract deploy");
    expect(historyTitle("mint")).toBe("Mint");
    expect(historyTitle("buy")).toBe("Bought");
    expect(historyTitle("sell")).toBe("Sold");
    expect(historyTitle("unknown")).toBe("Transaction");
    // The family argument leaves the EVM titles as they were.
    expect(historyTitle("send", "erc20")).toBe("Sent");
    expect(historyTitle("receive", "evm-native")).toBe("Received");
  });

  test("time text takes raw ms and is never approximate", () => {
    const time = historyTimeText(T)!;
    expect(time).toBeTruthy();
    expect(time.startsWith("≈")).toBe(false);
    expect(historyTimeText(null)).toBeNull();
  });

  test("counterparty: To for out, From for in, none for self or unavailable", () => {
    expect(historyCounterpartyText(rec())).toBe("To 0xab…bc");
    expect(historyCounterpartyText(rec({ direction: "in" }))).toBe(
      "From 0xab…bc",
    );
    expect(historyCounterpartyText(rec({ direction: "self" }))).toBeNull();
    expect(historyCounterpartyText(rec({ counterparty: NA }))).toBeNull();
  });

  test("counterparty prefers the label over the address", () => {
    const labelled = rec({
      counterparty: {
        value: { address: "0x1234567890abcdef1234", label: "Treasury" },
        quality: "exact",
      },
    });
    expect(historyCounterpartyText(labelled)).toBe("To Treasury");
  });

  test("a 1-wei receive is bounded, never 0; exact zero stays 0", () => {
    const wei = (raw: string) =>
      rec({
        direction: "in",
        amount: {
          value: { raw, decimals: 18, symbol: "KAS" },
          quality: "exact",
        },
      });
    expect(historyAmountText(wei("1"))).toBe("+<0.00000001 KAS");
    expect(historyAmountText(wei("0"))).toBe("+0 KAS");
    expect(formatRawAmount("10000000000", 18)).toBe("0.00000001");
  });

  test("a failed send carries no sign", () => {
    expect(historyAmountText(rec({ status: "failed" }))).toBe("1.5 USDC");
  });
});
