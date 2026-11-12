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
  historyRowDateText,
  shortAddress,
  historyRowTitle,
  historyTimeText,
  historyTitle,
} = await import("@/ui/popup/history/format");

const { textEllipsis } = await import("@/lib/utils");
const { counterpartyLabel } = await import("@/lib/kcc20/history");

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
  test("decimals 6 vs 18, 3 places rounded", () => {
    expect(formatRawAmount("1500000", 6)).toBe("1.5");
    expect(formatRawAmount("1500000000000000000", 18)).toBe("1.5");
    expect(formatRawAmount("1", 18)).toBe("0.000000000000000001");
    expect(formatRawAmount("10000000", 8)).toBe("0.1");
    expect(formatRawAmount("1234567891234567", 6)).toBe("1,234,567,891.235");
    // NACHO, 8 decimals: rounded to 3 places, the kcc20-send display.
    expect(formatRawAmount("210759267306", 8)).toBe("2,107.593");
    expect(formatRawAmount("1999500", 6)).toBe("2");
    expect(formatRawAmount("0", 8)).toBe("0");
    expect(formatRawAmount("123456789", 0)).toBe("123,456,789");
  });

  test("signed amount text by direction", () => {
    expect(historyAmountText(rec())).toBe("-1.5 USDC");
    expect(historyAmountText(rec({ direction: "in" }))).toBe("+1.5 USDC");
    expect(historyAmountText(rec({ direction: "self" }))).toBe("1.5 USDC");
  });

  test("an unavailable amount renders no string at all", () => {
    expect(historyAmountText(rec({ amount: NA }))).toBeNull();
  });

  test("an exact zero amount is not treated as missing, and takes no sign", () => {
    const zero = rec({
      direction: "in",
      amount: {
        value: { raw: "0", decimals: 18, symbol: "KAS" },
        quality: "exact",
      },
    });
    expect(historyAmountText(zero)).toBe("0 KAS");
    expect(historyAmountText({ ...zero, direction: "out" })).toBe("0 KAS");
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

  test("row title names the counterparty only on a plain send / receive", () => {
    expect(historyRowTitle(rec({ kind: "send" }))).toBe("Sent to 0xab…bc");
    expect(historyRowTitle(rec({ kind: "receive", direction: "in" }))).toBe(
      "Received from 0xab…bc",
    );
    expect(historyRowTitle(rec({ kind: "send", counterparty: NA }))).toBe(
      "Sent",
    );
    expect(historyRowTitle(rec({ kind: "mint" }))).toBe("Mint");
    expect(historyRowTitle(rec({ kind: "self", direction: "self" }))).toBe(
      "Self transfer",
    );
  });

  test("designed title re-cuts an absent or auto-ellipsis label to 4 + 4", () => {
    const addr = "0x1f51aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9497";
    const party = (label?: string) =>
      rec({
        kind: "send",
        counterparty: { value: { address: addr, label }, quality: "exact" },
      });
    expect(shortAddress(addr)).toBe("0x1f51...9497");
    expect(historyRowTitle(party())).toBe("Sent to 0x1f51...9497");
    // The data layer's own 8…5 ellipsis is not a real label.
    expect(historyRowTitle(party(textEllipsis(addr)))).toBe(
      "Sent to 0x1f51...9497",
    );
    // KCC-20: the lib strips presence: / p2pkh: before its ellipsis.
    const key = "p2pkh:abcd1234567890abcdef1234567890wxyz";
    const owned = rec({
      kind: "send",
      counterparty: {
        value: { address: key, label: counterpartyLabel(key) },
        quality: "exact",
      },
    });
    expect(historyRowTitle(owned)).toBe("Sent to abcd...wxyz");
    expect(historyRowTitle(party("KRON market"))).toBe("Sent to KRON market");
    expect(historyRowTitle(party("#42 · 0x1f51aaaa...a9497"))).toBe(
      "Sent to #42 · 0x1f51aaaa...a9497",
    );
  });

  test("shortAddress keeps known prefixes, else first 4 + last 4", () => {
    const kas =
      "kaspa:qr3xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaak7x2";
    expect(shortAddress(kas)).toBe("kaspa:qr3x...k7x2");
    expect(shortAddress(kas.replace("kaspa:", "kaspatest:"))).toBe(
      "kaspatest:qr3x...k7x2",
    );
    expect(shortAddress("p2pkh:abcd1234567890wxyz")).toBe("abcd...wxyz");
    expect(shortAddress("presence:abcd1234567890wxyz")).toBe("abcd...wxyz");
    expect(shortAddress("0xabc")).toBe("0xabc");
  });

  test("row date: day month｜24h time, year only outside the current year", () => {
    const year = new Date().getFullYear();
    expect(historyRowDateText(null)).toBeNull();
    expect(historyRowDateText(new Date(year, 5, 12, 11, 4).getTime())).toBe(
      "12 Jun｜11:04",
    );
    expect(historyRowDateText(new Date(year - 1, 9, 5, 12, 21).getTime())).toBe(
      `5 Oct ${year - 1}｜12:21`,
    );
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

  test("a 1-wei receive shows its exact value, never 0; exact zero stays 0", () => {
    const wei = (raw: string) =>
      rec({
        direction: "in",
        amount: {
          value: { raw, decimals: 18, symbol: "KAS" },
          quality: "exact",
        },
      });
    expect(historyAmountText(wei("1"))).toBe("+0.000000000000000001 KAS");
    expect(historyAmountText(wei("0"))).toBe("0 KAS");
    // Below 3 places the exact value shows, trailing zeros trimmed.
    expect(formatRawAmount("10000000000", 18)).toBe("0.00000001");
    expect(formatRawAmount("400000000000000", 18)).toBe("0.0004");
    // At or above the threshold the 3-place rounding applies.
    expect(formatRawAmount("500000000000000", 18)).toBe("0.001");
  });

  test("a failed send carries no sign", () => {
    expect(historyAmountText(rec({ status: "failed" }))).toBe("1.5 USDC");
  });
});
