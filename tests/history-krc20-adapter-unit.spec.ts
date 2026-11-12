import { registerHooks } from "node:module";
import { test, expect } from "@playwright/test";
import type { Op } from "@/hooks/useOpListByAddressAndTicker";

// The adapter reaches the Settings screen (explorer links), which imports
// logos and package.json; stub images as their path and load JSON as JSON.
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

const { toHistoryRecord } = await import("@/lib/history/from-krc20");
const { NetworkType } = await import("@/contexts/SettingsContext");
const { explorerTxLinks } = await import("@/components/screens/Settings");

const ME = "kaspa:me";
const A = "kaspa:alice";
const TX = "ab".repeat(32);
const T = 1_762_000_000_000;
const ctx = {
  ownAddress: ME,
  tick: "KASPY",
  decimals: 8,
  network: NetworkType.Mainnet,
  usdPrice: 0.5,
};

const op = (over: Partial<Op>): Op => ({
  p: "krc-20",
  op: "transfer",
  tick: "KASPY",
  amt: "123456789012345678901",
  pre: "",
  from: ME,
  to: A,
  opScore: "1",
  hashRev: TX,
  feeRev: "0",
  txAccept: "1",
  opAccept: "1",
  opError: "",
  checkpoint: "",
  mtsAdd: String(T),
  mtsMod: String(T),
  ...over,
});

test("send: out, names the recipient, raw amount kept verbatim", () => {
  const r = toHistoryRecord(op({}), ctx);
  expect(r.family).toBe("krc20");
  expect(r.id).toBe(`${TX}:${T}:transfer`);
  expect(r.txid).toBe(TX);
  expect(r.kind).toBe("send");
  expect(r.direction).toBe("out");
  expect(r.counterparty).toEqual({ value: { address: A }, quality: "exact" });
  expect(r.amount).toEqual({
    value: { raw: "123456789012345678901", decimals: 8, symbol: "KASPY" },
    quality: "exact",
  });
  expect(r.time).toEqual({ value: T, quality: "exact" });
  expect(r.status).toBe("finalized");
  expect(r.fiat.quality).toBe("approximate");
  expect(r.fiat.value?.usd).toBeCloseTo(1234567890123.4568 * 0.5, 0);
  expect(r.kasLeg.quality).toBe("unavailable");
  expect(r.fee.quality).toBe("unavailable");
  expect(r.explorer).toEqual({
    url: `${explorerTxLinks[NetworkType.Mainnet]}${TX}`,
  });
});

test("receive: in, names the sender", () => {
  const r = toHistoryRecord(op({ from: A, to: ME, amt: "100" }), ctx);
  expect(r.kind).toBe("receive");
  expect(r.direction).toBe("in");
  expect(r.counterparty).toEqual({ value: { address: A }, quality: "exact" });
});

test("self transfer: self, no counterparty", () => {
  const r = toHistoryRecord(op({ from: ME, to: ME }), ctx);
  expect(r.kind).toBe("self");
  expect(r.direction).toBe("self");
  expect(r.counterparty.quality).toBe("unavailable");
});

test("deploy: the premint is a receipt (in), amount comes from pre", () => {
  const r = toHistoryRecord(
    op({ op: "deploy", amt: "", pre: "5000", to: undefined }),
    ctx,
  );
  expect(r.kind).toBe("deploy");
  expect(r.direction).toBe("in");
  expect(r.amount.value?.raw).toBe("5000");
  expect(r.counterparty.quality).toBe("unavailable");
  expect(r.id).toBe(`${TX}:${T}:deploy`);
});

test("deploy with pre 1000: in, amount 1000", () => {
  const r = toHistoryRecord(op({ op: "deploy", amt: "", pre: "1000" }), ctx);
  expect(r.direction).toBe("in");
  expect(r.amount).toEqual({
    value: { raw: "1000", decimals: 8, symbol: "KASPY" },
    quality: "exact",
  });
});

test("deploy without a premint: amount unavailable, kind still deploy", () => {
  for (const pre of ["0", ""]) {
    const r = toHistoryRecord(op({ op: "deploy", amt: "", pre }), ctx);
    expect(r.kind).toBe("deploy");
    expect(r.direction).toBe("in");
    expect(r.amount).toEqual({ value: null, quality: "unavailable" });
    expect(r.fiat.quality).toBe("unavailable");
  }
});

test("mint: in, amt, no counterparty", () => {
  const r = toHistoryRecord(op({ op: "mint", amt: "777", to: ME }), ctx);
  expect(r.kind).toBe("mint");
  expect(r.direction).toBe("in");
  expect(r.amount.value?.raw).toBe("777");
  expect(r.counterparty.quality).toBe("unavailable");
});

test("unknown op: unknown, self", () => {
  const r = toHistoryRecord(op({ op: "list" }), ctx);
  expect(r.kind).toBe("unknown");
  expect(r.direction).toBe("self");
  expect(r.amount.quality).toBe("unavailable");
});

test("unparsable amt: row exists, amount and fiat unavailable, never 0", () => {
  const r = toHistoryRecord(op({ amt: "1.5e3" }), ctx);
  expect(r.id).toBe(`${TX}:${T}:transfer`);
  expect(r.kind).toBe("send");
  expect(r.amount).toEqual({ value: null, quality: "unavailable" });
  expect(r.fiat).toEqual({ value: null, quality: "unavailable" });
  expect(toHistoryRecord(op({ amt: "" }), ctx).amount.quality).toBe(
    "unavailable",
  );
});

test("empty hashRev: txid and explorer null", () => {
  const r = toHistoryRecord(op({ hashRev: "" }), ctx);
  expect(r.txid).toBeNull();
  expect(r.explorer).toBeNull();
});

test("bad mtsAdd: time unavailable", () => {
  expect(toHistoryRecord(op({ mtsAdd: "x" }), ctx).time.quality).toBe(
    "unavailable",
  );
});

for (const decimals of [undefined, 1.5, -2]) {
  test(`unknown scale (${decimals}): base units, no fiat, no throw`, () => {
    const r = toHistoryRecord(op({ amt: "100000000" }), { ...ctx, decimals });
    expect(r.amount).toEqual({
      value: { raw: "100000000", decimals: 0, symbol: "base units" },
      quality: "exact",
    });
    expect(r.fiat.quality).toBe("unavailable");
  });
}

test("zero-decimals token: ticker, decimals 0, fiat from the price", () => {
  const r = toHistoryRecord(op({ amt: "42" }), { ...ctx, decimals: 0 });
  expect(r.amount).toEqual({
    value: { raw: "42", decimals: 0, symbol: "KASPY" },
    quality: "exact",
  });
  expect(r.fiat.quality).toBe("approximate");
  expect(r.fiat.value?.usd).toBeCloseTo(21, 9);
});

test("decimals undefined: still base units, no fiat", () => {
  const r = toHistoryRecord(op({ amt: "42" }), { ...ctx, decimals: undefined });
  expect(r.amount.value?.symbol).toBe("base units");
  expect(r.fiat).toEqual({ value: null, quality: "unavailable" });
});
