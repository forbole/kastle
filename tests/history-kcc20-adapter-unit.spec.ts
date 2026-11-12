import { test, expect } from "@playwright/test";
import { toHistoryRecord } from "../lib/history/from-kcc20";
import type { Kcc20HistoryRow } from "../lib/kcc20/history";

const TXID = "ab".repeat(32);
const BASE = "https://kascov.io/#/mainnet/tx/";
const row = (over: Partial<Kcc20HistoryRow>): Kcc20HistoryRow => ({
  id: `${TXID}:0`,
  txid: TXID,
  kind: "send",
  direction: "out",
  timeMs: 1_700_000_000_000,
  approxTime: true,
  ...over,
});

test("attributed send: direction, exact raw amount and label carried", () => {
  const r = toHistoryRecord(
    row({
      amount: 123456789012345678901234567890n,
      counterparty: { address: "kaspa:qabc", label: "abc...xyz" },
    }),
    { symbol: "WHALE", decimals: 8 },
    BASE,
  );
  expect(r.family).toBe("kcc20");
  expect(r.kind).toBe("send");
  expect(r.direction).toBe("out");
  expect(r.amount).toEqual({
    value: {
      raw: "123456789012345678901234567890",
      decimals: 8,
      symbol: "WHALE",
    },
    quality: "exact",
  });
  expect(r.counterparty).toEqual({
    value: { address: "kaspa:qabc", label: "abc...xyz" },
    quality: "exact",
  });
  expect(r.time).toEqual({ value: 1_700_000_000_000, quality: "approximate" });
  expect(r.status).toBe("unknown");
  expect(r.fee.quality).toBe("unavailable");
  expect(r.explorer).toEqual({ url: `${BASE}${TXID}` });
});

test("unattributed row: amount and counterparty unavailable, kind unknown", () => {
  const r = toHistoryRecord(row({ kind: "unknown", direction: "in" }), {
    symbol: "WHALE",
    decimals: 8,
  });
  expect(r.kind).toBe("unknown");
  expect(r.amount).toEqual({ value: null, quality: "unavailable" });
  expect(r.counterparty).toEqual({ value: null, quality: "unavailable" });
  expect(r.explorer).toBeNull();
});

test('no-decimals token: base units, labelled "base units", amount kept', () => {
  const r = toHistoryRecord(
    row({ kind: "receive", direction: "in", amount: 42n }),
    {
      symbol: "WHALE",
    },
  );
  expect(r.amount).toEqual({
    value: { raw: "42", decimals: 0, symbol: "base units" },
    quality: "exact",
  });
});
